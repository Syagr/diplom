import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { createInvoice, handleStripeEvent } from '../services/payments.service.js';
import { verifyAndCompleteWeb3Payment } from '../services/web3payments.service.js';
import { stripe } from '../utils/stripe.js';
import { BadRequest } from '../utils/httpError.js';

export const paymentsRouter = Router();

// ---- helpers ----
type AuthUser = { id: number; role?: string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const safeEmit = (req: Request, room: string, event: string, payload: unknown) => {
  const io = req.app?.get?.('io');
  if (io?.to) io.to(room).emit(event, payload);
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
    const io = (req.app as any).get('io');
    io?.to(`order:${p.orderId}`).emit('payment:status', { orderId: p.orderId, paymentId: p.id, status: p.status, txHash: (p as any).txHash ?? null });
    return res.json({ payment: p });
  } catch (e) {
    return next(e);
  }
});
