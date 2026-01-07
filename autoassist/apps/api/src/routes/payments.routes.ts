import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { authenticate } from '../middleware/auth.middleware.js';
import { createInvoice, handleStripeEvent } from '../services/payments.service.js';
import { verifyAndCompleteWeb3Payment } from '../services/web3payments.service.js';
import { stripe } from '../utils/stripe.js';
import { BadRequest } from '../utils/httpError.js';
import prisma from '@/utils/prisma.js';
import { generateReceiptForPayment } from '@/services/receipts.service.js';
import { enqueueEmailNotification } from '@/queues/index.js';
import type { Prisma } from '@prisma/client';

export const paymentsRouter = Router();

// ---- helpers ----
type AuthUser = { id: number; role?: string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const isStaff = (role?: string) => ['admin', 'service_manager', 'dispatcher', 'manager'].includes(String(role || '').toLowerCase());
const safeEmit = (req: Request, room: string, event: string, payload: unknown) => {
  const io = req.app?.get?.('io');
  if (io?.to) io.to(room).emit(event, payload);
};
const audit = async (type: string, payload: Prisma.InputJsonValue, userId?: number | string | null) => {
  try {
    await prisma.auditEvent.create({ data: { type, payload, userId: userId != null ? Number(userId) : null } });
  } catch {
    /* non-fatal */
  }
};
const advanceOrderAfterPayment = async (orderId: number) => {
  const order = await prisma.order.findUnique({ where: { id: Number(orderId) }, select: { id: true, status: true } });
  if (!order) return;
  const current = String(order.status);
  if (['SCHEDULED', 'INSERVICE', 'READY', 'DELIVERED', 'CLOSED', 'CANCELLED'].includes(current)) return;
  const nextStatus = 'SCHEDULED';
  await prisma.order.update({ where: { id: order.id }, data: { status: nextStatus } });
  await prisma.orderTimeline.create({
    data: {
      orderId: order.id,
      event: `Status changed to ${nextStatus}`,
      details: { reason: 'payment_completed' },
    },
  });
};

// ---- validation ----
// Рекомендація: оперувати **мінорними** одиницями (копійки/центи). Якщо у вас мажорні — лишаємо як є.
const CreateInvoiceBody = z.object({
  orderId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().max(10_000_000),
  purpose: z.enum(['ADVANCE','REPAIR','INSURANCE']),
  provider: z.enum(['LIQPAY','STRIPE']).default('STRIPE'),
  currency: z.enum(['UAH','USD','EUR']).default('UAH'),
  description: z.string().max(200).optional(),
});

const DemoPayBody = z.object({
  orderId: z.coerce.number().int().positive(),
  // demo всегда 0 — оставляем поле, но игнорируем значение
  amount: z.coerce.number().nonnegative().max(10_000_000).optional(),
  currency: z.enum(['UAH','USD','EUR']).default('UAH'),
});

const DemoInitBody = z.object({
  orderId: z.coerce.number().int().positive(),
  amount: z.coerce.number().nonnegative().max(10_000_000).optional(),
  currency: z.enum(['UAH','USD','EUR']).default('UAH'),
});

paymentsRouter.use('/invoice', authenticate);

/**
 * POST /payments/invoice
 * Створює платіжний інвойс. Дозволено: власник order або staff.
 * Підтримує ідемпотентність через заголовок `Idempotency-Key`.
 */
paymentsRouter.post('/invoice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return next(BadRequest('UNAUTHORIZED'));

  const body = CreateInvoiceBody.parse(req.body);

    if (body.provider !== 'STRIPE') {
      return next(BadRequest('ONLY_STRIPE_IMPLEMENTED'));
    }

    // createInvoice має всередині робити:
    // - RBAC: staff || user.id === order.clientId
    // - перевірити стан order (напр., QUOTE/APPROVED/READY)
    // - застосувати ідемпотентність за (orderId, amount, currency, purpose, idempotencyKey)
    const data = await createInvoice(
      Number(user.id),
      String(user.role ?? 'dispatcher'),
      {
        orderId: body.orderId,
        amount: body.amount,
        currency: body.currency,
        purpose: body.purpose,
        provider: body.provider,
        // description опционально — можно передать через body, но сервис его не принимает сейчас
      },
      req.get('Idempotency-Key') || undefined
    );

    // (опційно) еміт події
    safeEmit(req, `order:${body.orderId}`, 'payment:created', {
      orderId: body.orderId,
      amount: body.amount,
      currency: body.currency,
      purpose: body.purpose,
    });

    return res.status(201).json(data);
  } catch (e: any) {
    // узгоджені помилки сервісу
    if (e.code === 'FORBIDDEN') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    if (e.code === 'ORDER_NOT_FOUND') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    if (e.code === 'INVALID_STATE') return res.status(409).json({ error: { code: 'INVALID_STATE', message: 'Order state does not allow invoicing' } });
    if (e.code === 'IDEMPOTENT_REPLAY') return res.status(200).json(e.payload ?? { ok: true });
    return next(e);
  }
});

/**
 * POST /payments/demo/complete
 * Demo-only payment completion without external providers.
 */
