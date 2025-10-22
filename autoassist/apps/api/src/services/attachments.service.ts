import prisma from '../utils/prisma.js';
const p: any = prisma;
import { minio, ATTACH_BUCKET, ensureBucket, buildObjectKey } from '../libs/minio.js';
import { previewsQ, cleanupQ } from '../queues/index.js';
import { PresignUploadBody } from '../validators/attachments.schema.js';
import { canReadOrder, canWriteAttachment } from '../utils/rbac.js';
import { AttachmentType } from '@prisma/client';

// --- constants & helpers ---
const UPLOAD_TTL_SEC = 60 * 5;   // 5 minutes
const DOWNLOAD_TTL_SEC = 60 * 10; // 10 minutes
const MAX_UPLOAD_BYTES = Number(process.env.ATTACH_MAX_BYTES || 50 * 1024 * 1024); // 50MB default

const STATUS = { PENDING: 'pending', READY: 'ready', REMOVED: 'removed' } as const;

const ALLOWED_TYPES: Record<string, { type: AttachmentType; mimes: string[] }> = {
  document: { type: AttachmentType.DOCUMENT, mimes: ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'] },
  photo:    { type: AttachmentType.PHOTO,    mimes: ['image/jpeg','image/png','image/webp','image/heic'] },
  image:    { type: AttachmentType.PHOTO,    mimes: ['image/jpeg','image/png','image/webp','image/heic'] },
  video:    { type: AttachmentType.VIDEO,    mimes: ['video/mp4','video/webm','video/quicktime'] },
  audio:    { type: AttachmentType.AUDIO,    mimes: ['audio/mpeg','audio/aac','audio/wav','audio/ogg'] },
};

function httpError(code: string, status = 400, message?: string) {
  const err: any = new Error(message || code);
  err.code = code; err.status = status;
  return err;
}

function sanitizeFilename(name: string): string {
  // прибери шляхи, контрольні символи; обмеж довжину
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/[/\\]/g, '_').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 120);
  return base || 'file';
}

function pickAttachmentType(rawKind?: string, contentType?: string): { type: AttachmentType, validMime: boolean } {
  const key = (rawKind ?? 'document').toString().toLowerCase();
  const entry = ALLOWED_TYPES[key] || ALLOWED_TYPES['document'];
  const valid = contentType ? entry.mimes.includes(contentType) : true; // якщо MIME невідомий — не валимо, але краще валідувати
  return { type: entry.type, validMime: valid };
}

// --- API ---

export async function presignUpload(userId: number, role: string, body: PresignUploadBody) {
  await ensureBucket();

  const order = await p.order.findUnique({
    where: { id: body.orderId },
    select: { id: true, clientId: true } as any,
  });
  if (!order) throw httpError('ORDER_NOT_FOUND', 404);

  if (!canWriteAttachment(role as any, userId, order.clientId)) {
    throw httpError('FORBIDDEN', 403);
  }

  // basic payload checks
  if (!body.fileName || typeof body.fileName !== 'string') throw httpError('INVALID_FILENAME', 400);
  const fileName = sanitizeFilename(body.fileName);
  const size = Number(body.size ?? 0);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) {
    throw httpError('FILE_TOO_LARGE', 413, `Max ${MAX_UPLOAD_BYTES} bytes`);
  }

  const contentType = String(body.contentType ?? '');
  const { type: attachmentType, validMime } = pickAttachmentType(body.kind as any, contentType);
  if (contentType && !validMime) {
    throw httpError('UNSUPPORTED_MEDIA_TYPE', 415, `Invalid content-type: ${contentType}`);
  }

  const objectKey = buildObjectKey(body.orderId, fileName);

  // optional idempotency: if same objectKey exists and not removed – reuse
  const existing = await p.attachment.findFirst({
    where: { orderId: body.orderId, objectKey, status: { in: [STATUS.PENDING, STATUS.READY] } },
    select: { id: true, status: true, objectKey: true },
  });
  if (existing) {
    // вертаємо новий PUT на той самий ключ (для повторної спроби)
    const putUrl = await minio.presignedPutObject(ATTACH_BUCKET, objectKey, UPLOAD_TTL_SEC);
    return { id: existing.id, attachmentId: existing.id, putUrl, objectKey: existing.objectKey };
  }

  const putUrl = await minio.presignedPutObject(ATTACH_BUCKET, objectKey, UPLOAD_TTL_SEC);

  const attachment = await p.attachment.create({
    data: {
      orderId: body.orderId,
      type: attachmentType,
      objectKey,
      contentType,
      size,
      status: STATUS.PENDING,
      meta: (body.meta && typeof body.meta === 'object') ? body.meta : {},
      createdBy: userId,
      filename: fileName,
      url: '', // не зберігаємо короткоживучі GET
    },
    select: { id: true, objectKey: true },
  });

  return { id: attachment.id, attachmentId: attachment.id, putUrl, objectKey: attachment.objectKey };
}

