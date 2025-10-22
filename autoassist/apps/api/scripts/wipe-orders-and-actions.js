#!/usr/bin/env node
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const dry = args.includes('--dry-run');

async function confirm() {
  if (yes) return true;
  const rl = readline.createInterface({ input, output });
  const a = await rl.question('⚠️ Wipe ALL orders and related data? Type "YES" to continue: ');
  rl.close();
  return a.trim() === 'YES';
}

async function main() {
  console.log(`🗑 wipe-orders-and-actions ${dry ? '(dry-run)' : ''}…`);
  if (!(await confirm())) {
    console.log('Cancelled.');
    return;
  }

  if (dry) {
    const count = await prisma.order.count();
    console.log(`Would wipe orders: ${count} (and related)`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.orderTimeline.deleteMany({});
    await tx.attachment.deleteMany({});
    await tx.payment.deleteMany({});
    await tx.towRequest.deleteMany({});
    await tx.insuranceOffer.deleteMany({});
    await tx.estimate.deleteMany({});
    await tx.orderLocation.deleteMany({});
    await tx.order.deleteMany({});
  });

  console.log('✅ wiped orders + related tables');
}

main()
  .catch((e) => { console.error('❌ wipe failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
