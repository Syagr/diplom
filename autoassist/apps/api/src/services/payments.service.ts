// services/payments.service.ts
import prisma from '@/utils/prisma.js';
import { stripe } from '@/utils/stripe.js';
import { generateReceiptForPayment } from '@/services/receipts.service.js';
import { enqueueEmailNotification } from '@/queues/index.js';

type Purpose = 'ADVANCE' | 'REPAIR' | 'INSURANCE';
type Provider = 'STRIPE' | 'LIQPAY';
type Role = 'admin' | 'service_manager' | 'dispatcher' | 'customer' | string;

type CreateInvoiceInput = {
  orderId: number;
  amount: number;              // major units
  purpose: Purpose;
  provider: Provider;          // сейчас поддерживаем STRIPE
  currency?: string;           // по умолчанию usd
};

const ZERO_DECIMAL = new Set<string>([
  // официально zero-decimal у Stripe — напр. JPY, KRW, VND, XOF, CLP и т.п.
  'bif','clp','djf','gnf','jpy','kmf','krw','mga','pyg','rwf','ugx','vnd','vuv','xaf','xof','xpf'
]);

function toMinor(amountMajor: number, currency: string) {
  const cur = currency.toLowerCase();
  return ZERO_DECIMAL.has(cur) ? Math.round(amountMajor) : Math.round(amountMajor * 100);
}

async function assertAllowedForOrder(userId: number, role: string, orderId: number) {
  // Staff or order owner (client)
  if (['admin', 'service_manager', 'dispatcher'].includes(String(role))) return;
  const order = await prisma.order.findUnique({
    where: { id: Number(orderId) },
    select: { clientId: true, client: { select: { users: { select: { id: true } } } } },
  });
  if (!order) {
    const e: any = new Error('ORDER_NOT_FOUND');
    e.status = 404;
    e.code = 'ORDER_NOT_FOUND';
    throw e;
  }
  const isOwner = order.client?.users?.some((u) => u.id === Number(userId));
  if (!isOwner) {
    const e: any = new Error('FORBIDDEN');
    e.status = 403;
    e.code = 'FORBIDDEN';
    throw e;
  }
}

function ensureOrderId(id: number) {
  if (!Number.isFinite(id) || id <= 0) {
    const e: any = new Error('INVALID_ORDER_ID');
    e.status = 400;
    throw e;
  }
}

function ensureAmount(a: number) {
  if (!Number.isFinite(a) || a <= 0) {
    const e: any = new Error('INVALID_AMOUNT');
    e.status = 400;
    throw e;
  }
}

export async function createInvoice(
  userId: number,
  role: Role,
  body: CreateInvoiceInput,
  idempotencyKey?: string
) {
  await assertAllowedForOrder(userId, String(role), Number(body.orderId));
  ensureOrderId(Number(body.orderId));
  ensureAmount(Number(body.amount));

  const order = await prisma.order.findUnique({
    where: { id: Number(body.orderId) },
    select: { id: true },
  });
  if (!order) {
    throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });
  }

  if (body.provider !== 'STRIPE') {
    const e: any = new Error('ONLY_STRIPE_IMPLEMENTED');
    e.status = 400;
    throw e;
  }

  const currency = (body.currency ?? 'usd').toLowerCase();

  // Idempotency: if there's a pending payment for same footprint, reuse it
  const existing = await prisma.payment.findFirst({
    where: {
      orderId: Number(body.orderId),
      provider: 'STRIPE',
      status: 'PENDING',
      amount: Number(body.amount),
      currency: currency.toUpperCase(),
    },
    orderBy: { id: 'desc' },
  });
  if (existing) {
    return { id: existing.id, invoiceUrl: existing.invoiceUrl, provider: 'STRIPE' as const, reused: true };
  }
  const amountMinor = toMinor(Number(body.amount), currency);

  // Используем client_reference_id и metadata для однозначной привязки
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    client_reference_id: `order:${body.orderId}:${body.purpose}`,
    line_items: [
      {
        price_data: {
          currency,
          product_data: { name: `Order #${body.orderId} — ${body.purpose}` },
          unit_amount: amountMinor,
        },
        quantity: 1,
      },
    ],
    success_url: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/payments/success?orderId=${body.orderId}`,
    cancel_url: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/payments/cancel?orderId=${body.orderId}`,
    metadata: {
      orderId: String(body.orderId),
      purpose: body.purpose,
      createdBy: String(userId),
    },
  }, idempotencyKey ? { idempotencyKey } : undefined);

  // Сохраняем payment
  const pay = await prisma.payment.create({
    data: {
      orderId: Number(body.orderId),
      amount: Number(body.amount),
      provider: 'STRIPE',
      method: 'CARD',
      status: 'PENDING',
      invoiceUrl: session.url ?? null,
      currency: currency.toUpperCase(),
      providerId: null, // заполним из вебхука (payment_intent)
    },
  });

  // Таймлайн
  await prisma.orderTimeline.create({
    data: {
      orderId: Number(body.orderId),
      event: 'Payment invoice created',
      details: {
        paymentId: pay.id,
        amount: Number(body.amount),
        currency,
        provider: 'STRIPE',
        sessionId: session.id,
      },
    },
  });

  return { id: pay.id, invoiceUrl: session.url, provider: 'STRIPE' as const };
}

/**
 * Обработчик Stripe events.
 * Ожидается, что роутер уже выполнил verify (stripe.webhooks.constructEvent) и передал сюда готовый `event`.
 * Идемпотентность обеспечивается таблицей webhookEvent(id UNIQUE).
 */
