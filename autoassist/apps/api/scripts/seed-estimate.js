#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 seed-estimate…');
  const orderId = Number(process.argv[2] || 0);
  if (!orderId) {
    console.error('Usage: node scripts/seed-estimate.js <orderId>');
    process.exit(2);
  }

  const exists = await prisma.estimate.findUnique({ where: { orderId } });
  if (exists) {
    console.log('ℹ️ estimate already exists for order', orderId, '→ id:', exists.id);
    return;
  }

  const est = await prisma.estimate.create({
    data: {
      orderId,
      itemsJson: { parts: [{ name: 'Стартер', price: 8500, qty: 1 }] },
      laborJson: { tasks: [{ name: 'Замена', hours: 2, rate: 800 }] },
      total: 10100,
      currency: 'UAH',
      validUntil: new Date(Date.now() + 7 * 86400000)
    }
  });

  await prisma.order.update({
    where: { id: orderId },
    data: { status: 'QUOTE' }
  });

  await prisma.orderTimeline.create({
    data: { orderId, event: 'Estimate created (seed)', details: { estimateId: est.id } }
  });

  console.log('✅ estimate id:', est.id);
}

main()
  .catch((e) => { console.error('❌ seed-estimate failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
