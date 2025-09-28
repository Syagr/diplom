import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Seeding demo order and estimate...');

    // Ensure a client exists
    const client = await prisma.client.upsert({
      where: { phone: '+380000000000' },
      update: {},
      create: { name: 'Demo Client', phone: '+380000000000' }
    });

    // Create an order with id 101 if not exists
    let order = await prisma.order.findUnique({ where: { id: 101 } });
    if (!order) {
      order = await prisma.order.create({
        data: {
          id: 101,
          clientId: client.id,
          vehicleId: 1, // create a vehicle if missing
          category: 'engine',
        }
      });
    }

    // Ensure vehicle exists
    const vehicle = await prisma.vehicle.upsert({
      where: { plate: 'DEMO-101' },
      update: {},
      create: { clientId: client.id, plate: 'DEMO-101' }
    });

    // If the order references a missing vehicle, update it
    if (order.vehicleId !== vehicle.id) {
      await prisma.order.update({ where: { id: order.id }, data: { vehicleId: vehicle.id } });
      order = await prisma.order.findUnique({ where: { id: order.id } });
    }

    // Create estimate if missing
    const existing = await prisma.estimate.findUnique({ where: { orderId: order.id } });
    if (!existing) {
      const estimate = await prisma.estimate.create({
        data: {
          orderId: order.id,
          itemsJson: { parts: [] },
          laborJson: { labor: 0 },
          total: 1000,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
      });
      console.log('Created estimate', estimate.id);
    } else {
      console.log('Estimate already exists for order', order.id);
    }

    console.log('Seed complete');
  } catch (err) {
    console.error('Seed error', err?.message || err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
