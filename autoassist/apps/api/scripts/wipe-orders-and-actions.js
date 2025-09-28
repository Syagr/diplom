import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function summary() {
  await prisma.$connect();
  try {
    const counts = {};
    counts.orders = await prisma.order.count();
    counts.estimates = await prisma.estimate.count();
    counts.timelines = await prisma.orderTimeline.count();
    counts.locations = await prisma.orderLocation.count();
    counts.attachments = await prisma.attachment.count();
    counts.payments = await prisma.payment.count();
    counts.towRequests = await prisma.towRequest.count();

    // audit events referencing orders/estimates
    const auditCountRaw = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int as cnt FROM audit_events WHERE (payload->>'orderId') IS NOT NULL OR (payload->>'estimateId') IS NOT NULL`
    );
    counts.auditEvents = (Array.isArray(auditCountRaw) && auditCountRaw[0] && auditCountRaw[0].cnt) ? Number(auditCountRaw[0].cnt) : 0;

    console.log('Database counts (will be removed if confirmed):');
    console.table(counts);
    return counts;
  } finally {
    await prisma.$disconnect();
  }
}

async function wipe() {
  await prisma.$connect();
  try {
    console.log('Deleting order timelines...');
    await prisma.orderTimeline.deleteMany();

    console.log('Deleting estimates...');
    await prisma.estimate.deleteMany();

    console.log('Deleting order locations...');
    await prisma.orderLocation.deleteMany();

    console.log('Deleting attachments...');
    await prisma.attachment.deleteMany();

    console.log('Deleting payments...');
    await prisma.payment.deleteMany();

    console.log('Deleting tow requests...');
    await prisma.towRequest.deleteMany();

    console.log('Deleting orders...');
    await prisma.order.deleteMany();

    console.log('Deleting audit events referencing orders/estimates...');
    await prisma.$executeRawUnsafe(
      `DELETE FROM audit_events WHERE (payload->>'orderId') IS NOT NULL OR (payload->>'estimateId') IS NOT NULL`
    );

    console.log('Wipe complete');
  } catch (err) {
    console.error('Wipe failed', err);
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const counts = await summary();

  const confirmed = process.env.WIPE_CONFIRM === '1' || process.argv.includes('--yes');
  if (!confirmed) {
    console.log('To actually perform the wipe, re-run with `--yes` or set environment variable WIPE_CONFIRM=1');
    process.exit(0);
  }

  console.log('Confirmation detected — running wipe now.');
  await wipe();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