export async function completeUpload(userId: number, role: string, attachmentId: number) {
  const att = await p.attachment.findUnique({
    where: { id: attachmentId },
    include: { order: { select: { clientId: true, id: true } } } as any,
  });
  if (!att) throw httpError('ATTACHMENT_NOT_FOUND', 404);

  if (!canWriteAttachment(role as any, userId, att.order?.clientId)) {
    throw httpError('FORBIDDEN', 403);
  }

  if (att.status === STATUS.READY) return { ok: true, id: attachmentId, objectKey: att.objectKey };

  // ensure object exists in MinIO
  try {
    await minio.statObject(ATTACH_BUCKET, att.objectKey ?? '');
  } catch (e: any) {
    // minio client кидає помилки з code 'NotFound' / statusCode 404
    return Promise.reject(httpError('OBJECT_MISSING', 404, 'Uploaded object not found in storage'));
  }

  await p.attachment.update({ where: { id: attachmentId }, data: { status: STATUS.READY } });

  // enqueue preview generation (best-effort)
  try {
    await previewsQ.add('make-preview', { attachmentId }, { attempts: 3, removeOnComplete: 100, removeOnFail: 200 });
  } catch { /* swallow */ }

  return { ok: true, id: attachmentId, objectKey: att.objectKey };
}

export async function presignDownload(userId: number, role: string, attachmentId: number) {
  const att = await p.attachment.findUnique({
    where: { id: attachmentId },
    include: { order: { select: { clientId: true, id: true } } } as any,
  });
  if (!att) throw httpError('ATTACHMENT_NOT_FOUND', 404);

  if (!canReadOrder(role as any, userId, att.order?.clientId)) {
    throw httpError('FORBIDDEN', 403);
  }

  if (att.status !== STATUS.READY) {
    throw httpError('ATTACHMENT_NOT_READY', 409);
  }

  const key = att.objectKey ?? att.url ?? '';
  const url = await minio.presignedGetObject(ATTACH_BUCKET, key, DOWNLOAD_TTL_SEC);
  return { url };
}

export async function listByOrder(userId: number, role: string, orderId: number) {
  const order = await p.order.findUnique({
    where: { id: orderId },
    select: { id: true, clientId: true } as any,
  });
  if (!order) throw httpError('ORDER_NOT_FOUND', 404);

  if (!canReadOrder(role as any, userId, order.clientId)) {
    throw httpError('FORBIDDEN', 403);
  }

  return p.attachment.findMany({
    where: { orderId, status: { in: [STATUS.PENDING, STATUS.READY] } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function removeAttachment(userId: number, role: string, attachmentId: number) {
  const att = await p.attachment.findUnique({
    where: { id: attachmentId },
    include: { order: { select: { clientId: true, id: true } } } as any,
  });
  if (!att) return { ok: true };

  if (!canWriteAttachment(role as any, userId, att.order?.clientId)) {
    throw httpError('FORBIDDEN', 403);
  }

  if (att.status === STATUS.REMOVED) return { ok: true }; // idempotent

  await p.attachment.update({
    where: { id: attachmentId },
    data: { removedAt: new Date(), status: STATUS.REMOVED },
  });

  // schedule cleanup of object from storage
  try {
    const delayDays = Number(process.env.ATTACH_CLEANUP_AFTER_DAYS || 7);
    const delayMs = delayDays * 24 * 60 * 60 * 1000;
    if (att.objectKey) {
      await cleanupQ.add('cleanup-object', { objectKey: att.objectKey, attachmentId: att.id }, { delay: delayMs, attempts: 3, removeOnComplete: 100, removeOnFail: 200 });
    }
  } catch { /* swallow */ }

  return { ok: true };
}
