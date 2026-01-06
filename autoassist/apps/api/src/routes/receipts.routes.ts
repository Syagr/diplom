import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '@/utils/prisma.js';
import { authenticate } from '@/middleware/auth.middleware.js';
import { presignDownload, getAttachmentStream } from '@/services/attachments.service.js';
import { generateReceiptForPayment } from '@/services/receipts.service.js';

const router = Router();

const IdParam = z.object({ id: z.coerce.number().int().positive() });

type AuthUser = { id: number; role?: string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const isStaff = (role?: string) => ['admin', 'manager', 'service_manager'].includes(String(role || '').toLowerCase());
const isMissingObject = (err: any) => {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  const status = Number(err?.status || 0);
  return (
    code === 'NoSuchKey' ||
    code === 'NotFound' ||
    code === 'OBJECT_MISSING' ||
    msg.includes('NoSuchKey') ||
    status === 404
  );
};

router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    let clientId: number | null = null;
    if (!isStaff(user.role)) {
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { clientId: true } });
      clientId = u?.clientId ?? user.id;
    }

    const receipts = await prisma.payment.findMany({
      where: {
        receiptUrl: { not: null },
        ...(clientId ? { order: { clientId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        amount: true,
        currency: true,
        createdAt: true,
        receiptUrl: true,
        order: { select: { clientId: true } },
      },
    });

    const list = receipts.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      amount: r.amount,
      currency: r.currency,
      createdAt: r.createdAt,
      url: null,
    }));

    return res.json(list);
  } catch (e) {
    return next(e);
  }
});

router.post('/:id/url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const { id } = IdParam.parse(req.params);
    let payment = await prisma.payment.findUnique({
      where: { id },
      include: { order: { select: { clientId: true } } },
    });
    if (!payment) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
    }

    if (!isStaff(user.role)) {
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { clientId: true } });
      const clientId = u?.clientId ?? user.id;
      if (payment.order?.clientId !== clientId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }
    }

    if (!payment.receiptUrl) {
      try {
        await generateReceiptForPayment(payment.id);
        payment = await prisma.payment.findUnique({
          where: { id },
          include: { order: { select: { clientId: true } } },
        });
      } catch (err) {
        return res.status(500).json({ error: { code: 'RECEIPT_GENERATION_FAILED', message: 'Failed to generate receipt' } });
      }
    }
    if (!payment?.receiptUrl) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Receipt not found' } });
    }

    const match = payment.receiptUrl.match(/\/api\/attachments\/(\d+)\/url/);
    if (!match) {
      return res.status(400).json({ error: { code: 'INVALID_RECEIPT_URL', message: 'Receipt URL is malformed' } });
    }

    const attachmentId = Number(match[1]);
    const data = await presignDownload(user.id, String(user.role ?? 'customer'), attachmentId);
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Surrogate-Control': 'no-store',
    });
    return res.json(data);
  } catch (e) {
    return next(e);
  }
});

router.get('/:id/file', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const { id } = IdParam.parse(req.params);
    let payment = await prisma.payment.findUnique({
      where: { id },
      include: { order: { select: { clientId: true } } },
    });
    if (!payment) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Payment not found' } });
    }

    if (!isStaff(user.role)) {
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { clientId: true } });
      const clientId = u?.clientId ?? user.id;
      if (payment.order?.clientId !== clientId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }
    }

    if (!payment.receiptUrl) {
      try {
        await generateReceiptForPayment(payment.id);
        payment = await prisma.payment.findUnique({
          where: { id },
          include: { order: { select: { clientId: true } } },
        });
      } catch (err) {
        return res.status(500).json({ error: { code: 'RECEIPT_GENERATION_FAILED', message: 'Failed to generate receipt' } });
      }
    }
    if (!payment?.receiptUrl) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Receipt not found' } });
    }

    const match = payment.receiptUrl.match(/\/api\/attachments\/(\d+)\/url/);
    if (!match) {
      return res.status(400).json({ error: { code: 'INVALID_RECEIPT_URL', message: 'Receipt URL is malformed' } });
    }

    const attachmentId = Number(match[1]);
    try {
      const data = await getAttachmentStream(user.id, String(user.role ?? 'customer'), attachmentId);
      res.set({
        'Content-Type': data.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${data.filename || 'receipt.pdf'}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Surrogate-Control': 'no-store',
      });
      data.stream.on('error', next);
      return data.stream.pipe(res);
    } catch (err: any) {
      if (!isMissingObject(err)) throw err;
      const regenerated = await generateReceiptForPayment(payment.id);
      const fresh = await getAttachmentStream(user.id, String(user.role ?? 'customer'), regenerated.attachmentId);
      res.set({
        'Content-Type': fresh.contentType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${fresh.filename || 'receipt.pdf'}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Surrogate-Control': 'no-store',
      });
      fresh.stream.on('error', next);
      return fresh.stream.pipe(res);
    }
  } catch (e) {
    return next(e);
  }
});

export default router;
