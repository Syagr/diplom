import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create sample achievements
  const achievements = await Promise.all([
    prisma.achievement.upsert({
      where: { code: 'FIRST_ORDER' },
      update: {},
      create: {
        code: 'FIRST_ORDER',
        title: 'Первый заказ',
        description: 'Оформили первую заявку в AutoAssist+',
        icon: '🎉',
        points: 50
      }
    }),
    prisma.achievement.upsert({
      where: { code: 'LOYAL_CUSTOMER' },
      update: {},
      create: {
        code: 'LOYAL_CUSTOMER',
        title: 'Лояльный клиент',
        description: '5+ заказов за год',
        icon: '⭐',
        points: 200
      }
    }),
    prisma.achievement.upsert({
      where: { code: 'NO_ACCIDENTS_1Y' },
      update: {},
      create: {
        code: 'NO_ACCIDENTS_1Y',
        title: 'Год без ДТП',
        description: 'Аккуратная езда в течение года',
        icon: '🛡️',
        points: 300
      }
    }),
    prisma.achievement.upsert({
      where: { code: 'TIMELY_MAINTENANCE' },
      update: {},
      create: {
        code: 'TIMELY_MAINTENANCE',
        title: 'ТО вовремя',
        description: '3 раза подряд ТО в срок',
        icon: '🔧',
        points: 150
      }
    })
  ]);

  console.log(`✅ Created ${achievements.length} achievements`);

  // Create sample client
  const client = await prisma.client.upsert({
    where: { phone: '+380501234567' },
    update: {},
    create: {
      name: 'Иван Петров',
      phone: '+380501234567',
      email: 'ivan@example.com',
      loyaltyPoints: 150
    }
  });

  // Create sample vehicle
  const vehicle = await prisma.vehicle.upsert({
    where: { plate: 'AA1234BB' },
    update: {},
    create: {
      clientId: client.id,
      plate: 'AA1234BB',
      vin: 'WBAPH5C58BE123456',
      make: 'BMW',
      model: 'X5',
      year: 2020,
      mileage: 45000
    }
  });

  // Create sample order
  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      vehicleId: vehicle.id,
      category: 'engine',
      description: 'Двигатель не заводится, подозрение на стартер',
      channel: 'web',
      priority: 'normal',
      locations: {
        create: [{
          kind: 'pickup',
          lat: 50.4501,
          lng: 30.5234,
          address: 'Киев, ул. Крещатик, 1'
        }]
      },
      timeline: {
        create: [{
          event: 'order_created',
          details: { source: 'seed', channel: 'web' }
        }]
      }
    }
  });

  // Create sample estimate
  await prisma.estimate.create({
    data: {
      orderId: order.id,
      itemsJson: {
        parts: [
          { name: 'Стартер', partNo: 'BMW-12345', price: 8500, quantity: 1 },
          { name: 'Щетки стартера', partNo: 'BMW-67890', price: 350, quantity: 1 }
        ]
      },
      laborJson: {
        tasks: [
          { name: 'Диагностика', hours: 1, rate: 800 },
          { name: 'Замена стартера', hours: 2, rate: 800 }
        ]
      },
      total: 11250,
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    }
  });

  // Create sample insurance offer
  await prisma.insuranceOffer.create({
    data: {
      orderId: order.id,
      code: 'BREAKDOWN_EXTENDED',
      title: 'Расширенная защита от поломок',
      description: 'Покрытие ремонта двигателя и трансмиссии на 12 месяцев',
      price: 2500,
      duration: 12,
      coverage: {
        engine: true,
        transmission: true,
        electrical: false,
        suspension: false
      },
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    }
  });

  console.log('✅ Created sample client, vehicle, order with estimate and insurance offer');
  console.log(`📋 Order ID: ${order.id}`);
  console.log(`👤 Client: ${client.name} (${client.phone})`);
  console.log(`🚗 Vehicle: ${vehicle.make} ${vehicle.model} (${vehicle.plate})`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });