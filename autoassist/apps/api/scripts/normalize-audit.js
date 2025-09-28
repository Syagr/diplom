import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function normalize() {
  try {
    await prisma.$connect();
    console.log('Connected to DB');

    // Find duplicate audit events for estimate-related types and dedupe (keep earliest)
    const dupQuery = `
      SELECT type, (payload->>'estimateId')::int as estimateId, array_agg(id ORDER BY "createdAt" ASC) as ids
      FROM audit_events
      WHERE (payload->>'estimateId') IS NOT NULL
      AND type IN ('estimate:created','estimate:approved','estimate:rejected')
      GROUP BY type, (payload->>'estimateId')::int
      HAVING COUNT(*) > 1
    `;

    const raws = await prisma.$queryRawUnsafe(dupQuery);
    if (Array.isArray(raws) && raws.length > 0) {
      for (const row of raws) {
        const ids = row.ids || [];
        const keep = ids[0];
        const toDelete = ids.slice(1);
        if (toDelete.length > 0) {
          console.log(`Deduping ${row.type} for estimate ${row.estimateid}, deleting ${toDelete.length} entries`);
          await prisma.auditEvent.deleteMany({ where: { id: { in: toDelete } } });
        }
      }
    } else {
      console.log('No duplicates found for estimate-related audit events');
    }

    // Ensure a single estimate:created and estimate:approved for estimate 1
    const hasCreated = await prisma.auditEvent.findFirst({ where: { type: 'estimate:created', AND: [{ payload: { path: ['estimateId'], equals: '1' } }] } }).catch(()=>null);
    const hasApproved = await prisma.auditEvent.findFirst({ where: { type: 'estimate:approved', AND: [{ payload: { path: ['estimateId'], equals: '1' } }] } }).catch(()=>null);

    if (!hasCreated) {
      console.log('Inserting estimate:created for estimate 1');
      await prisma.auditEvent.create({ data: { type: 'estimate:created', payload: { total: 1000, orderId: 101, estimateId: 1 }, userId: 1 } });
    }
    if (!hasApproved) {
      console.log('Inserting estimate:approved for estimate 1');
      await prisma.auditEvent.create({ data: { type: 'estimate:approved', payload: { estimateId: 1, approvedBy: 1 }, userId: 1 } });
    }

    // Insert a demo rejected event (estimateId 999) to show a not-approved flow
    const hasRejectedDemo = await prisma.auditEvent.findFirst({ where: { type: 'estimate:rejected', AND: [{ payload: { path: ['estimateId'], equals: '999' } }] } }).catch(()=>null);
    if (!hasRejectedDemo) {
      console.log('Inserting demo estimate:rejected for estimate 999');
      await prisma.auditEvent.create({ data: { type: 'estimate:rejected', payload: { estimateId: 999, rejectedBy: 1, reason: 'Demo rejection' }, userId: 1 } });
    }

    console.log('Normalization complete');
  } catch (err) {
    console.error('Error normalizing audit', err);
  } finally {
    await prisma.$disconnect();
  }
}

normalize();
