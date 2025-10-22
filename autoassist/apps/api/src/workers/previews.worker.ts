// workers/attachments.previews.worker.ts
import { Worker, QueueEvents, MetricsTime, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
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
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

type PreviewPayload = { attachmentId: number };

export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 60 * 60, count: 500 },
  removeOnFail: { age: 24 * 60 * 60, count: 1000 },
};

const worker = new Worker<PreviewPayload>(
  'attachments:previews',
  async (job) => {
    const { attachmentId } = job.data;

    // 1) читаем текущее meta
    const att = await prisma.attachment.findUnique({
      where: { id: attachmentId },
      select: { id: true, meta: true, status: true, type: true, contentType: true, objectKey: true },
    });
    if (!att) {
      // ничего не делаем, но не падаем — задание можно считать обработанным
      return { ok: false, reason: 'ATTACHMENT_NOT_FOUND' };
    }

    // 2) (опционально) здесь можно построить превью (из MinIO/S3, локального диска, и т.д.)
    //    сейчас — заглушка: просто помечаем previewReady=true.
    //    если позже добавишь реальное построение, бросай ошибку при фейле — BullMQ отретраит.

    // 3) безопасно мерджим meta, не теряя старые ключи
    const prev = (att.meta ?? {}) as Record<string, unknown>;
    const updatedMeta = {
      ...prev,
      previewReady: true,
      previewAt: new Date().toISOString(),
      // можно хранить дополнительные сведения для дебага:
      // previewInfo: { generator: 'stub', version: 1 }
    };

    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { meta: updatedMeta as any },
    });

    return { ok: true, attachmentId };
  },
  {
    connection,
    concurrency: Number(process.env.PREVIEWS_CONCURRENCY || 4),
    limiter: process.env.PREVIEWS_LIMITER
      ? JSON.parse(process.env.PREVIEWS_LIMITER)
      : { max: 120, duration: 60_000 }, // 120 оп/мин по умолчанию
    metrics: { maxDataPoints: MetricsTime.ONE_HOUR },
    autorun: true,
  }
);

// немного наблюдаемости
worker.on('ready', () => {
  console.log(`[previews] worker ready on redis://${REDIS_HOST}:${REDIS_PORT}`);
});
worker.on('active', (job) => {
  if (!job.attemptsMade && !job.opts.attempts) {
    // мягко применим дефолтные retry/backoff, если продюсер их не указал
    job.opts.attempts = DEFAULT_JOB_OPTS.attempts;
    job.opts.backoff = DEFAULT_JOB_OPTS.backoff;
  }
});
worker.on('completed', (job, ret) => {
  console.log(`[previews] completed job=${job.id} att=${job.data.attachmentId}`, ret);
});
worker.on('failed', (job, err) => {
  console.error(`[previews] failed job=${job?.id} att=${job?.data?.attachmentId} attempts=${job?.attemptsMade}`, err?.message || err);
});
worker.on('error', (err) => {
  console.error('[previews] worker error', err);
});

const qe = new QueueEvents('attachments:previews', { connection });
qe.on('completed', ({ jobId }) => console.log('[previews] qe completed', jobId));
qe.on('failed', ({ jobId, failedReason }) => console.warn('[previews] qe failed', jobId, failedReason));

// graceful shutdown
let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[previews] shutting down...');
  try { await worker.close(); } catch {}
  try { await qe.close(); } catch {}
  try { await prisma.$disconnect(); } catch {}
  try { await connection.quit(); } catch {}
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('beforeExit', () => shutdown(0));

console.log('[previews] worker started');
