import { Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../utils/prisma.js';

const connection = new (IORedis as any)({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
});

const worker = new Worker<{ attachmentId: number }>('attachments:previews', async job => {
  const { attachmentId } = job.data;
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId }, select: { meta: true }});
  await prisma.attachment.update({ where: { id: attachmentId }, data: { meta: { ...(att?.meta as any), previewReady: true, previewAt: new Date() } as any }});
}, { connection });

new QueueEvents('attachments:previews', { connection }).on('completed', e => console.log('[previews] done', e.jobId));

console.log('[worker] attachments:previews started');

process.on('SIGINT', async () => { try { await worker.close(); process.exit(0); } catch { process.exit(1); } });
process.on('SIGTERM', async () => { try { await worker.close(); process.exit(0); } catch { process.exit(1); } });
