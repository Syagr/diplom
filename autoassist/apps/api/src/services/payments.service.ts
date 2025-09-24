import prisma from '../utils/prisma.js';
import { stripe } from '../utils/stripe.js';

type CreateInvoiceInput = {
  orderId: number;
  amount: number; // in major units (e.g., dollars)
  purpose: 'ADVANCE'|'REPAIR'|'INSURANCE';
  provider: 'STRIPE'|'LIQPAY';
  currency?: string;
};

export async function createInvoice(userId: number, role: string, body: CreateInvoiceInput) {
  if (!['admin','service_manager','dispatcher'].includes(role)) {
    const e: any = new Error('FORBIDDEN'); e.status = 403; throw e;
  }

  const order = await prisma.order.findUnique({ where: { id: body.orderId } });
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });

  const currency = (body.currency || 'usd').toLowerCase();
  const amountMinor = Math.round(Number(body.amount) * (['jpy','krw'].includes(currency) ? 1 : 100));

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency,
        product_data: { name: `Order #${body.orderId} — ${body.purpose}` },
        unit_amount: amountMinor,
      },
      quantity: 1,
    }],
    success_url: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/payments/success?orderId=${body.orderId}`,
    cancel_url: `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/payments/cancel?orderId=${body.orderId}`,
    metadata: {
      orderId: String(body.orderId),
      purpose: body.purpose,
    },
  });

  const pay = await prisma.payment.create({
    data: {
      orderId: body.orderId,
      amount: body.amount,
      provider: 'STRIPE',
      status: 'PENDING',
      invoiceUrl: session.url ?? null,
      // store provider payload in a JSON-like field if exists
      // @ts-ignore
      providerPayload: { checkoutSessionId: session.id, currency },
      // @ts-ignore
      createdBy: userId,
    }
  });

  return { id: pay.id, invoiceUrl: session.url, provider: 'STRIPE' as const };
}

export async function handleStripeEvent(event: any) {
  if (!event || !event.id) return { ok: false };

  // Try to create webhook record — if it already exists, treat as duplicate and skip
  try {
    await prisma.webhookEvent.create({ data: { id: String(event.id), type: event.type, payload: event } });
  } catch (err: any) {
    // P2002 = unique constraint violation (already processed)
    if (err?.code === 'P2002') return { ok: true, duplicate: true };
    throw err;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    const orderId = Number(session.metadata?.orderId ?? 0);
    if (!orderId) return { ok: false };

    // Use a transaction to update payment + order atomically
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { orderId, provider: 'STRIPE' },
        orderBy: { id: 'desc' }
      });

      if (!payment) {
        // nothing to update for this order
        return;
      }

      // If already completed, skip
      if ((payment as any).status === 'COMPLETED') return;

      await tx.payment.update({
        where: { id: (payment as any).id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          providerId: session.payment_intent ?? session.id
        }
      });

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'APPROVED' }
      });

      // mark webhook event as handled
      await tx.webhookEvent.update({ where: { id: String(event.id) }, data: { handled: true } });
    });

    return { ok: true };
  }

  return { ok: true, ignored: event.type };
}