paymentsRouter.post('/demo/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const body = DemoPayBody.parse(req.body);
    const order = await prisma.order.findUnique({
      where: { id: Number(body.orderId) },
      select: { id: true, clientId: true, estimate: { select: { approved: true } } },
    });
    if (!order) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    if (!order.estimate?.approved) {
      return res.status(409).json({ error: { code: 'ESTIMATE_NOT_APPROVED', message: 'Estimate must be approved before payment' } });
    }

    if (!isStaff(user.role)) {
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { clientId: true } });
      if (!u?.clientId || u.clientId !== order.clientId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }
    }

    const pay = await prisma.payment.create({
      data: {
        orderId: Number(body.orderId),
        amount: 0,
        currency: body.currency,
        provider: 'STRIPE',
        method: 'CARD',
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    void audit('payment:success', {
      paymentId: pay.id,
      orderId: pay.orderId,
      provider: 'DEMO',
      mode: 'demo/complete',
      amount: 0,
      currency: body.currency,
    }, user.id);

    await prisma.orderTimeline.create({
      data: {
        orderId: Number(body.orderId),
        event: 'Payment completed (demo)',
        details: { paymentId: pay.id, amount: 0, currency: body.currency },
      },
    });

    await advanceOrderAfterPayment(Number(body.orderId));

    let receipt: any = null;
    let receiptError: string | null = null;
    try {
      receipt = await generateReceiptForPayment(pay.id);
    } catch (err: any) {
      receiptError = String(err?.message || 'Failed to generate receipt');
    }
    enqueueEmailNotification({ type: 'payment_completed', orderId: Number(body.orderId), paymentId: pay.id }).catch(() => {});

    const updated = await prisma.payment.findUnique({ where: { id: pay.id } });
    safeEmit(req, `order:${body.orderId}`, 'payment:status', {
      orderId: Number(body.orderId),
      paymentId: pay.id,
      status: updated?.status ?? 'COMPLETED',
    });

    return res.json({ payment: updated, receipt, receiptError });
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /payments/demo/init
 * Create a demo pending payment for Web3 verification.
 */
paymentsRouter.post('/demo/init', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const body = DemoInitBody.parse(req.body);
    const order = await prisma.order.findUnique({
      where: { id: Number(body.orderId) },
      select: { id: true, clientId: true, estimate: { select: { approved: true } } },
    });
    if (!order) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    if (!order.estimate?.approved) {
      return res.status(409).json({ error: { code: 'ESTIMATE_NOT_APPROVED', message: 'Estimate must be approved before payment' } });
    }

    if (!isStaff(user.role)) {
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { clientId: true } });
      if (!u?.clientId || u.clientId !== order.clientId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }
    }

    const pay = await prisma.payment.create({
      data: {
        orderId: Number(body.orderId),
        amount: Number(body.amount),
        currency: body.currency,
        provider: 'LIQPAY',
        method: 'CRYPTO',
        status: 'PENDING',
      },
    });

    void audit('payment:init', {
      paymentId: pay.id,
      orderId: pay.orderId,
      provider: 'DEMO',
      mode: 'demo/init',
      amount: Number(body.amount),
      currency: body.currency,
    }, user.id);

    await prisma.orderTimeline.create({
      data: {
        orderId: Number(body.orderId),
        event: 'Payment initialized (demo)',
        details: { paymentId: pay.id, amount: 0, currency: body.currency },
      },
    });

    safeEmit(req, `order:${body.orderId}`, 'payment:created', {
      orderId: Number(body.orderId),
      paymentId: pay.id,
      status: pay.status,
    });

    const demoTxHash = `0x${randomBytes(32).toString('hex')}`;
    return res.json({ payment: pay, demoTxHash });
  } catch (e) {
    return next(e);
  }
});

/**
 * Stripe webhook обробник як **чиста функція**.
 * ВАЖЛИВО: для перевірки підпису треба raw body. Налаштуй у сервері:
 *   app.post('/payments/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler)
 * (не використовуйте JSON-парсер на цьому шляху, інакше перевірка підпису зламається)
 */
export function stripeWebhookHandler(req: Request & { rawBody?: Buffer }, res: Response, next: NextFunction) {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig || Array.isArray(sig)) return next(BadRequest('SIGNATURE_MISSING'));

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return next(BadRequest('WEBHOOK_SECRET_MISSING'));

    // NOTE: req.rawBody має містити сирий payload (Buffer). Збережи його в попередньому middleware.
    const raw = (req as any).rawBody || (req as any).body; // fallback якщо вже налаштовано
    const event = stripe.webhooks.constructEvent(raw, sig as string, secret);

    // handleStripeEvent має бути ідемпотентним (event.id), і має швидко повертати результат
    handleStripeEvent(event)
      .then((result) => {
        // Stripe чекає 2xx — не затягуємо відповідь (важкі роботи краще у чергу).
        res.status(200).json(result ?? { received: true });
      })
      .catch(next);
  } catch (e) {
    return next(e);
  }
}

export default paymentsRouter;

/**
 * POST /payments/web3/verify
 * Верификация web3-транзакции (txHash) и завершение платежа.
 */
paymentsRouter.post('/web3/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      orderId: z.coerce.number().int().positive(),
      paymentId: z.coerce.number().int().positive(),
      txHash: z.string().regex(/^0x([A-Fa-f0-9]{64})$/),
    }).parse(req.body);

    const p = await verifyAndCompleteWeb3Payment({ orderId: body.orderId, paymentId: body.paymentId, txHash: body.txHash });
    await advanceOrderAfterPayment(p.orderId);
    const io = (req.app as any).get('io');
    io?.to(`order:${p.orderId}`).emit('payment:status', { orderId: p.orderId, paymentId: p.id, status: p.status, txHash: (p as any).txHash ?? null });
    void audit('payment:success', {
      paymentId: p.id,
      orderId: p.orderId,
      provider: 'WEB3',
      txHash: body.txHash,
      mode: 'web3/verify',
    }, undefined);
    return res.json({ payment: p });
  } catch (e) {
    return next(e);
  }
});
