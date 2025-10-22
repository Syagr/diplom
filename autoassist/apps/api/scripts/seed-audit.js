#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 seed-audit…');

  const now = new Date();
  const base = [
    { type: 'estimate:created', payload: { orderId: 1, estimateId: 1001, total: 12345 } },
    { type: 'estimate:approved', payload: { orderId: 1, estimateId: 1001, approvedBy: 1 } },
    { type: 'order:status', payload: { orderId: 1, from: 'QUOTE', to: 'APPROVED' } }
  ];

  for (const e of base) {
    await prisma.auditEvent.create({
      data: { type: e.type, payload: e.payload, createdAt: now }
    });
  }

  console.log('✅ audit events inserted:', base.length);
}

main()
  .catch((e) => { console.error('❌ seed-audit failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
