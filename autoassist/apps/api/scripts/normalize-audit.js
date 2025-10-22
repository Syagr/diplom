#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const has = (k) => args.includes(k);

function normalizePayload(p) {
  if (!p || typeof p !== 'object') return p;
  const q = { ...p };
  // Ensure numeric fields / Перетворимо на числа
  ['estimateId', 'orderId', 'approvedBy', 'rejectedBy', 'userId'].forEach(k => {
    if (k in q && q[k] != null) {
      const n = Number(q[k]);
      if (!Number.isNaN(n)) q[k] = n;
    }
  });
  return q;
}

async function main() {
  const dry = has('--dry-run');
  const limit = Number((args[args.indexOf('--limit')] && args[args.indexOf('--limit') + 1]) || 500);

  console.log(`🧭 normalize-audit: ${dry ? 'DRY RUN' : 'EXECUTE'}`);

  const rows = await prisma.auditEvent.findMany({
    orderBy: { createdAt: 'asc' },
    take: limit
  });

  let changed = 0;
  for (const r of rows) {
    const norm = normalizePayload(r.payload);
    const same = JSON.stringify(norm) === JSON.stringify(r.payload);
    if (same) continue;
    changed++;
    if (!dry) {
      await prisma.auditEvent.update({
        where: { id: r.id },
        data: { payload: norm }
      });
    }
  }
  console.log(`✅ normalized ${changed}/${rows.length}`);
}

main()
  .catch((e) => { console.error('❌ normalize-audit failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
