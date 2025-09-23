import { Router } from 'express';
import { z } from 'zod';
import {
  PresignUploadBody,
  PresignDownloadParams
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
attachmentsRouter.post('/presign-upload', async (req, res, next) => {
  try {
    const parsed = PresignUploadBody.parse(req.body);
    const { userId, role } = getAuth(req);
    const data = await presignUpload(userId, role, parsed);
    req.app.get('io')?.to(`order:${parsed.orderId}`).emit('attachment:presign', { id: data.attachmentId });
    res.status(201).json(data);
  } catch (e) { next(e); }
});

// POST /api/attachments/:id/complete
attachmentsRouter.post('/:id/complete', async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const { userId, role } = getAuth(req);
    const data = await completeUpload(userId, role, id);
    req.app.get('io')?.emit('attachment:ready', { id });
    res.json(data);
  } catch (e) { next(e); }
});

// GET /api/orders/:orderId/attachments
attachmentsRouter.get('/order/:orderId', async (req, res, next) => {
  try {
    const orderId = z.coerce.number().int().positive().parse(req.params.orderId);
    const { userId, role } = getAuth(req);
    const items = await listByOrder(userId, role, orderId);
    res.json({ items });
  } catch (e) { next(e); }
});

// GET /api/attachments/:id/presign
attachmentsRouter.get('/:id/presign', async (req, res, next) => {
  try {
    const { id } = PresignDownloadParams.parse(req.params as any);
    const { userId, role } = getAuth(req);
    const data = await presignDownload(userId, role, Number(id));
    res.json(data);
  } catch (e) { next(e); }
});

// DELETE /api/attachments/:id
attachmentsRouter.delete('/:id', async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const { userId, role } = getAuth(req);
    const data = await removeAttachment(userId, role, id);
    req.app.get('io')?.emit('attachment:removed', { id });
    res.json(data);
  } catch (e) { next(e); }
});