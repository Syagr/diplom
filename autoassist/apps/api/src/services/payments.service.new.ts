// services/payments.service.ts
import prisma from '@/utils/prisma.js';
import { createCheckout, verifyWebhook } from '@/libs/liqpay.js'; // verifyWebhook: ожидается функция в твоём либе
import type { Prisma } from '@prisma/client';
import crypto from 'node:crypto';

type PaymentMethod = 'CARD' | 'BANK_TRANSFER' | 'CRYPTO';
type PaymentProvider = 'LIQPAY' | 'STRIPE';
type PaymentPurpose = 'ADVANCE' | 'REPAIR' | 'INSURANCE';
type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELED';


/**
 * Опции создания инвойса
 */
export interface CreateInvoiceOpts {
  orderId: number;
  amount: number;               // в валюте, целые UAH (или Decimal в схеме)
  method?: PaymentMethod;       // по умолчанию 'CARD'
  provider?: PaymentProvider;   // по умолчанию 'LIQPAY'
  currency?: string;            // по умолчанию 'UAH'
  purpose?: PaymentPurpose;     // назначение платежа
  description?: string | null;  // текст для провайдера
  idempotencyWindowMs?: number; // окно идемпотентности, по умолчанию 10 минут
}

/**
 * Создание инвойса (идемпотентно на время окна)
 */
export async function createInvoice(opts: CreateInvoiceOpts) {
  const {
    orderId,
    amount,
    method = 'CARD',
    provider = 'LIQPAY',
    currency = 'UAH',
    purpose = 'REPAIR',
    description = null,
    idempotencyWindowMs = 10 * 60 * 1000,
  } = opts;

  if (!Number.isFinite(Number(orderId)) || Number(orderId) <= 0) {
    throw Object.assign(new Error('INVALID_ORDER_ID'), { status: 400 });
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw Object.assign(new Error('INVALID_AMOUNT'), { status: 400 });
  }

  // убеждаемся, что заказ существует
  const order = await prisma.order.findUnique({ where: { id: Number(orderId) }, select: { id: true } });
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });

  // 1) проверяем недавний PENDING инвойс с тем же fingerprint (идемпотентность)
  const fingerprint = buildInvoiceFingerprint({ orderId, amount, currency, purpose });
  const recentPending = await prisma.payment.findFirst({
    where: {
      orderId: Number(orderId),
      status: 'PENDING',
      fingerprint,
      createdAt: { gte: new Date(Date.now() - idempotencyWindowMs) },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (recentPending) {
    return {
      payment: recentPending,
      reused: true,
    };
  }

  // 2) создаём чек-аут у провайдера
  if (provider !== 'LIQPAY') {
    throw Object.assign(new Error('ONLY_LIQPAY_IMPLEMENTED'), { status: 400, code: 'ONLY_LIQPAY_IMPLEMENTED' });
  }

  const checkout = await createCheckout({
    amount: Number(amount),
    orderId: Number(orderId),
    currency,
    description: description ?? buildDefaultDescription(purpose, Number(orderId)),
  });
  // ожидается, что createCheckout вернёт { url, providerRef? }
  const invoiceUrl = checkout.url;
  const providerRef = checkout.providerRef ?? null;

  // 3) сохраняем payment
  const payment = await prisma.payment.create({
    data: {
      orderId: Number(orderId),
      amount: Number(amount),
      currency,
      method,
      provider,
      purpose,
      description,
      status: 'PENDING',
      invoiceUrl,
      providerRef,
      fingerprint,
    } as Prisma.PaymentCreateInput,
  });

  // 4) таймлайн
  await prisma.orderTimeline.create({
    data: {
      orderId: Number(orderId),
      event: 'Payment invoice created',
      details: { amount: Number(amount), currency, purpose, provider, method, paymentId: payment.id },
    },
  });

  return { payment, reused: false };
}

/**
 * Обработчик успешной оплаты (без проверки подписи).
 * Лучше использовать handleProviderWebhook ниже.
 */
export async function onPaid(orderId: number, paymentId: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({ where: { id: Number(paymentId) } });
    if (!existing) throw Object.assign(new Error('PAYMENT_NOT_FOUND'), { status: 404 });

    if (existing.status === 'COMPLETED') {
      return existing; // идемпотентно
    }
    if (existing.orderId !== Number(orderId)) {
      throw Object.assign(new Error('ORDER_MISMATCH'), { status: 400 });
    }

    const updated = await tx.payment.update({
      where: { id: Number(paymentId) },
      data: { status: 'COMPLETED', paidAt: new Date() },
    });

    await tx.orderTimeline.create({
      data: {
        orderId: Number(orderId),
        event: 'Payment completed',
        details: { paymentId: updated.id, amount: Number(updated.amount), currency: updated.currency },
      },
    });

    // по желанию: двигать заказ по статусам (например, если требовалась предоплата)
    // await tx.order.update({ where: { id: Number(orderId) }, data: { status: 'READY' } });

    return updated;
  });
}

