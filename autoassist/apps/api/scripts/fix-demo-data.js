#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');

async function reconcileOrderStatuses() {
  const orders = await prisma.order.findMany({
    include: { estimate: true }
  });

  let updates = 0;
  for (const o of orders) {
    let desired = o.status;
    if (o.estimate) {
      desired = o.estimate.approved ? 'APPROVED' : 'QUOTE';
    }
    if (desired !== o.status) {
      updates++;
      if (!dry) {
        await prisma.order.update({
          where: { id: o.id },
          data: { status: desired }
        });
      }
    }
  }
  return updates;
}

async function addMissingTimeline() {
  const orders = await prisma.order.findMany({
    include: { timeline: true }
  });
  let created = 0;
  for (const o of orders) {
    const hasCreate = o.timeline.some(t => t.event.includes('created'));
    if (!hasCreate) {
      created++;
      if (!dry) {
        await prisma.orderTimeline.create({
          data: { orderId: o.id, event: 'Order created (backfill)', details: { fix: true } }
        });
      }
    }
  }
  return created;
}

async function main() {
  console.log(`🛠 fix-demo-data ${dry ? '(dry-run)' : ''}…`);
  const u1 = await reconcileOrderStatuses();
  const u2 = await addMissingTimeline();
  console.log(`✅ status reconciled: ${u1}, timeline backfilled: ${u2}`);
}

main()
  .catch((e) => { console.error('❌ fix-demo-data failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