export async function handleStripeEvent(event: any) {
  if (!event || !event.id) return { ok: false };

  // Запишем входящий вебхук — если дубликат, аккуратно выйдем
  let duplicate = false;
  try {
    await prisma.webhookEvent.create({
      data: { id: String(event.id), type: event.type, payload: event },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // уже существует запись — продолжим обработку идемпотентно
      duplicate = true;
    } else {
      throw err;
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const orderId = Number(session.metadata?.orderId ?? 0);
        if (!orderId) break;

        // payment_intent в сессии
        const paymentIntentId = session.payment_intent ?? null;

        await prisma.$transaction(async (tx) => {
          // Находим последний PENDING payment по заказу ИЛИ по sessionId в payload
          const candidate = await tx.payment.findFirst({
            where: { orderId, provider: 'STRIPE', status: 'PENDING' },
            orderBy: { id: 'desc' },
          });

          if (!candidate) return;

          if ((candidate as any).status === 'COMPLETED') {
            return; // идемпотентность
          }

          // avoid unique conflict on (provider, providerId) across repeated test runs
          const desiredProviderId = paymentIntentId ?? session.id;
          let dataUpdate: any = { status: 'COMPLETED', completedAt: new Date() };
          if (desiredProviderId) {
            const existingByProviderId = await tx.payment.findFirst({
              where: { provider: 'STRIPE', providerId: desiredProviderId },
              orderBy: { id: 'desc' },
            });
            if (!existingByProviderId || existingByProviderId.id === candidate.id) {
              dataUpdate.providerId = desiredProviderId;
            }
          }

          await tx.payment.update({
            where: { id: candidate.id },
            data: dataUpdate,
          });

          // Двигаем заказ (бизнес-правило: оплата → APPROVED)
          await tx.order.update({
            where: { id: orderId },
            data: { status: 'APPROVED' },
          });

          await tx.orderTimeline.create({
            data: {
              orderId,
              event: 'Payment completed',
              details: { paymentId: candidate.id, providerId: paymentIntentId ?? session.id },
            },
          });

          await tx.webhookEvent.update({
            where: { id: String(event.id) },
            data: { handled: true },
          });
        });

        // Generate receipt asynchronously (no need to block webhook)
        const latest = await prisma.payment.findFirst({ where: { orderId, provider: 'STRIPE' }, orderBy: { id: 'desc' } });
        if (latest) {
          // In tests, await to make receipt timeline deterministic
          if (process.env.NODE_ENV === 'test') {
            await generateReceiptForPayment(Number(latest.id)).catch(() => {/* swallow */});
          } else {
            generateReceiptForPayment(Number(latest.id)).catch(() => {/* swallow */});
          }
          // Enqueue email notification
          enqueueEmailNotification({ type: 'payment_completed', orderId, paymentId: latest.id }).catch(() => {/* noop */});
        }

        return { ok: true };
      }

      case 'payment_intent.succeeded': {
        // На случай прямой доставки PI события (редко, но бывает)
        const pi = event.data.object as any;
        const paymentIntentId = pi.id;
        // Найти платёж с таким providerId или сессией, связанной с этим PI
        const payment =
          (await prisma.payment.findFirst({
            where: { provider: 'STRIPE', providerId: paymentIntentId },
          })) ?? null;

        if (payment && payment.status !== 'COMPLETED') {
          await prisma.$transaction(async (tx) => {
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: 'COMPLETED', completedAt: new Date() },
            });

            await tx.order.update({
              where: { id: payment.orderId },
              data: { status: 'APPROVED' },
            });

            await tx.orderTimeline.create({
              data: {
                orderId: payment.orderId,
                event: 'Payment completed',
                details: { paymentId: payment.id, providerId: paymentIntentId },
              },
            });

            await tx.webhookEvent.update({
              where: { id: String(event.id) },
              data: { handled: true },
            });
          });

          // async receipt + email (await in tests for determinism)
          if (process.env.NODE_ENV === 'test') {
            await generateReceiptForPayment(payment.id).catch(() => {/* noop */});
          } else {
            generateReceiptForPayment(payment.id).catch(() => {/* noop */});
          }
          enqueueEmailNotification({ type: 'payment_completed', orderId: payment.orderId, paymentId: payment.id }).catch(() => {/* noop */});
        }

        return { ok: true };
      }

      case 'checkout.session.expired': {
        const session = event.data.object as any;
        // Отметим последний pending как CANCELED, если найдём
        const orderId = Number(session.metadata?.orderId ?? 0);
        const candidate = await prisma.payment.findFirst({
          where: {
            orderId: orderId || undefined,
            provider: 'STRIPE',
            status: 'PENDING',
          },
          orderBy: { id: 'desc' },
        });
        if (candidate) {
          await prisma.payment.update({
            where: { id: candidate.id },
            data: { status: 'FAILED' },
          });
          await prisma.orderTimeline.create({
            data: {
              orderId: candidate.orderId,
              event: 'Payment failed',
              details: { paymentId: candidate.id },
            },
          });
        }
        return { ok: true };
      }

      default:
        return { ok: true, ignored: event.type };
    }
  } finally {
    // на всякий случай отметим обработку, если она ещё не помечена внутри транзакций
    try {
      await prisma.webhookEvent.update({
        where: { id: String(event.id) },
        data: { handled: true },
      });
    } catch {
      // ignore
    }
  }
}
