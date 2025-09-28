import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function dedupe() {
  try {
    // Find duplicates grouped by payload->>'estimateId' for estimate:approved
    const raws = await prisma.$queryRaw`
      SELECT (payload->>'estimateId')::int as estimateId, array_agg(id ORDER BY "createdAt" ASC) as ids
      FROM audit_events
      WHERE type = 'estimate:approved'
      GROUP BY (payload->>'estimateId')::int
      HAVING COUNT(*) > 1;
    `;

    if (!Array.isArray(raws) || raws.length === 0) {
      console.log('No duplicate estimate approval audit events found.');
      return;
    }

    for (const row of raws) {
      const ids = row.ids;
      // keep the first (earliest), delete the rest
      const toDelete = ids.slice(1);
      console.log(`Estimate ${row.estimateid} has duplicates, deleting ${toDelete.length} entries`);
      await prisma.auditEvent.deleteMany({ where: { id: { in: toDelete } } });
    }

    console.log('Deduplication complete');
  } catch (err) {
    console.error('Failed to dedupe audit events', err);
  } finally {
    await prisma.$disconnect();
  }
}

// Run immediately when executed
dedupe();
