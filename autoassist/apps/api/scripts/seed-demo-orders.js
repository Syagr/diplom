import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seed() {
  try {
    console.log('Connecting...');
    await prisma.$connect();

    console.log('Cleaning orders and related data...');
    // Delete orders - onDelete cascade will remove related attachments, estimates, locations etc.
    await prisma.orderTimeline.deleteMany();
    await prisma.estimate.deleteMany();
    await prisma.orderLocation.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.towRequest.deleteMany();
    await prisma.order.deleteMany();

    // Upsert clients
    const clients = [
      { id: 3, name: 'Demo Client', phone: '+380000000000' },
      { id: 2, name: 'Сягвроський', phone: '+380986034232' },
      { id: 1, name: 'Smoke Client', phone: '+380501112233' }
    ];
    for (const c of clients) {
      await prisma.client.upsert({
        where: { id: c.id },
        update: { name: c.name, phone: c.phone },
        create: { id: c.id, name: c.name, phone: c.phone }
      });
    }

    // Upsert vehicles
    const vehicles = [
      { id: 3, clientId: 3, plate: 'DEMO-101', make: null, model: null, year: null },
      { id: 2, clientId: 2, plate: 'фф1111фф', make: 'ф', model: 'ф', year: 1990 },
      { id: 1, clientId: 1, plate: 'SMK123', make: 'Test', model: null, year: null }
    ];

    for (const v of vehicles) {
      await prisma.vehicle.upsert({
        where: { id: v.id },
        update: { clientId: v.clientId, plate: v.plate, make: v.make, model: v.model, year: v.year },
        create: { id: v.id, clientId: v.clientId, plate: v.plate, make: v.make, model: v.model, year: v.year }
      });
    }

    // Create orders
    console.log('Creating orders...');

    // Order 101 with approved estimate
    await prisma.order.create({
      data: {
        id: 101,
        clientId: 3,
        vehicleId: 3,
        status: 'APPROVED',
        category: 'engine',
        description: null,
        channel: 'web',
        priority: 'normal',
        createdAt: new Date('2025-09-28T14:28:32.169Z'),
        updatedAt: new Date('2025-09-28T14:36:18.573Z')
      }
    });

    // Order 2
    await prisma.order.create({
      data: {
        id: 2,
        clientId: 2,
        vehicleId: 2,
        status: 'NEW',
        category: 'engine',
        description: 'ф',
        channel: 'web',
        priority: 'normal',
        createdAt: new Date('2025-09-28T13:06:32.456Z'),
        updatedAt: new Date('2025-09-28T13:06:32.456Z')
      }
    });

    // Order 1
    await prisma.order.create({
      data: {
        id: 1,
        clientId: 1,
        vehicleId: 1,
        status: 'NEW',
        category: 'test',
        description: 'smoke order',
        channel: 'web',
        priority: 'normal',
        createdAt: new Date('2025-09-27T17:07:34.794Z'),
        updatedAt: new Date('2025-09-27T17:07:34.794Z')
      }
    });

    // Locations
    await prisma.orderLocation.create({
      data: {
        id: 2,
        orderId: 2,
        kind: 'pickup',
        lat: 50.50103227770303,
        lng: 30.5807734427996,
        address: 'Onore de Balzaka 8-b'
      }
    });

    await prisma.orderLocation.create({
      data: {
        id: 1,
        orderId: 1,
        kind: 'pickup',
        lat: 50.45,
        lng: 30.52
      }
    });

    // Create estimate for order 101 (id 1)
    console.log('Creating estimate for order 101...');
    await prisma.estimate.create({
      data: {
        id: 1,
        orderId: 101,
        itemsJson: { parts: [] },
        laborJson: { labor: 0 },
        total: '1000',
        currency: 'UAH',
        validUntil: new Date('2025-10-05T14:28:32.253Z'),
        approved: true,
        approvedAt: new Date('2025-09-28T14:36:18.556Z'),
        createdAt: new Date('2025-09-28T14:28:32.257Z')
      }
    });

    // Create audit events: estimate created and approved for estimate 1
    console.log('Creating audit events...');
    const now = new Date();
    await prisma.auditEvent.createMany({
      data: [
        { type: 'estimate:created', payload: { total: 1000, orderId: 101, estimateId: 1 }, userId: 1, createdAt: new Date(now.getTime() - 1000 * 60 * 60) },
        { type: 'estimate:approved', payload: { estimateId: 1, approvedBy: 1 }, userId: 1, createdAt: new Date(now.getTime() - 1000 * 60 * 50) }
      ]
    });

    console.log('Seeding complete');
  } catch (err) {
    console.error('Seeding failed', err);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
