import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
// removed: ValidationError (was unused)
import { validate } from '../middleware/validate.js';
import {
  PresignUploadBody,
  AttachmentIdParam,
} from '../validators/attachments.schema.js';
import {
  presignUpload,
  completeUpload,
  uploadDirect,
  getAttachmentStream,
  presignDownload,
  listByOrder,
  removeAttachment,
} from '../services/attachments.service.js';

export const attachmentsRouter = Router();
export default attachmentsRouter;

type ReqUser = { id?: number | string; role?: string };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.ATTACH_MAX_BYTES || 50 * 1024 * 1024) },
});

/** UA: Дістаємо userId/role з req.user; EN: Extract userId/role from req.user */
const getAuth = (req: any) => {
  const u = (req.user || {}) as ReqUser;
  const userId = Number(u.id ?? 0);
  const role = String(u.role ?? 'customer');
  return { userId, role };
};

/** UA: Стандартні anti-cache заголовки для short-lived URL; EN: No-store for short-lived URLs */
function setNoStore(res: any) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
}

/** POST /api/attachments/presign-upload */
attachmentsRouter.post(
  '/presign-upload',
  validate({ body: PresignUploadBody }),
  async (req, res, next) => {
    try {
      const parsed = req.body as z.infer<typeof PresignUploadBody>;
      const { userId, role } = getAuth(req);

      const data = await presignUpload(userId, role, parsed);

      // UA: нотифікуємо кімнату замовлення; EN: notify order room
      req.app.get('io')?.to(`order:${parsed.orderId}`).emit('attachment:presign', {
        id: data.attachmentId,
      });

      setNoStore(res);
      return res.status(201).json(data);
    } catch (e: any) {
      return next(e);
    }
  },
);

/** POST /api/attachments/upload */
attachmentsRouter.post(
  '/upload',
  upload.single('file'),
  async (req, res, next) => {
    try {
      const { userId, role } = getAuth(req);
      const orderId = Number(req.body?.orderId ?? 0);
      const kind = String(req.body?.kind ?? '');
      const file = req.file as Express.Multer.File | undefined;
      if (!orderId || !Number.isFinite(orderId)) {
        return res.status(400).json({ error: { code: 'INVALID_ORDER_ID', message: 'orderId is required' } });
      }
      if (!file) {
        return res.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'file is required' } });
      }

      const data = await uploadDirect(
        userId,
        role,
        { orderId, kind },
        {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        },
      );

      req.app.get('io')?.to(`order:${orderId}`).emit('attachment:ready', { id: data.attachmentId });
      setNoStore(res);
      return res.status(201).json(data);
    } catch (e: any) {
      return next(e);
    }
  },
);

/** POST /api/attachments/:id/complete */
attachmentsRouter.post(
  '/:id/complete',
  validate({ params: AttachmentIdParam }),
  async (req, res, next) => {
    try {
  const id = Number((req.params as any).id);
      const { userId, role } = getAuth(req);

      const data = await completeUpload(userId, role, id);

      // UA: глобальний сигнал + (опц.) кімната замовлення, якщо сервіс поверне orderId
      // EN: global signal + (opt.) order room if service returns orderId
      const io = req.app.get('io');
      io?.emit('attachment:ready', { id });
      if ((data as any)?.orderId) {
        io?.to(`order:${(data as any).orderId}`).emit('attachment:ready', {
          id,
          orderId: (data as any).orderId,
        });
      }

      setNoStore(res);
      return res.json(data);
    } catch (e: any) {
      return next(e);
    }
  },
);

/** GET /api/attachments/order/:orderId */
attachmentsRouter.get(
  '/order/:orderId',
  validate({ params: z.object({ orderId: z.coerce.number().int().positive() }) }),
  async (req, res, next) => {
    try {
      const orderId = Number((req.params as any).orderId);
      const { userId, role } = getAuth(req);
      const items = await listByOrder(userId, role, orderId);
      // UA: вкладення не кешуємо; EN: do not cache the list
      setNoStore(res);
      return res.json({ items });
    } catch (e: any) {
      return next(e);
    }
  },
);

/** GET /api/attachments/:id/file */
attachmentsRouter.get(
  '/:id/file',
  validate({ params: AttachmentIdParam }),
  async (req, res, next) => {
    try {
      const id = Number((req.params as any).id);
      const { userId, role } = getAuth(req);
      const data = await getAttachmentStream(userId, role, id);
      const inlineTypes = ['application/pdf'];
      const isInline = String(data.contentType || '').startsWith('image/') || inlineTypes.includes(String(data.contentType || ''));
      res.set({
        'Content-Type': data.contentType || 'application/octet-stream',
        'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename="${data.filename || 'file'}"`,
      });
      setNoStore(res);
      data.stream.on('error', next);
      return data.stream.pipe(res);
    } catch (e: any) {
      return next(e);
    }
  },
);

/** GET /api/attachments/:id/presign */
attachmentsRouter.get(
  '/:id/presign',
  validate({ params: AttachmentIdParam }),
  async (req, res, next) => {
    try {
  const id = Number((req.params as any).id);
      const { userId, role } = getAuth(req);
      const data = await presignDownload(userId, role, id);
      setNoStore(res);
      return res.json(data);
    } catch (e: any) {
      return next(e);
    }
  },
);

/** GET /api/attachments/:id/url — fresh presigned GET URL (no-store) */
attachmentsRouter.get(
  '/:id/url',
  validate({ params: AttachmentIdParam }),
  async (req, res, next) => {
    try {
      const id = Number((req.params as any).id);
      const { userId, role } = getAuth(req);
      const data = await presignDownload(userId, role, id);
      setNoStore(res);
      return res.json(data);
    } catch (e: any) {
      return next(e);
    }
  },
);

/** DELETE /api/attachments/:id */
attachmentsRouter.delete(
  '/:id',
  validate({ params: AttachmentIdParam }),
  async (req, res, next) => {
    try {
  const id = Number((req.params as any).id);
      const { userId, role } = getAuth(req);
      const data = await removeAttachment(userId, role, id);

      const io = req.app.get('io');
      io?.emit('attachment:removed', { id });
      if ((data as any)?.orderId) {
        io?.to(`order:${(data as any).orderId}`).emit('attachment:removed', {
          id,
          orderId: (data as any).orderId,
        });
      }

      return res.json(data);
    } catch (e: any) {
      return next(e);
    }
  },
);
