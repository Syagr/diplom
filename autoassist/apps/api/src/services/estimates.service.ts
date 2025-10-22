// src/services/estimates.service.ts
import prisma from '../utils/prisma.js';
import { enqueueEmailNotification } from '@/queues/index.js';

export type ProfileCode = 'ECONOMY' | 'STANDARD' | 'PREMIUM';

export type CalcInput = {
  orderId: number;
  profile: ProfileCode;
  // modifiers
  night?: boolean;
  urgent?: boolean;
  suv?: boolean;
};

// Simple base matrix by order.category (fallback generic)
const BASE_PARTS_BY_CATEGORY: Record<string, number> = {
  engine: 2000,
  transmission: 1800,
  electrical: 900,
  suspension: 1100,
  body: 1500,
  generic: 1000,
};

const BASE_LABOR_BY_CATEGORY: Record<string, number> = {
  engine: 8,
  transmission: 7,
  electrical: 3,
  suspension: 4,
  body: 5,
  generic: 4,
};

// Hourly rate baseline (fallback)
const LABOR_RATE_FALLBACK = 400; // UAH/hour baseline

// Profile multipliers
const PROFILE_COEFF: Record<ProfileCode, number> = {
  ECONOMY: 0.9,
  STANDARD: 1.0,
  PREMIUM: 1.15,
};

// Modifiers
const NIGHT_COEFF = 1.1;
const URGENT_COEFF = 1.2;
const SUV_COEFF = 1.08;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function autoCalculateEstimate({ orderId, profile, night, urgent, suv }: CalcInput) {
  const order = await prisma.order.findUnique({ where: { id: Number(orderId) } });
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });

  // Try to load admin-defined profile from DB
  const dbProfile = await prisma.calcProfile.findFirst({ where: { code: profile, active: true } });

  const cat = (order.category || 'generic').toLowerCase();
  const baseParts = BASE_PARTS_BY_CATEGORY[cat] ?? BASE_PARTS_BY_CATEGORY['generic'];
  const baseLaborHours = BASE_LABOR_BY_CATEGORY[cat] ?? BASE_LABOR_BY_CATEGORY['generic'];

  // Build coefficients
  const basePartsCoeff = dbProfile?.partsCoeff ?? PROFILE_COEFF[profile];
  const baseLaborCoeff = dbProfile?.laborCoeff ?? PROFILE_COEFF[profile];
  const nightK = night ? (dbProfile?.nightCoeff ?? NIGHT_COEFF) : 1.0;
  const urgentK = urgent ? (dbProfile?.urgentCoeff ?? URGENT_COEFF) : 1.0;
  const suvK = suv ? (dbProfile?.suvCoeff ?? SUV_COEFF) : 1.0;

  const coeffParts = basePartsCoeff * nightK * urgentK * suvK;
  const coeffLabor = baseLaborCoeff * nightK * urgentK * suvK;
  const laborRate = dbProfile?.laborRate ?? LABOR_RATE_FALLBACK;

  const partsCost = round2(baseParts * coeffParts);
  const laborHours = Math.max(1, Math.round(baseLaborHours * (suv ? 1.1 : 1.0))); // example tweak
  const laborCost = round2(laborHours * laborRate * coeffLabor);
  const total = round2(partsCost + laborCost);

  const itemsJson = {
    items: [
      { type: 'PART', name: 'Parts & materials', qty: 1, unit: 'set', unitPrice: partsCost, total: partsCost },
    ],
    meta: { profile, coeffParts, coeffLabor, baseParts, cat, dbProfileId: dbProfile?.id ?? null },
  };
  const laborJson = {
    lines: [
      { type: 'LABOR', name: 'Labor hours', hours: laborHours, rate: laborRate * coeffLabor, total: laborCost },
    ],
    meta: { profile, laborHours, baseLaborHours, coeffLabor, laborRate, dbProfileId: dbProfile?.id ?? null },
  };

  // Upsert estimate
  const estimate = await prisma.estimate.upsert({
    where: { orderId: order.id },
    update: { itemsJson, laborJson, total, currency: 'UAH', approved: false, approvedAt: null },
    create: { orderId: order.id, itemsJson, laborJson, total, currency: 'UAH', validUntil: new Date(Date.now() + 7 * 86400000) },
  });

  await prisma.orderTimeline.create({
    data: {
      orderId: order.id,
      event: 'Estimate auto-calculated',
      details: { profile, coeffParts, coeffLabor, total, partsCost, laborCost, laborRate, dbProfileId: dbProfile?.id ?? null },
    },
  });

  return estimate;
}

export async function lockEstimate(orderId: number) {
  const order = await prisma.order.findUnique({ where: { id: Number(orderId) } });
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });
  const est = await prisma.estimate.update({ where: { orderId: order.id }, data: { approved: true, approvedAt: new Date() } });
  await prisma.orderTimeline.create({ data: { orderId: order.id, event: 'Estimate locked', details: { estimateId: est.id } } });
  // Notify via email
  enqueueEmailNotification({ type: 'estimate_locked', orderId: order.id, estimateId: est.id }).catch(() => {/* noop */});
  return est;
}
