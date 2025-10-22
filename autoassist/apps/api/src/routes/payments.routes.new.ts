import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
// @ts-expect-error runtime resolve
import { createInvoice, onPaid } from '../services/payments.service.new.js';
import { verifyAndCompleteWeb3Payment } from '../services/web3payments.service.js';

export const payments = Router();

// ---- helpers ----
type AuthUser = { id: number; role?: string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const safeEmit = (req: Request, room: string, event: string, payload: unknown) => {
  const io = req.app?.get?.('io');
  if (io?.to) io.to(room).emit(event, payload);
};

// ---- validation ----
// сума у копійках/центах (рекомендовано) або у валютах — тут припустимо у валютах з обмеженням
const CreateInvoiceBody = z.object({
  orderId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().max(10_000_000), // верхній ліміт захисту
  currency: z.enum(['UAH', 'USD', 'EUR']).default('UAH'),
  // Align with service: only LIQPAY or STRIPE are supported in implementation (default LIQPAY)
  provider: z.enum(['LIQPAY', 'STRIPE']).default('LIQPAY'),
  // опційно: опис/метадані
  description: z.string().max(200).optional(),
});

// Мапа “сирого” webhook’а у нормалізовану подію провайдера робить сервіс `mapProviderEvent`,
// але тут додамо базову схему, якщо хочемо приймати прямо нормалізований payload.
const WebhookBody = z.object({
  provider: z.enum(['dummy', 'stripe', 'liqpay', 'fondy']),
  eventId: z.string().min(3),
  signature: z.string().min(8).optional(), // фактична перевірка йде у сервісі
  // нормалізована подія:
  kind: z.enum(['payment.succeeded', 'payment.failed', 'invoice.paid']).default('payment.succeeded'),
  data: z.object({
    orderId: z.coerce.number().int().positive(),
    paymentId: z.coerce.number().int().positive(),
    status: z.enum(['COMPLETED', 'FAILED']),
    amount: z.coerce.number().positive().optional(),
    currency: z.enum(['UAH', 'USD', 'EUR']).optional(),
  }),
});

// ---- middlewares ----
payments.use('/invoice', authenticate); // створення інвойсу лише для авторизованих

/**
 * POST /payments/invoice
 * Створити інвойс. Дозволено: owner order'у або staff.
 * Ідемпотентність через заголовок `Idempotency-Key` (опційно).
 */
payments.post('/invoice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const body = CreateInvoiceBody.parse(req.body);

    // сервіс всередині:
    // - авторизує: staff або order.clientId === user.id
    // - перевіряє стан order (напр., має бути APPROVED/READY)
    // - застосовує ідемпотентність за (orderId, amount, currency, idempotencyKey)
    const inv = await createInvoice({
      orderId: body.orderId,
      amount: body.amount,
      currency: body.currency,
      provider: body.provider,
      description: body.description,
      // idempotency is implemented internally via fingerprint and a time window
    });

    // можна віддати payment/checkout url
    return res.status(201).json({ payment: inv });
  } catch (e: any) {
    if (e.code === 'FORBIDDEN') return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    if (e.code === 'ORDER_NOT_FOUND') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    if (e.code === 'INVALID_STATE') return res.status(409).json({ error: { code: 'INVALID_STATE', message: 'Order state does not allow invoicing' } });
    if (e.code === 'IDEMPOTENT_REPLAY') return res.status(200).json({ payment: e.payment }); // повертаємо існуючий результат
    return next(e);
  }
});

/**
 * POST /payments/webhook
 * Прийом вебхуків від провайдерів. Має:
 *  - ПЕРЕВІРИТИ ПІДПИС/СЕКРЕТ
 *  - бути ідемпотентним (eventId)
 *  - швидко повертати 2xx, навіть якщо частину роботи виконує async (черги)
 *
 * ВАЖЛИВО: для провайдерів типу Stripe потрібно передавати "raw body" для перевірки підпису.
 * Підказка: додай у app middleware з express.raw для цього ендпоїнта (див. коментар у src/index.ts біля rawBodySaver).
 * Перевірку підписів виконуй у сервісі.
 */
payments.post('/webhook', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Якщо приходить сирий payload провайдера — нормалізуємо в сервісі:
    // const normalized = await mapProviderEvent({ headers: req.headers, rawBody: (req as any).rawBody });
    // Або очікуємо вже нормалізований body:
    const normalized = WebhookBody.parse(req.body);

    // сервіс всередині:
    // - verifySignature(headers, rawBody, normalized.provider)
    // - ensureEventNotProcessed(normalized.eventId)
    // - if COMPLETED => onPaid(orderId, paymentId)
    // - mark event processed
    if (normalized.data.status === 'COMPLETED') {
      const p = await onPaid(
        Number(normalized.data.orderId),
        Number(normalized.data.paymentId),
      );
      // інформуємо кімнату замовлення
      safeEmit(req, `order:${normalized.data.orderId}`, 'payment:status', {
        orderId: normalized.data.orderId,
        paymentId: p.id,
        status: p.status,
      });
    }

    // завжди 200/204, щоби провайдер не ретраїв зайве; помилки логуються в сервісі
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    // якщо підпис невірний — повертаємо 400/401, аби провайдер не повторював безкінечно
    if (e.code === 'INVALID_SIGNATURE') return res.status(401).json({ error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } });
    if (e.code === 'EVENT_REPLAYED') return res.status(200).json({ ok: true }); // ідемпотентність
    return next(e);
  }
});

export default payments;

// Extra: Web3 verification endpoint (optional, for MetaMask flow)
// POST /payments/web3/verify { orderId, paymentId, txHash }
payments.post('/web3/verify', async (req, res, next) => {
  try {
    const schema = z.object({
      orderId: z.coerce.number().int().positive(),
      paymentId: z.coerce.number().int().positive(),
      txHash: z.string().regex(/^0x([A-Fa-f0-9]{64})$/),
    });
    const body = schema.parse(req.body) as { orderId: number; paymentId: number; txHash: string };

    const p = await verifyAndCompleteWeb3Payment({ orderId: body.orderId, paymentId: body.paymentId, txHash: body.txHash });
    const io = req.app.get('io');
    io?.to(`order:${p.orderId}`).emit('payment:status', {
      orderId: p.orderId,
      paymentId: p.id,
      status: p.status,
      txHash: p.txHash,
    });
    return res.json({ payment: p });
  } catch (e) {
    return next(e);
  }
});
