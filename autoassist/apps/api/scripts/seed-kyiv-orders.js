#!/usr/bin/env node
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function seedKyiv(count = 5) {
  const baseLat = 50.4501, baseLng = 30.5234;

  for (let i = 0; i < count; i++) {
    const phone = `+38063${(1000000 + i).toString().slice(0,7)}`;
    const plate = `KA${(1000 + i)}AA`;

    const client = await prisma.client.upsert({
      where: { phone },
      update: { name: `Kyiv User ${i}` },
      create: { name: `Kyiv User ${i}`, phone }
    });

    const vehicle = await prisma.vehicle.upsert({
      where: { plate },
      update: { clientId: client.id },
      create: { clientId: client.id, plate, make: 'VW', model: 'Golf', year: 2016 + (i % 5), mileage: 60000 + i * 5000 }
    });

    await prisma.order.create({
      data: {
        clientId: client.id,
        vehicleId: vehicle.id,
        status: 'NEW',
        category: i % 2 ? 'suspension' : 'engine',
        description: 'Demo Kyiv order',
        priority: 'normal',
        locations: { create: [{ kind: 'pickup', lat: baseLat + i * 0.01, lng: baseLng + i * 0.01, address: 'Kyiv' }] },
        timeline: { create: [{ event: 'order_created', details: { city: 'Kyiv', seed: true } }] }
      }
    });
  }
}

async function main() {
  console.log('🌱 seed-kyiv-orders…');
  const count = Number(process.argv[2] || '5');
  await seedKyiv(count);
  console.log('✅ done');
}

main()
  .catch((e) => { console.error('❌ seed-kyiv-orders failed:', e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
