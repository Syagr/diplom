#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const has = (k) => args.includes(k);

async function main() {
  const dry = has('--dry-run');

  console.log(`🧹 dedupe-audit: ${dry ? 'DRY RUN' : 'EXECUTE'}`);

  // Pick oldest to delete; keep the newest / Видаляємо старі, лишаємо найновіші
  const rows = await prisma.$queryRaw`
    with x as (
      select id, created_at, type,
             coalesce(payload->>'estimateId', payload->>'orderId') as key
      from audit_events
      where coalesce(payload->>'estimateId', payload->>'orderId') is not null
    ),
    g as (
      select type, key
      from x
      group by type, key
      having count(*) > 1
    )
    select e.id
    from audit_events e
    join g on g.type = e.type
         and g.key = coalesce(e.payload->>'estimateId', e.payload->>'orderId')
    where e.id not in (
      select id from (
        select id,
               row_number() over (
                 partition by type, coalesce(payload->>'estimateId', payload->>'orderId')
                 order by created_at desc
               ) as rn
        from audit_events
      ) t where t.rn = 1
    )
  `;

  console.log('Found duplicates to delete:', rows.length);
  if (!dry && rows.length) {
    const ids = rows.map(r => r.id);
    await prisma.$executeRaw`delete from audit_events where id = ANY(${ids})`;
    console.log('✅ Deleted:', ids.length);
  } else {
    console.log('ℹ️ Nothing deleted.');
  }
}

main()
  .catch((e) => { console.error('❌ dedupe-audit failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
