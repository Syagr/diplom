import IORedis from 'ioredis';
import { Queue as _Queue } from 'bullmq';

const connection = new (IORedis as any)({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
});

// экспорт очередей
const Queue: any = _Queue as any;
export const cleanupQ = new Queue('attachments:cleanup', { connection });
export const previewsQ = new Queue('attachments:previews', { connection });
