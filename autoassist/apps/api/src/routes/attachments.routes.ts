import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../utils/httpError.js';
import { validate } from '../utils/validate.js';
import {
  PresignUploadBody,
  PresignDownloadParams,
  AttachmentIdParam
} from '../validators/attachments.schema.js';
import {
  presignUpload, completeUpload, presignDownload,
  listByOrder, removeAttachment
} from '../services/attachments.service.js';

export const attachmentsRouter = Router();
export default attachmentsRouter;

const getAuth = (req: any) => {
  const userId = Number(req.user?.id ?? 0);
  const role = String(req.user?.role ?? 'customer');
  return { userId, role };
};

// POST /api/attachments/presign-upload
attachmentsRouter.post('/presign-upload', validate(PresignUploadBody, 'body'), async (req, res, next) => {
  try {
    const parsed = req.body as any;
    const { userId, role } = getAuth(req);
    const data = await presignUpload(userId, role, parsed);
    req.app.get('io')?.to(`order:${parsed.orderId}`).emit('attachment:presign', { id: data.attachmentId });
    res.status(201).json(data);
  } catch (e: any) {
    if (e?.name === 'ZodError') return next(ValidationError(e.errors?.[0]?.message || 'Invalid body'));
    next(e);
  }
});

// POST /api/attachments/:id/complete
attachmentsRouter.post('/:id/complete', validate(AttachmentIdParam, 'params'), async (req, res, next) => {
  try {
    const id = (req.params as any).id;
    const { userId, role } = getAuth(req);
    const data = await completeUpload(userId, role, id);
    req.app.get('io')?.emit('attachment:ready', { id });
    res.json(data);
  } catch (e: any) {
    if (e?.name === 'ZodError') return next(ValidationError('Invalid attachment id'));
    next(e);
  }
});

// GET /api/orders/:orderId/attachments
attachmentsRouter.get('/order/:orderId', validate(z.object({ orderId: z.coerce.number().int().positive() }), 'params'), async (req, res, next) => {
  try {
    const orderId = (req.params as any).orderId;
    const { userId, role } = getAuth(req);
    const items = await listByOrder(userId, role, orderId);
    res.json({ items });
  } catch (e: any) {
    if (e?.name === 'ZodError') return next(ValidationError('Invalid order id'));
    next(e);
  }
});

// GET /api/attachments/:id/presign
attachmentsRouter.get('/:id/presign', validate(PresignDownloadParams, 'params'), async (req, res, next) => {
  try {
    const { id } = req.params as any;
    const { userId, role } = getAuth(req);
    const data = await presignDownload(userId, role, Number(id));
    res.json(data);
  } catch (e: any) {
    if (e?.name === 'ZodError') return next(ValidationError('Invalid attachment id'));
    next(e);
  }
});

// DELETE /api/attachments/:id
attachmentsRouter.delete('/:id', validate(AttachmentIdParam, 'params'), async (req, res, next) => {
  try {
    const id = (req.params as any).id;
    const { userId, role } = getAuth(req);
    const data = await removeAttachment(userId, role, id);
    req.app.get('io')?.emit('attachment:removed', { id });
    res.json(data);
  } catch (e: any) {
    if (e?.name === 'ZodError') return next(ValidationError('Invalid attachment id'));
    next(e);
  }
});