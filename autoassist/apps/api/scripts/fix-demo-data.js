import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    await prisma.$connect();
    console.log('Connected');

    // Fix audit events payloads
    const audits = await prisma.auditEvent.findMany({ orderBy: { createdAt: 'asc' } });
    for (const a of audits) {
      const p = a.payload || {};
      let changed = false;
      const newPayload = { ...p };

      if (a.type === 'estimate:created') {
        if (p?.estimateId === 1 || p?.orderId === 101) {
          newPayload.total = 1000;
          newPayload.orderId = 101;
          newPayload.estimateId = 1;
          newPayload.note = 'Seeded estimate creation';
          changed = true;
        }
      }

      if (a.type === 'estimate:approved') {
        if (p?.estimateId === 1) {
          newPayload.estimateId = 1;
          newPayload.approvedBy = p.approvedBy ?? 1;
          newPayload.note = 'Seeded estimate approval';
          changed = true;
        }
      }

      if (a.type === 'estimate:rejected') {
        if (p?.estimateId === 999) {
          newPayload.rejectedBy = p.rejectedBy ?? 1;
          newPayload.reason = p.reason ?? 'Demo rejection';
          changed = true;
        }
      }

      if (a.type === 'wallet:link') {
        newPayload.address = p?.address ?? '0xDEADBEEF';
        changed = true;
      }

      if (changed) {
        await prisma.auditEvent.update({ where: { id: a.id }, data: { payload: newPayload } });
        console.log('Updated audit', a.id, a.type);
      }
    }

    // Enrich orders
    // Ensure clients exist with requested details
    await prisma.client.upsert({ where: { id: 3 }, update: { name: 'Demo Client', phone: '+380000000000' }, create: { id: 3, name: 'Demo Client', phone: '+380000000000' } });
    await prisma.client.upsert({ where: { id: 2 }, update: { name: 'Сягвроський', phone: '+380986034232' }, create: { id: 2, name: 'Сягвроський', phone: '+380986034232' } });
    await prisma.client.upsert({ where: { id: 1 }, update: { name: 'Smoke Client', phone: '+380501112233' }, create: { id: 1, name: 'Smoke Client', phone: '+380501112233' } });

    // Ensure vehicles
    await prisma.vehicle.upsert({ where: { id: 3 }, update: { plate: 'DEMO-101' }, create: { id: 3, clientId: 3, plate: 'DEMO-101' } });
    await prisma.vehicle.upsert({ where: { id: 2 }, update: { plate: 'фф1111фф', make: 'ф', model: 'ф', year: 1990 }, create: { id: 2, clientId: 2, plate: 'фф1111фф', make: 'ф', model: 'ф', year: 1990 } });
    await prisma.vehicle.upsert({ where: { id: 1 }, update: { plate: 'SMK123' }, create: { id: 1, clientId: 1, plate: 'SMK123', make: 'Test' } });

    // Update orders metadata and add timeline entries
    const order101 = await prisma.order.update({ where: { id: 101 }, data: { description: null, channel: 'web', priority: 'normal' } }).catch(()=>null);
    if (order101) {
      // Add a payment if none
      const pay = await prisma.payment.findFirst({ where: { orderId: 101 } });
      if (!pay) {
        await prisma.payment.create({ data: {
          orderId: 101,
          amount: '1000',
          method: 'CARD',
          status: 'COMPLETED',
          invoiceUrl: 'https://example.com/invoice/101',
          createdAt: new Date()
        }});
        console.log('Added payment for order 101');
      }
      // Add timeline entries
      const timelineExists = await prisma.orderTimeline.findFirst({ where: { orderId: 101, event: 'Estimate approved' } });
      if (!timelineExists) {
        await prisma.orderTimeline.create({ data: { orderId: 101, event: 'Estimate created', details: { total: 1000 }, userId: '1' } });
        await prisma.orderTimeline.create({ data: { orderId: 101, event: 'Estimate approved', details: { approvedBy: 1 }, userId: '1' } });
        console.log('Added timeline for order 101');
      }
    }

    // Order 2: add a friendly description, attachment and timeline
    const ord2 = await prisma.order.update({ where: { id: 2 }, data: { description: 'Клієнт просив діагностику двигуна, шум при запуску', channel: 'web' } }).catch(()=>null);
    if (ord2) {
      const tl = await prisma.orderTimeline.findFirst({ where: { orderId: 2, event: 'Customer requested pickup' } });
      if (!tl) {
        await prisma.orderTimeline.create({ data: { orderId: 2, event: 'Customer requested pickup', details: { pickupAddress: 'Onore de Balzaka 8-b' }, userId: '2' } });
        console.log('Added timeline for order 2');
      }
      // Attachment
      const att = await prisma.attachment.findFirst({ where: { orderId: 2 } });
      if (!att) {
        await prisma.attachment.create({ data: { orderId: 2, type: 'PHOTO', url: 'https://example.com/photos/2/1.jpg', filename: 'engine_noise.jpg', size: 123456, objectKey: 'demo/att-2-1.jpg', contentType: 'image/jpeg', status: 'ready', createdBy: 2 } });
        console.log('Added attachment for order 2');
      }
    }

    // Order 1: add a small timeline
    const ord1 = await prisma.order.findUnique({ where: { id: 1 } });
    if (ord1) {
      const tl1 = await prisma.orderTimeline.findFirst({ where: { orderId: 1, event: 'Order received' } });
      if (!tl1) {
        await prisma.orderTimeline.create({ data: { orderId: 1, event: 'Order received', details: { note: 'Smoke test order' }, userId: '1' } });
        console.log('Added timeline for order 1');
      }
    }

    console.log('Fixes applied');
  } catch (err) {
    console.error('Error', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
