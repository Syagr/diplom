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
  comment?: string;
  packageName?: string;
  discountPercent?: number;
  summary?: string;
};

type CategoryTemplate = {
  summary: string;
  parts: { name: string; qty: number; unit: string; basePrice: number }[];
  labor: { name: string; hours: number }[];
  recommendations: string[];
};

const CATEGORY_TEMPLATES: Record<string, CategoryTemplate> = {
  engine: {
    summary: 'Engine diagnostics and repair',
    parts: [
      { name: 'Engine oil', qty: 4, unit: 'liter', basePrice: 140 },
      { name: 'Oil filter', qty: 1, unit: 'pcs', basePrice: 220 },
      { name: 'Spark plugs', qty: 4, unit: 'pcs', basePrice: 180 },
    ],
    labor: [
      { name: 'Engine diagnostics', hours: 2 },
      { name: 'Repair work', hours: 6 },
    ],
    recommendations: ['Check compression', 'Inspect belts and hoses'],
  },
  transmission: {
    summary: 'Transmission check and service',
    parts: [
      { name: 'Transmission fluid', qty: 6, unit: 'liter', basePrice: 160 },
      { name: 'Transmission filter', qty: 1, unit: 'pcs', basePrice: 260 },
    ],
    labor: [
      { name: 'Transmission diagnostics', hours: 2 },
      { name: 'Service and adjustments', hours: 5 },
    ],
    recommendations: ['Inspect clutch/torque converter', 'Check seals'],
  },
  electrical: {
    summary: 'Electrical diagnostics and wiring',
    parts: [
      { name: 'Wiring kit', qty: 1, unit: 'set', basePrice: 400 },
      { name: 'Fuse set', qty: 1, unit: 'set', basePrice: 160 },
    ],
    labor: [
      { name: 'Electrical diagnostics', hours: 2 },
      { name: 'Wiring repair', hours: 2 },
    ],
    recommendations: ['Test battery and alternator', 'Check grounding points'],
  },
  suspension: {
    summary: 'Suspension inspection and repair',
    parts: [
      { name: 'Shock absorber', qty: 2, unit: 'pcs', basePrice: 520 },
      { name: 'Control arm bushing', qty: 2, unit: 'pcs', basePrice: 180 },
    ],
    labor: [
      { name: 'Suspension diagnostics', hours: 2 },
      { name: 'Replacement work', hours: 3 },
    ],
    recommendations: ['Check wheel alignment', 'Inspect ball joints'],
  },
  brakes: {
    summary: 'Brake system maintenance',
    parts: [
      { name: 'Brake pads', qty: 1, unit: 'set', basePrice: 650 },
      { name: 'Brake fluid', qty: 1, unit: 'liter', basePrice: 220 },
    ],
    labor: [
      { name: 'Brake inspection', hours: 1 },
      { name: 'Pad replacement', hours: 2 },
    ],
    recommendations: ['Check brake discs', 'Test ABS system'],
  },
  other: {
    summary: 'General diagnostics and service',
    parts: [{ name: 'Consumables', qty: 1, unit: 'set', basePrice: 500 }],
    labor: [
      { name: 'General diagnostics', hours: 2 },
      { name: 'Repair work', hours: 2 },
    ],
    recommendations: ['Detailed inspection required'],
  },
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

export async function autoCalculateEstimate({
  orderId,
  profile,
  night,
  urgent,
  suv,
  comment,
  packageName,
  discountPercent: discountPercentRaw,
  summary,
}: CalcInput) {
  const order = await prisma.order.findUnique({ where: { id: Number(orderId) } });
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });

  // Try to load admin-defined profile from DB
  const dbProfile = await prisma.calcProfile.findFirst({ where: { code: profile, active: true } });

  const cat = (order.category || 'other').toLowerCase();
  const template = CATEGORY_TEMPLATES[cat] ?? CATEGORY_TEMPLATES.other;
  const baseParts = template.parts.reduce((acc, p) => acc + p.basePrice * p.qty, 0);
  const baseLaborHours = template.labor.reduce((acc, l) => acc + l.hours, 0);

  // Build coefficients
  const basePartsCoeff = dbProfile?.partsCoeff ?? PROFILE_COEFF[profile];
  const baseLaborCoeff = dbProfile?.laborCoeff ?? PROFILE_COEFF[profile];
  const nightK = night ? (dbProfile?.nightCoeff ?? NIGHT_COEFF) : 1.0;
  const urgentK = urgent ? (dbProfile?.urgentCoeff ?? URGENT_COEFF) : 1.0;
  const suvK = suv ? (dbProfile?.suvCoeff ?? SUV_COEFF) : 1.0;

  const coeffParts = basePartsCoeff * nightK * urgentK * suvK;
  const coeffLabor = baseLaborCoeff * nightK * urgentK * suvK;
  const laborRate = dbProfile?.laborRate ?? LABOR_RATE_FALLBACK;

  const partsLines = template.parts.map((p) => {
    const unitPrice = round2(p.basePrice * coeffParts);
    return {
      type: 'PART',
      name: p.name,
      qty: p.qty,
      unit: p.unit,
      unitPrice,
      total: round2(unitPrice * p.qty),
    };
  });
  const partsCost = round2(partsLines.reduce((acc, p) => acc + p.total, 0));
  const hoursMultiplier = suv ? 1.1 : 1.0;
  const laborRateWithCoeff = round2(laborRate * coeffLabor);
  const laborLines = template.labor.map((l) => {
    const hours = round2(l.hours * hoursMultiplier);
    return {
      type: 'LABOR',
      name: l.name,
      hours,
      rate: laborRateWithCoeff,
      total: round2(hours * laborRateWithCoeff),
    };
  });
  const laborHours = round2(laborLines.reduce((acc, l) => acc + l.hours, 0));
  const laborCost = round2(laborLines.reduce((acc, l) => acc + l.total, 0));
  const baseTotal = round2(partsCost + laborCost);
  const discountPercent = Math.max(0, Math.min(80, Number(discountPercentRaw ?? 0)));
  const discountAmount = round2(baseTotal * (discountPercent / 100));
  const total = round2(Math.max(0, baseTotal - discountAmount));

  const itemsJson = {
    items: partsLines,
    meta: {
      profile,
      coeffParts,
      coeffLabor,
      baseParts,
      baseLaborHours,
      laborRate,
      cat,
      summary: summary?.trim() ? summary.trim() : template.summary,
      recommendations: template.recommendations,
      flags: { night: !!night, urgent: !!urgent, suv: !!suv },
      dbProfileId: dbProfile?.id ?? null,
      totalBeforeDiscount: baseTotal,
      discountPercent,
      discountAmount,
      packageName: packageName?.trim() || null,
      comment: comment?.trim() || null,
    },
  };
  const laborJson = {
    lines: laborLines,
    meta: {
      profile,
      laborHours,
      baseLaborHours,
      coeffLabor,
      laborRate,
      laborCost,
      dbProfileId: dbProfile?.id ?? null,
    },
  };

  // Upsert estimate
  const estimate = await prisma.estimate.upsert({
    where: { orderId: order.id },
    update: { itemsJson, laborJson, total, currency: 'UAH', approved: false, approvedAt: null },
    create: { orderId: order.id, itemsJson, laborJson, total, currency: 'UAH', validUntil: new Date(Date.now() + 7 * 86400000) },
  });

  if (['NEW', 'TRIAGE'].includes(String(order.status))) {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'QUOTE' } });
    await prisma.orderTimeline.create({
      data: { orderId: order.id, event: 'Status changed to QUOTE', details: { reason: 'auto_estimate' } },
    });
  }

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
