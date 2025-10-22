#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const get = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

async function main() {
  console.log('📋 list-estimates…');

  const approved = has('--approved') ? true : (has('--pending') ? false : undefined);
  const clientId = get('--client', undefined) ? Number(get('--client')) : undefined;
  const orderId = get('--order', undefined) ? Number(get('--order')) : undefined;
  const limit = Number(get('--limit', '50'));

  const where = {
    ...(approved !== undefined ? { approved } : {}),
    ...(clientId ? { order: { clientId } } : {}),
    ...(orderId ? { orderId } : {})
  };

  const list = await prisma.estimate.findMany({
    where,
    include: {
      order: {
        select: { id: true, status: true, clientId: true }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  console.table(list.map(e => ({
    id: e.id,
    orderId: e.orderId,
    approved: e.approved,
    total: Number(e.total),
    currency: e.currency,
    validUntil: e.validUntil.toISOString(),
    orderStatus: e.order?.status
  })));

  console.log('✅ total:', list.length);
}

main()
  .catch((e) => { console.error('❌ list-estimates failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
