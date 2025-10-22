#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function upsertClient({ name, phone, email }) {
  return prisma.client.upsert({
    where: { phone },
    update: { name, email },
    create: { name, phone, email }
  });
}

async function upsertVehicle(clientId, v) {
  return prisma.vehicle.upsert({
    where: { plate: v.plate },
    update: { ...v, clientId },
    create: { ...v, clientId }
  });
}

async function makeOrder(clientId, vehicleId, data) {
  return prisma.order.create({
    data: {
      clientId,
      vehicleId,
      status: 'NEW',
      category: data.category,
      description: data.description,
      priority: data.priority || 'normal',
      locations: data.pickup ? {
        create: [{ kind: 'pickup', lat: data.pickup.lat, lng: data.pickup.lng, address: data.pickup.address }]
      } : undefined,
      timeline: { create: [{ event: 'order_created', details: { seed: true } }] }
    }
  });
}

async function main() {
  console.log('🌱 seed-demo-orders…');

  const demo = [
    {
      client: { name: 'Ivan Petrov', phone: '+380501234567', email: 'ivan@example.com' },
      vehicle: { plate: 'AA1234BB', make: 'BMW', model: 'X5', year: 2020, mileage: 45000 },
      order: { category: 'engine', description: 'Не заводится, подозрение на стартер', pickup: { lat: 50.45, lng: 30.523, address: 'Kyiv' } }
    },
    {
      client: { name: 'Olena Kovalenko', phone: '+380671234567', email: 'olena@example.com' },
      vehicle: { plate: 'KA7777PP', make: 'Toyota', model: 'Corolla', year: 2018, mileage: 82000 },
      order: { category: 'electrical', description: 'Проблемы с проводкой', pickup: { lat: 50.46, lng: 30.51, address: 'Kyiv' } }
    }
  ];

  let count = 0;
  for (const d of demo) {
    const c = await upsertClient(d.client);
    const v = await upsertVehicle(c.id, d.vehicle);
    const o = await makeOrder(c.id, v.id, d.order);
    count++;
    console.log('→ order', o.id, 'for', d.client.phone, '/', d.vehicle.plate);
  }

  console.log('✅ seeded orders:', count);
}

main()
  .catch((e) => { console.error('❌ seed-demo-orders failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
