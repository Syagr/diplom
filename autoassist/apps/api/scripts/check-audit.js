#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Mask DATABASE_URL in logs / Маскуємо DATABASE_URL у логах
const mask = (u) => (u || '(not set)').replace(/:\/\/.+?:.+?@/, '://***:***@');

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const get = (k, def) => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};

async function main() {
  console.log('🔎 check-audit: start');
  console.log('DB:', mask(process.env.DATABASE_URL));

  const sinceDays = Number(get('--since', '30')); // days back / днів назад
  const limit = Number(get('--limit', '200'));
  const verbose = has('--verbose');

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  // Count by type
  const byType = await prisma.auditEvent.groupBy({
    by: ['type'],
    where: { createdAt: { gte: since } },
    _count: { _all: true }
  });

  console.table(byType.map(r => ({ type: r.type, count: r._count._all })));

  // Recent sample
  const recent = await prisma.auditEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  console.log(`🧾 recent events (<= ${limit}) since ${since.toISOString()}:`, recent.length);

  // Duplicates heuristic: (type, payload.estimateId) or (type, payload.orderId)
  const dups = await prisma.$queryRaw`
    with x as (
      select id, type,
             (payload->>'estimateId') as estimateId,
             (payload->>'orderId') as orderId
      from audit_events
      where created_at >= ${since}
    ), g as (
      select type, coalesce(estimateId, orderId) as key, count(*) c
      from x
      group by type, coalesce(estimateId, orderId)
      having count(*) > 1 and coalesce(estimateId, orderId) is not null
    )
    select * from g order by c desc
  `;
  console.log('🧩 duplicate groups (by type & estimateId/orderId):', dups?.length || 0);
  if (verbose && dups?.length) console.table(dups);

  console.log('✅ check-audit: done');
}

main()
  .catch((e) => { console.error('❌ check-audit failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