/**
 * Универсальный обработчик вебхука провайдера (LiqPay).
 * Передай raw body + headers, мы верифицируем и обновим payment.
 */
export async function handleProviderWebhook({ rawBody, headers }: { rawBody: string | Buffer; headers: Record<string, any> }) {
  // 1) верификация подписи от провайдера (если есть в либе)
  const verified = await safeVerifyWebhook(rawBody, headers);
  if (!verified.ok) {
    return { ok: false, error: 'INVALID_SIGNATURE' };
  }

  // 2) нормализуем полезную нагрузку
  const evt = verified.event as {
    order_id?: string | number;
    payment_id?: string | number;
    status?: string; // 'success' | 'failure' | 'reversed' ...
    amount?: number | string;
    provider_ref?: string;
  };

  const orderId = Number(evt.order_id);
  const providerRef = evt.provider_ref ?? null;

  // находим payment по providerRef или orderId+amount близкого PENDING
  let payment =
    (providerRef
      ? await prisma.payment.findFirst({ where: { providerRef } })
      : null) ??
    (Number.isFinite(orderId)
      ? await prisma.payment.findFirst({
          where: {
            orderId,
            status: 'PENDING',
          },
          orderBy: { createdAt: 'desc' },
        })
      : null);

  if (!payment) {
    return { ok: false, error: 'PAYMENT_NOT_FOUND' };
  }

  // 3) маппим статусы
  const normalized: PaymentStatus =
    evt.status === 'success'
      ? 'COMPLETED'
      : evt.status === 'failure' || evt.status === 'reversed'
      ? 'FAILED'
      : 'PENDING';

  if (payment.status === 'COMPLETED') {
    return { ok: true, payment, noop: true }; // идемпотентно
  }

  payment = await prisma.payment.update({
    where: { id: payment.id },
    data: { status: normalized, paidAt: normalized === 'COMPLETED' ? new Date() : payment.paidAt, providerRef: providerRef ?? payment.providerRef },
  });

  // 4) таймлайн
  await prisma.orderTimeline.create({
    data: {
      orderId: payment.orderId,
      event: normalized === 'COMPLETED' ? 'Payment completed' : normalized === 'FAILED' ? 'Payment failed' : 'Payment updated',
      details: { paymentId: payment.id, providerRef: payment.providerRef, status: payment.status, amount: Number(payment.amount) },
    },
  });

  // 5) оповещения/сокеты (если нужен io: req.app.get('io') в роутере)
  return { ok: true, payment };
}

// ========== Helpers ==========

function buildDefaultDescription(purpose: PaymentPurpose, orderId: number) {
  const map: Record<PaymentPurpose, string> = {
    ADVANCE: 'Передоплата за замовлення',
    REPAIR: 'Оплата ремонту',
    INSURANCE: 'Оплата страховки',
  };
  return `${map[purpose]} #${orderId}`;
}

function buildInvoiceFingerprint(input: { orderId: number; amount: number; currency: string; purpose: PaymentPurpose }) {
  const s = `${input.orderId}:${Number(input.amount)}:${input.currency}:${input.purpose}`;
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function safeVerifyWebhook(rawBody: string | Buffer, headers: Record<string, any>) {
  try {
    if (typeof verifyWebhook === 'function') {
      const event = await verifyWebhook(rawBody, headers);
      return { ok: true as const, event };
    }
    // если verifyWebhook не реализован — допускаем без проверки (НЕ для prod)
    return { ok: true as const, event: {} };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

// ========== Легаси-совместимость с твоей сигнатурой ==========

/**
 * Совместимая обёртка согласно твоему первоначальному API:
 *   createInvoice(orderId, amount, method?)
 */
export async function createInvoiceLegacy(orderId: number, amount: number, method: PaymentMethod = 'CARD') {
  const { payment } = await createInvoice({ orderId, amount, method });
  return payment;
}

/**
 * Совместимая обёртка:
 *   onPaid(orderId, paymentId)
 */
export async function onPaidLegacy(orderId: number, paymentId: number) {
  return onPaid(orderId, paymentId);
}
