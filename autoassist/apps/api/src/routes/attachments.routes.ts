import { Router } from 'express';
import { z } from 'zod';
import { createPresignedPut, saveAttachment } from '../services/attachments.service';
import { ensureBucket } from '../libs/minio';

export const attachments = Router();

attachments.post('/presign', async (req, res, next) => {
  try {
    const body = z.object({ orderId: z.number(), mime: z.string(), type: z.enum(['photo','video','doc']) }).parse(req.body);
    await ensureBucket();
    const { url, objectName } = await createPresignedPut(body.orderId, body.mime);
    res.json({ uploadUrl: url, objectName });
  } catch (e) { next(e); }
});

attachments.post('/', async (req, res, next) => {
  try {
    const body = z.object({ orderId: z.number(), objectName: z.string(), type: z.enum(['photo','video','doc']), meta: z.any().optional() }).parse(req.body);
    const att = await saveAttachment(body.orderId, body.objectName, body.type, body.meta);
    req.app.get('io').to(`order:${body.orderId}`).emit('attachment:added', { id: att.id, type: att.type });
    res.status(201).json({ attachment: att });
  } catch (e) { next(e); }
});