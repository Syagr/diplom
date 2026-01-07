import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PaymentStatus } from '@prisma/client';
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

const RegenerateSchema = z.object({
  status: z.nativeEnum(PaymentStatus).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  onlyMissing: z.coerce.boolean().optional(),
});

router.post('/regenerate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    if (!isStaff(user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const { status, limit, onlyMissing } = RegenerateSchema.parse(req.body ?? {});
    const targetStatus = status ?? PaymentStatus.COMPLETED;
    const payments = await prisma.payment.findMany({
      where: {
        status: targetStatus,
        ...(onlyMissing ? { receiptUrl: null } : {}),
      },
      select: { id: true },
      take: limit ?? 200,
      orderBy: { createdAt: 'desc' },
    });

    const results: Array<{ paymentId: number; ok: boolean; error?: string }> = [];
    for (const p of payments) {
      try {
        await generateReceiptForPayment(p.id);
        results.push({ paymentId: p.id, ok: true });
      } catch (err: any) {
        results.push({ paymentId: p.id, ok: false, error: String(err?.message || err) });
      }
    }

    return res.json({
      total: payments.length,
      regenerated: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    return next(e);
  }
});

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

    // Always generate fresh link (no reuse)
    const fresh = await generateReceiptForPayment(payment.id, { skipUpload: true });
    const base64 = Buffer.from(fresh.pdfBytes).toString('base64');
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Surrogate-Control': 'no-store',
    });
    return res.json({
      url: `data:application/pdf;base64,${base64}`,
      inline: true,
      contentType: 'application/pdf',
    });
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

    // Always generate fresh and stream directly (no MinIO/attachment reuse)
    const generated = await generateReceiptForPayment(payment.id, { skipUpload: true });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="receipt_order-${payment.orderId ?? payment.id}_payment-${payment.id}.pdf"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Surrogate-Control': 'no-store',
    });
    return res.end(Buffer.from(generated.pdfBytes));
  } catch (e) {
    return next(e);
  }
});

export default router;
