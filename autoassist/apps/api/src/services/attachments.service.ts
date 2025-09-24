import prisma from '../utils/prisma.js';
import { minio, ATTACH_BUCKET, ensureBucket, buildObjectKey } from '../libs/minio.js';
import { previewsQ, cleanupQ } from '../queues/index.js';
import { PresignUploadBody } from '../validators/attachments.schema.js';
import { canReadOrder, canWriteAttachment } from '../utils/rbac.js';

const UPLOAD_TTL_SEC = 60 * 5; // 5 minutes
const DOWNLOAD_TTL_SEC = 60 * 10; // 10 minutes

export async function presignUpload(userId: number, role: string, body: PresignUploadBody) {
  await ensureBucket();

  const order = await prisma.order.findUnique({
    where: { id: body.orderId },
    select: { id: true, clientId: true } as any
  });
  if (!order) throw new Error('ORDER_NOT_FOUND');

  if (!canWriteAttachment(role as any, userId, order.clientId)) {
    const err: any = new Error('FORBIDDEN');
    err.status = 403;
    throw err;
  }

  const objectKey = buildObjectKey(body.orderId, body.fileName);

  const putUrl = await minio.presignedPutObject(ATTACH_BUCKET, objectKey, UPLOAD_TTL_SEC);

  const attachment = await prisma.attachment.create({
    data: {
      orderId: body.orderId,
      type: body.kind as any,
      objectKey,
      contentType: body.contentType,
      size: body.size,
      status: 'pending',
      meta: body.meta ?? {},
      createdBy: userId,
      filename: body.fileName
    },
    select: { id: true, objectKey: true }
  });

  return { attachmentId: attachment.id, putUrl, objectKey };
}

export async function completeUpload(userId: number, role: string, attachmentId: number) {
  const att = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { order: { select: { clientId: true, id: true } } } as any
  });
  if (!att) throw new Error('ATTACHMENT_NOT_FOUND');

  if (!canWriteAttachment(role as any, userId, att.order?.clientId)) {
    const err: any = new Error('FORBIDDEN');
    err.status = 403;
    throw err;
  }

  if (att.status === 'ready') return { ok: true };

  // ensure object exists
  await minio.statObject(ATTACH_BUCKET, att.objectKey ?? '');

  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { status: 'ready' }
  });
  // enqueue preview generation
  try { await previewsQ.add('make-preview', { attachmentId }, { attempts: 3, removeOnComplete: 100, removeOnFail: 200 }); } catch (e) { /* swallow */ }
  return { ok: true };
}

export async function presignDownload(userId: number, role: string, attachmentId: number) {
  const att = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { order: { select: { clientId: true, id: true } } } as any
  });
  if (!att) throw new Error('ATTACHMENT_NOT_FOUND');

  if (!canReadOrder(role as any, userId, att.order?.clientId)) {
    const err: any = new Error('FORBIDDEN');
    err.status = 403;
    throw err;
  }

  if (att.status !== 'ready') {
    const err: any = new Error('ATTACHMENT_NOT_READY');
    err.status = 409;
    throw err;
  }

  const key = att.objectKey ?? att.url ?? '';
  const url = await minio.presignedGetObject(ATTACH_BUCKET, key, DOWNLOAD_TTL_SEC);
  return { url };
}

export async function listByOrder(userId: number, role: string, orderId: number) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, clientId: true } as any
  });
  if (!order) throw new Error('ORDER_NOT_FOUND');

  if (!canReadOrder(role as any, userId, order.clientId)) {
    const err: any = new Error('FORBIDDEN');
    err.status = 403;
    throw err;
  }

  return prisma.attachment.findMany({
    where: { orderId, status: { in: ['pending', 'ready'] } },
    orderBy: { createdAt: 'desc' }
  });
}

export async function removeAttachment(userId: number, role: string, attachmentId: number) {
  const att = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { order: { select: { clientId: true, id: true } } } as any
  });
  if (!att) return { ok: true };

  if (!canWriteAttachment(role as any, userId, att.order?.clientId)) {
    const err: any = new Error('FORBIDDEN');
    err.status = 403;
    throw err;
  }

  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { removedAt: new Date(), status: 'removed' }
  });

  // schedule cleanup of object from storage
  try {
    const delayDays = Number(process.env.ATTACH_CLEANUP_AFTER_DAYS || 7);
    const delayMs = delayDays * 24 * 60 * 60 * 1000;
    if (att.objectKey) {
      await cleanupQ.add('cleanup-object', { objectKey: att.objectKey, attachmentId: att.id }, { delay: delayMs, attempts: 3, removeOnComplete: 100, removeOnFail: 200 });
    }
  } catch (e) { /* swallow */ }

  return { ok: true };
}