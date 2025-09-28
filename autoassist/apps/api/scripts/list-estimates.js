import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function list() {
  await prisma.$connect();
  try {
    const ests = await prisma.estimate.findMany({
      include: { order: { select: { id: true, status: true, clientId: true } } },
      orderBy: { id: 'asc' }
    });

    console.table(ests.map(e => ({ id: e.id, orderId: e.orderId, approved: e.approved, approvedAt: e.approvedAt ? e.approvedAt.toISOString() : null })));

    const audits = await prisma.auditEvent.findMany({ where: { type: { in: ['estimate:created','estimate:approved','estimate:rejected'] } }, orderBy: { createdAt: 'asc' } });
    console.log('\nAudit events (estimate-related):');
    for (const a of audits) {
      console.log(a.id, a.type, JSON.stringify(a.payload), 'userId=', a.userId, 'at=', a.createdAt.toISOString());
    }
  } catch (err) {
    console.error('Failed to list estimates', err);
  } finally {
    await prisma.$disconnect();
  }
}

list();
