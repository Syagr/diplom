import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const kyivLocations = [
  { addr: 'Хрещатик, Київ', lat: 50.4501, lng: 30.5234 },
  { addr: 'Майдан Незалежності, Київ', lat: 50.4500, lng: 30.5233 },
  { addr: 'Печерськ, Київ', lat: 50.4422, lng: 30.5369 },
  { addr: 'Оболонь, Київ', lat: 50.5200, lng: 30.5200 },
  { addr: 'Святошино, Київ', lat: 50.4397, lng: 30.3813 },
  { addr: 'Позняки, Київ', lat: 50.4010, lng: 30.6158 },
  { addr: 'Поділ, Київ', lat: 50.4760, lng: 30.5077 },
  { addr: 'Віноградар, Київ', lat: 50.4700, lng: 30.4200 }
];

const clients = [
  { name: 'Олександр Іванов', phone: '+380501112233' },
  { name: 'Марія Петрів', phone: '+380671234567' },
  { name: 'Іван Коваль', phone: '+380977654321' },
  { name: 'Олена Гнатюк', phone: '+380931234321' }
];

const vehicles = [
  { plate: 'AA1111BB', make: 'Toyota', model: 'Corolla', year: 2014 },
  { plate: 'AA2222BB', make: 'Skoda', model: 'Octavia', year: 2018 },
  { plate: 'AA3333BB', make: 'Renault', model: 'Kangoo', year: 2012 },
  { plate: 'AA4444BB', make: 'BMW', model: 'X3', year: 2020 }
];

const ordersSample = [
  { clientIdx: 0, vehicleIdx: 0, neighborhood: 0, category: 'engine', description: 'Не заводиться, клацає стартер', status: 'NEW', priority: 'high' },
  { clientIdx: 1, vehicleIdx: 1, neighborhood: 1, category: 'battery', description: 'Проблеми з акумулятором, лампочки пригасають', status: 'INSERVICE', priority: 'normal' },
  { clientIdx: 2, vehicleIdx: 2, neighborhood: 2, category: 'tow', description: 'Потрібна евакуація після ДТП', status: 'NEW', priority: 'high' },
  { clientIdx: 3, vehicleIdx: 3, neighborhood: 3, category: 'tyres', description: 'Пробите колесо', status: 'APPROVED', priority: 'normal' },
  { clientIdx: 0, vehicleIdx: 1, neighborhood: 4, category: 'engine', description: 'Перегрів двигуна', status: 'CANCELLED', priority: 'normal' },
  { clientIdx: 1, vehicleIdx: 2, neighborhood: 5, category: 'electrical', description: 'Не працює склопідіймач', status: 'NEW', priority: 'low' },
  { clientIdx: 2, vehicleIdx: 3, neighborhood: 6, category: 'brakes', description: 'Скрипи при гальмуванні', status: 'INSERVICE', priority: 'normal' },
  { clientIdx: 3, vehicleIdx: 0, neighborhood: 7, category: 'engine', description: 'Потрібна діагностика', status: 'NEW', priority: 'low' }
];

async function seed() {
  try {
    console.log('Connecting to DB...');
    await prisma.$connect();

    console.log('Cleaning existing orders and related data (safe wipe)');
    await prisma.orderTimeline.deleteMany();
    await prisma.estimate.deleteMany();
    await prisma.orderLocation.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.towRequest.deleteMany();
    await prisma.order.deleteMany();

    // Upsert clients (by phone)
    const createdClients = [];
    for (const c of clients) {
      const u = await prisma.client.upsert({
        where: { phone: c.phone },
        update: { name: c.name },
        create: c
      });
      createdClients.push(u);
    }

    // Upsert vehicles
    const createdVehicles = [];
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const data = { ...v, clientId: createdClients[i % createdClients.length].id };
      const created = await prisma.vehicle.upsert({
        where: { plate: v.plate },
        update: data,
        create: data
      });
      createdVehicles.push(created);
    }

    console.log('Creating orders for Kyiv...');
    const createdOrders = [];
    for (let i = 0; i < ordersSample.length; i++) {
      const sample = ordersSample[i];
      const client = createdClients[sample.clientIdx];
      const vehicle = createdVehicles[sample.vehicleIdx];
      const loc = kyivLocations[sample.neighborhood % kyivLocations.length];

      const order = await prisma.order.create({
        data: {
          clientId: client.id,
          vehicleId: vehicle.id,
          status: sample.status,
          category: sample.category,
          description: sample.description,
          channel: 'web',
          priority: sample.priority,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });
      createdOrders.push(order);

      // location
      await prisma.orderLocation.create({ data: { orderId: order.id, kind: 'pickup', lat: loc.lat, lng: loc.lng, address: loc.addr } });

      // some orders get estimates
  if (sample.status === 'APPROVED' || sample.status === 'INSERVICE' || Math.random() < 0.5) {
        const approved = sample.status === 'APPROVED' ? true : Math.random() < 0.5;
        const estimate = await prisma.estimate.create({
          data: {
            orderId: order.id,
            itemsJson: { parts: [{ name: 'Робота', price: 300 }] },
            laborJson: { hours: 1 },
            total: String(300 + Math.floor(Math.random() * 200)),
            currency: 'UAH',
            validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000),
            approved: approved,
            approvedAt: approved ? new Date() : null,
            createdAt: new Date()
          }
        });

        // timeline events
        await prisma.orderTimeline.create({ data: { orderId: order.id, event: 'estimate:created', details: { text: 'Кошторис створено' }, userId: String(1) } });
        if (estimate.approved) {
          await prisma.orderTimeline.create({ data: { orderId: order.id, event: 'estimate:approved', details: { text: 'Кошторис підтверджено' }, userId: String(1) } });
        }

        // audit events
        await prisma.auditEvent.create({ data: { type: 'estimate:created', payload: { estimateId: estimate.id, orderId: order.id, total: estimate.total }, userId: 1 } });
        if (estimate.approved) {
          await prisma.auditEvent.create({ data: { type: 'estimate:approved', payload: { estimateId: estimate.id, approvedBy: 1 }, userId: 1 } });
        }
      }

      // attachments for some orders
      if (Math.random() < 0.4) {
        await prisma.attachment.create({ data: { orderId: order.id, type: 'PHOTO', url: 'https://via.placeholder.com/800x600.png?text=demo', filename: 'demo.png', size: 12345, contentType: 'image/png' } });
      }

      // payments for approved ones
      if (sample.status === 'APPROVED') {
        await prisma.payment.create({ data: { orderId: order.id, amount: '500', method: 'CARD', status: 'COMPLETED', completedAt: new Date() } });
      }

      // towRequest for tow category
      if (sample.category === 'tow') {
        await prisma.towRequest.create({ data: { orderId: order.id, etaMinutes: 25, vehicleInfo: 'DemoTow', createdAt: new Date() } });
        await prisma.orderTimeline.create({ data: { orderId: order.id, event: 'tow:requested', details: { text: 'Запит евакуації створено' }, userId: String(1) } });
      }
    }

    console.log('Seeding completed: created', createdOrders.length, 'orders');
  } catch (err) {
    console.error('Seeding failed', err);
  } finally {
    await prisma.$disconnect();
  }
}

seed();
