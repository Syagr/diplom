// src/queues/index.ts
import IORedis from 'ioredis';

// Allow disabling queues in test/smoke environments to avoid ESM/CJS loader issues
const DISABLE_QUEUES = process.env.DISABLE_QUEUES === '1' || process.env.NODE_ENV === 'test';

let Queue: any;
let QueueEvents: any;
if (!DISABLE_QUEUES) {
  // Importing BullMQ in NodeNext can be tricky for types; use dynamic import compatible with ESM
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Bull = require('bullmq');
  Queue = Bull.Queue as any;
  QueueEvents = Bull.QueueEvents as any;
}
type JobsOptions = any;
type QueueOptions = any;
type QueueBaseOptions = any;

// ---------- Redis connection ----------

/**
 * Предпочитаем REDIS_URL (например: redis://:pass@host:6379/0).
 * Если нет — собираем из REDIS_HOST/PORT/PASSWORD/DB.
 */
function createRedis() {
  const url = process.env.REDIS_URL;
  if (url) {
    return new (IORedis as any)(url, {
      maxRetriesPerRequest: null, // важно для BullMQ
      enableReadyCheck: false,
    });
  }

  return new (IORedis as any)({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

const redis = DISABLE_QUEUES ? ({} as any) : createRedis();

// ---------- BullMQ options & helpers ----------

const prefix = process.env.BULL_PREFIX || 'aa';
const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1500 },
  removeOnComplete: { age: 60 * 60, count: 1000 }, // 1h | max 1000
  removeOnFail: { age: 24 * 60 * 60, count: 1000 }, // 24h
};

const baseQueueOpts: QueueBaseOptions = {
  prefix,
  connection: redis,
};

function makeQueue(name: string, extra?: Partial<QueueOptions>) {
  return new Queue(name, {
    ...baseQueueOpts,
    defaultJobOptions,
    // можно кастомизировать на уровне конкретной очереди
    ...(extra || {}),
  });
}

// ---------- Queues ----------

/** Очередь отложенного удаления объектов из хранилища */
export const cleanupQ = DISABLE_QUEUES
  ? ({ add: async () => ({ id: 'stub' }), close: async () => undefined } as any)
  : makeQueue('attachments-cleanup');

/** Очередь генерации превью/метаданных вложений */
export const previewsQ = DISABLE_QUEUES
  ? ({ add: async () => ({ id: 'stub' }), close: async () => undefined } as any)
  : makeQueue('attachments-previews');

/** Email notifications */
export const notificationsEmailQ = DISABLE_QUEUES
  ? ({ add: async () => ({ id: 'stub' }), close: async () => undefined } as any)
  : makeQueue('notifications-email');

// ---------- Events (логирование/наблюдение) ----------

const cleanupEvents = DISABLE_QUEUES ? ({} as any) : new QueueEvents('attachments-cleanup', baseQueueOpts as any);
const previewsEvents = DISABLE_QUEUES ? ({} as any) : new QueueEvents('attachments-previews', baseQueueOpts as any);
const notificationsEvents = DISABLE_QUEUES ? ({} as any) : new QueueEvents('notifications-email', baseQueueOpts as any);

for (const ev of [cleanupEvents, previewsEvents, notificationsEvents]) {
  if (ev && typeof (ev as any).on === 'function') {
    (ev as any).on('active', ({ jobId, prev }: any) => {
      // eslint-disable-next-line no-console
      console.log(`[queue:${(ev as any).name || 'q'}] active job=${jobId} prev=${prev}`);
    });
    (ev as any).on('completed', ({ jobId, returnvalue }: any) => {
      console.log(`[queue:${(ev as any).name || 'q'}] completed job=${jobId}`, returnvalue);
    });
    (ev as any).on('failed', ({ jobId, failedReason }: any) => {
      console.error(`[queue:${(ev as any).name || 'q'}] failed job=${jobId}: ${failedReason}`);
    });
    (ev as any).on('error', (err: any) => {
      console.error(`[queue:${(ev as any).name || 'q'}] events error:`, err?.message || err);
    });
  }
}

// ---------- Convenience API (опционально) ----------

/** Добавить задачу на удаление объекта: objectKey, attachmentId, с отложенным стартом (ms) */
export function scheduleAttachmentCleanup(
  payload: { objectKey: string; attachmentId: number },
  delayMs: number
) {
  return cleanupQ.add('cleanup-object', payload, { delay: delayMs });
}

/** Добавить задачу на создание превью */
export function enqueuePreview(attachmentId: number) {
  return previewsQ.add('make-preview', { attachmentId });
}

type NotificationJob = {
  type: 'payment_completed' | 'estimate_locked' | 'order_closed';
  orderId: number;
  paymentId?: number;
  estimateId?: number;
};

/** Добавить задачу отправки email-уведомления */
export function enqueueEmailNotification(payload: NotificationJob, delayMs = 3000) {
  return notificationsEmailQ.add(payload.type, payload, { delay: delayMs });
}

// ---------- Graceful shutdown ----------

export async function closeQueues() {
  await Promise.allSettled([
    (cleanupEvents as any).close?.(),
    (previewsEvents as any).close?.(),
    (notificationsEvents as any).close?.(),
    (cleanupQ as any).close?.(),
    (previewsQ as any).close?.(),
    (notificationsEmailQ as any).close?.(),
    (redis as any).quit?.(),
  ]);
}

// На всякий случай прикроем соединения при SIGINT/SIGTERM
const onSignal = async (sig: string) => {
  try {
    console.log(`[queues] ${sig} received -> closing queues`);
    await closeQueues();
    process.exit(0);
  } catch (e) {
    console.error('[queues] graceful close failed:', e);
    process.exit(1);
  }
};

if (!DISABLE_QUEUES) {
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
}
