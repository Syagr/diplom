import IORedis from 'ioredis';
import * as BullMQ from 'bullmq';

const connection = new (IORedis as any)({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
});

// экспорт очередей (use runtime-typed Queue to avoid type mismatch in dev)
const Queue: any = (BullMQ as any).Queue || (BullMQ as any).default || ((BullMQ as any).default && (BullMQ as any).default.Queue) || (() => { throw new Error('No Queue implementation found'); }) ;
export const cleanupQ = new Queue('attachments-cleanup', { connection });
export const previewsQ = new Queue('attachments-previews', { connection });
