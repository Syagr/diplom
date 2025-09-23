import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

type RuleCtx = { category: string; vehicleYear?: number; mileage?: number; repeatIssues?: number };

function rules(ctx: RuleCtx) {
  const offers: { code:string; title:string; price:number }[] = [];
  // Базовая логика: под стекло/ДТП/техпомощь + возраст/пробег
  if (/glass|стекло/i.test(ctx.category)) offers.push({ code:'KASKO_GLASS', title:'КАСКО: Скло', price: 2500 });
  if (/dtp|ДТП|collision/i.test(ctx.category)) offers.push({ code:'TPL_PLUS', title:'ОСЦПВ + розширене', price: 1800 });
  offers.push({ code:'ROAD_ASSIST', title:'Road Assistance', price: 1200 });

  const age = ctx.vehicleYear ? (new Date().getFullYear() - ctx.vehicleYear) : 0;
  if (age >= 12 || (ctx.mileage ?? 0) > 200_000) offers.push({ code:'MECH_BREAK', title:'Поломки (старі авто)', price: 3200 });

  // скидка за "аккуратность" можно применить позже
  return offers;
}

export async function generateOffers(orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vehicle: true } });
  if (!order) throw new Error('ORDER_NOT_FOUND');

  const ctx: RuleCtx = { category: order.category, vehicleYear: order.vehicle?.year ?? undefined, mileage: order.vehicle?.mileage ?? undefined };
  const offs = rules(ctx);

  // сохраняем только новые
  const created = [];
  for (const o of offs) {
    const ins = await prisma.insuranceOffer.create({
      data: { orderId, code: o.code, title: o.title, price: o.price, status: 'OFFERED' }
    });
    created.push(ins);
  }
  return created;
}

export async function acceptOffer(offerId: number) {
  return prisma.insuranceOffer.update({ where: { id: offerId }, data: { status: 'ACCEPTED' } });
}