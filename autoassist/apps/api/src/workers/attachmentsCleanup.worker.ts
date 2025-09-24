import { Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { minio, ATTACH_BUCKET } from '../libs/minio.js';
import prisma from '../utils/prisma.js';

const connection = new (IORedis as any)({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
});

const worker = new Worker<{ objectKey: string, attachmentId: number }>('attachments:cleanup', async job => {
  const { objectKey, attachmentId } = job.data;
  try {
    await minio.removeObject(ATTACH_BUCKET, objectKey);
  } catch { /* ignore if already removed */ }
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId }, select: { meta: true } });
  await prisma.attachment.update({ where: { id: attachmentId }, data: { meta: { ...(att?.meta as any), cleanedAt: new Date() } as any }});
}, { connection });

new QueueEvents('attachments:cleanup', { connection }).on('completed', e => console.log('[cleanup] done', e.jobId));


console.log('[worker] attachments:cleanup started');

process.on('SIGINT', async () => { try { await worker.close(); process.exit(0); } catch { process.exit(1); } });
process.on('SIGTERM', async () => { try { await worker.close(); process.exit(0); } catch { process.exit(1); } });
