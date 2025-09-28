import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  try {
    const rows = await prisma.auditEvent.findMany({ orderBy: { createdAt: 'asc' } });
    console.log('Audit events count:', rows.length);
    for (const r of rows) {
      console.log(r.id, r.type, JSON.stringify(r.payload), 'userId=' + r.userId, r.createdAt);
    }
  } catch (err) {
    console.error('Error querying audit events:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
