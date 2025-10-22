// workers/attachments.cleanup.worker.ts
import { Worker, QueueEvents, MetricsTime, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { minio, ATTACH_BUCKET } from '../libs/minio.js';
import prisma from '../utils/prisma.js';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_TLS = process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true';

const connection = new (IORedis as any)({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  ...(REDIS_TLS ? { tls: { rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== '0' } } : {}),
  // Чуть спокойнее по умолчанию
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

type CleanupPayload = { objectKey: string; attachmentId: number };

// Дефолтные опции задания (если продюсер не задал свои)
export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 }, // 5s, 10s, 20s, ...
  removeOnComplete: { age: 60 * 60, count: 500 }, // 1h / 500
  removeOnFail: { age: 24 * 60 * 60, count: 1_000 }, // 24h / 1k
};

// сам воркер
const worker = new Worker<CleanupPayload>(
  'attachments:cleanup',
  async (job) => {
    const { objectKey, attachmentId } = job.data;

    // 1) Удаляем объект из MinIO (idempotent)
    try {
      await minio.removeObject(ATTACH_BUCKET, objectKey);
    } catch (err: any) {
      // MinIO/S3 совместимо: если уже нет — пропускаем
      const msg = String(err?.code || err?.message || err);
      if (!/NoSuchKey|NotFound/i.test(msg)) {
        // бросаем, пускай ретраится
        throw err;
      }
    }

    // 2) Помечаем запись в БД (не затирая meta)
    const att = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { meta: true, status: true },
    });

    // Если уже удалена/помечена — просто обновим cleanedAt
    const prevMeta = (att?.meta ?? {}) as Record<string, unknown>;
    const updatedMeta = { ...prevMeta, cleanedAt: new Date().toISOString() };

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: {
        meta: updatedMeta as any,
        // если вдруг забыли пометить — поставим removed
        ...(att?.status !== 'removed' ? { status: 'removed' as any } : null),
      },
    });

    return { ok: true, attachmentId };
  },
  {
    connection,
    // небешеная конкуренция, чтобы не душить S3/MinIO
    concurrency: Number(process.env.CLEANUP_CONCURRENCY || 4),
    // простейший rate-limit (например, 60 оп/мин)
    limiter: process.env.CLEANUP_LIMITER
      ? JSON.parse(process.env.CLEANUP_LIMITER)
      : { max: 60, duration: 60_000 },
    // метрики BullMQ (для отладки/наблюдения)
    metrics: {
      maxDataPoints: MetricsTime.ONE_HOUR,
    },
    // по умолчанию воркер будет уважать attempts/backoff с продюсера;
    // если их нет — можно переопределить в on('active') ниже, либо держать DEFAULT_JOB_OPTS при продюсинге
    autorun: true,
  }
);

// События — чуть больше наблюдаемости
worker.on('ready', () => {
  console.log(`[cleanup] worker ready on redis://${REDIS_HOST}:${REDIS_PORT} bucket=${ATTACH_BUCKET}`);
});
worker.on('active', (job) => {
  if (!job.attemptsMade && !job.opts.attempts) {
    // мягко применим дефолты, если продюсер не задал
    job.update({ ...job.data }).catch(() => void 0);
    job.opts.attempts = DEFAULT_JOB_OPTS.attempts;
    job.opts.backoff = DEFAULT_JOB_OPTS.backoff;
  }
});
worker.on('completed', (job, ret) => {
  console.log(`[cleanup] completed job=${job.id} att=${job.data.attachmentId}`, ret);
});
worker.on('failed', (job, err) => {
  console.error(`[cleanup] failed job=${job?.id} att=${job?.data?.attachmentId} attempts=${job?.attemptsMade}`, err?.message || err);
});
worker.on('error', (err) => {
  console.error('[cleanup] worker error', err);
});

// QueueEvents — для агрегированных событий
const qe = new QueueEvents('attachments:cleanup', { connection });
qe.on('completed', ({ jobId }) => console.log('[cleanup] qe completed', jobId));
qe.on('failed', ({ jobId, failedReason }) => console.warn('[cleanup] qe failed', jobId, failedReason));

// Graceful shutdown
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[cleanup] shutting down...');
  try { await worker.close(); } catch {}
  try { await qe.close(); } catch {}
  try { await prisma.$disconnect(); } catch {}
  try { await connection.quit(); } catch {}
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('beforeExit', () => shutdown(0));

console.log('[cleanup] worker started');
