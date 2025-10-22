// services/insurance.service.ts
import prisma from '@/utils/prisma.js';

type RuleCtx = {
  category: string;
  vehicleYear?: number;
  mileage?: number;
  repeatIssues?: number;
};

type OfferSpec = { code: string; title: string; price: number; currency: 'UAH' | 'USD' | 'EUR' };

const CURRENCY: OfferSpec['currency'] = 'UAH';

// Базові тарифні правила
function buildOfferRules(ctx: RuleCtx): OfferSpec[] {
  const offers: OfferSpec[] = [];

  // Підбір за категорією інциденту
  if (/glass|скло|стекло/i.test(ctx.category)) {
    offers.push({ code: 'KASKO_GLASS', title: 'КАСКО: Скло', price: 2500, currency: CURRENCY });
  }
  if (/dtp|дтп|collision/i.test(ctx.category)) {
    offers.push({ code: 'TPL_PLUS', title: 'ОСЦПВ + розширене', price: 1800, currency: CURRENCY });
  }

  // Додаємо асистанс усім
  offers.push({ code: 'ROAD_ASSIST', title: 'Road Assistance', price: 1200, currency: CURRENCY });

  // Вік/пробіг — механічні поломки
  const age = ctx.vehicleYear ? new Date().getFullYear() - ctx.vehicleYear : 0;
  if (age >= 12 || (ctx.mileage ?? 0) > 200_000) {
    offers.push({ code: 'MECH_BREAK', title: 'Поломки (старі авто)', price: 3200, currency: CURRENCY });
  }

  // Лояльність (опційна знижка)
  if ((ctx.repeatIssues ?? 0) >= 2) {
    // застосуй -10% на всі пропозиції
    return offers.map(o => ({ ...o, price: Math.round(o.price * 0.9) }));
  }

  return offers;
}

// Допоміжний хеш правил для ідемпотентності генерації (не використовується наразі)

// Expose function-style API expected by routes
export async function generateOffers(orderId: number, _actor?: { id: number; role?: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: Number(orderId) }, include: { vehicle: true } });
    if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { code: 'ORDER_NOT_FOUND', status: 404 });

    const ctx: RuleCtx = {
      category: order.category,
      vehicleYear: order.vehicle?.year ?? undefined,
      mileage: order.vehicle?.mileage ?? undefined,
      repeatIssues: undefined,
    };

    const specs = buildOfferRules(ctx);

    const existingCodes = new Set(
      (
        await tx.insuranceOffer.findMany({ where: { orderId: Number(orderId) }, select: { code: true } })
      ).map((x) => x.code)
    );

    const toCreate = specs.filter((s) => !existingCodes.has(s.code));

    const created = await Promise.all(
      toCreate.map((s) =>
        tx.insuranceOffer.create({
          data: {
            orderId: Number(orderId),
            code: s.code,
            title: s.title,
            price: s.price,
            // currency is not in InsuranceOffer schema; we keep price only
            status: 'OFFERED',
          },
        })
      )
    );

    await tx.orderTimeline.create({
      data: { orderId: Number(orderId), event: 'Insurance offers generated', details: { count: created.length, codes: created.map((c) => c.code) } },
    });

    const offers = await tx.insuranceOffer.findMany({ where: { orderId: Number(orderId), status: { in: ['OFFERED', 'ACCEPTED'] } }, orderBy: { id: 'desc' } });
    return offers;
  });
}

export async function acceptOffer(offerId: number, _actor?: { id: number; role?: string }) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.insuranceOffer.findUnique({ where: { id: Number(offerId) } });
    if (!target) throw Object.assign(new Error('OFFER_NOT_FOUND'), { code: 'OFFER_NOT_FOUND', status: 404 });
    const orderId = target.orderId;

    if (target.status === 'ACCEPTED') return target;

    const accepted = await tx.insuranceOffer.update({ where: { id: Number(offerId) }, data: { status: 'ACCEPTED', activatedAt: new Date() } });
    await tx.insuranceOffer.updateMany({ where: { orderId, status: { in: ['OFFERED'] }, NOT: { id: Number(offerId) } }, data: { status: 'DECLINED' } });
    await tx.orderTimeline.create({ data: { orderId, event: 'Insurance offer accepted', details: { offerId: accepted.id, code: accepted.code, price: accepted.price } } });
    return accepted;
  });
}

export async function getClientPolicies(clientId: number) {
  const offers = await prisma.insuranceOffer.findMany({
    where: { status: 'ACCEPTED', order: { clientId: Number(clientId) } },
    include: { order: { select: { id: true, category: true, createdAt: true } } },
    orderBy: { activatedAt: 'desc' },
  });

  return offers.map((o) => ({
    policyId: o.id,
    orderId: o.orderId,
    code: o.code,
    title: o.title,
    price: Number(o.price),
    acceptedAt: o.activatedAt ?? null,
    order: o.order,
  }));
}

export default { generateOffers, acceptOffer, getClientPolicies };
