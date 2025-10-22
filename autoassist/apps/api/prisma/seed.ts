import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database (UA/EN)…');

  // ---------------------------
  // Achievements (idempotent)
  // ---------------------------
  const achievements = await Promise.all([
    prisma.achievement.upsert({
      where: { code: 'FIRST_ORDER' },
      update: {
        title: 'Перший заказ / First order',
        description: 'Оформили першу заявку в AutoAssist+ / First service request in AutoAssist+',
        icon: '🎉',
        points: 50,
        isActive: true,
      },
      create: {
        code: 'FIRST_ORDER',
        title: 'Перший заказ / First order',
        description: 'Оформили першу заявку в AutoAssist+ / First service request in AutoAssist+',
        icon: '🎉',
        points: 50,
      },
    }),
    prisma.achievement.upsert({
      where: { code: 'LOYAL_CUSTOMER' },
      update: {
        title: 'Лояльний клієнт / Loyal customer',
        description: '5+ заявок за рік / 5+ orders in a year',
        icon: '⭐',
        points: 200,
        isActive: true,
      },
      create: {
        code: 'LOYAL_CUSTOMER',
        title: 'Лояльний клієнт / Loyal customer',
        description: '5+ заявок за рік / 5+ orders in a year',
        icon: '⭐',
        points: 200,
      },
    }),
    prisma.achievement.upsert({
      where: { code: 'NO_ACCIDENTS_1Y' },
      update: {
        title: 'Рік без ДТП / 1 year no accidents',
        description: 'Акуратна їзда протягом року / Careful driving for a year',
        icon: '🛡️',
        points: 300,
        isActive: true,
      },
      create: {
        code: 'NO_ACCIDENTS_1Y',
        title: 'Рік без ДТП / 1 year no accidents',
        description: 'Акуратна їзда протягом року / Careful driving for a year',
        icon: '🛡️',
        points: 300,
      },
    }),
    prisma.achievement.upsert({
      where: { code: 'TIMELY_MAINTENANCE' },
      update: {
        title: 'ТО вчасно / Timely maintenance',
        description: '3 ТО підряд у строк / 3 consecutive on-time services',
        icon: '🔧',
        points: 150,
        isActive: true,
      },
      create: {
        code: 'TIMELY_MAINTENANCE',
        title: 'ТО вчасно / Timely maintenance',
        description: '3 ТО підряд у строк / 3 consecutive on-time services',
        icon: '🔧',
        points: 150,
      },
    }),
  ]);

  console.log(`✅ Achievements upserted: ${achievements.length}`);

  // ---------------------------
  // Calc Profiles (admin pricing)
  // ---------------------------
  await Promise.all([
    prisma.calcProfile.upsert({
      where: { code: 'ECONOMY' },
      update: { name: 'Economy', partsCoeff: 0.9, laborCoeff: 0.9, laborRate: 380, active: true },
      create: { code: 'ECONOMY', name: 'Economy', partsCoeff: 0.9, laborCoeff: 0.9, laborRate: 380, active: true },
    }),
    prisma.calcProfile.upsert({
      where: { code: 'STANDARD' },
      update: { name: 'Standard', partsCoeff: 1.0, laborCoeff: 1.0, laborRate: 400, active: true },
      create: { code: 'STANDARD', name: 'Standard', partsCoeff: 1.0, laborCoeff: 1.0, laborRate: 400, active: true },
    }),
    prisma.calcProfile.upsert({
      where: { code: 'PREMIUM' },
      update: { name: 'Premium', partsCoeff: 1.15, laborCoeff: 1.15, laborRate: 450, active: true },
      create: { code: 'PREMIUM', name: 'Premium', partsCoeff: 1.15, laborCoeff: 1.15, laborRate: 450, active: true },
    }),
  ]);

  // ---------------------------
  // Service Centers (geo demo)
  // ---------------------------
  await Promise.all([
    prisma.serviceCenter.upsert({
      where: { id: 1 },
      update: { name: 'AutoAssist Kyiv Center', lat: 50.4501, lng: 30.5234, city: 'Kyiv', address: 'Khreshchatyk 1' },
      create: { name: 'AutoAssist Kyiv Center', lat: 50.4501, lng: 30.5234, city: 'Kyiv', address: 'Khreshchatyk 1' },
    }),
    prisma.serviceCenter.upsert({
      where: { id: 2 },
      update: { name: 'AutoAssist Left Bank', lat: 50.4509, lng: 30.63, city: 'Kyiv', address: 'Left Bank Ave 10' },
      create: { name: 'AutoAssist Left Bank', lat: 50.4509, lng: 30.63, city: 'Kyiv', address: 'Left Bank Ave 10' },
    }),
  ]);

  // ---------------------------
  // Client (unique by phone)
  // ---------------------------
  const client = await prisma.client.upsert({
    where: { phone: '+380501234567' },
    update: {
      name: 'Іван Петров / Ivan Petrov',
      email: 'ivan@example.com',
      loyaltyPoints: 150,
    },
    create: {
      name: 'Іван Петров / Ivan Petrov',
      phone: '+380501234567',
      email: 'ivan@example.com',
      loyaltyPoints: 150,
      rating: 4.8,
    },
  });

  // ---------------------------
  // Demo User linked to Client (for notifications/login)
  // ---------------------------
  const user = await prisma.user.upsert({
    where: { phone: client.phone! },
    update: { clientId: client.id, name: client.name, email: client.email ?? undefined },
    create: {
      clientId: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      passwordHash: '', // wallet-based or external auth in demo
      role: 'customer',
    },
  });

  // ---------------------------
  // Vehicle (unique by plate)
  // ---------------------------
  const vehicle = await prisma.vehicle.upsert({
    where: { plate: 'AA1234BB' },
    update: {
      clientId: client.id,
      vin: 'WBAPH5C58BE123456',
      make: 'BMW',
      model: 'X5',
      year: 2020,
      mileage: 45000,
    },
    create: {
      clientId: client.id,
      plate: 'AA1234BB',
      vin: 'WBAPH5C58BE123456',
      make: 'BMW',
      model: 'X5',
      year: 2020,
      mileage: 45000,
    },
  });

  // ---------------------------
  // Order (NEW -> with location + timeline)
  // ---------------------------
  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      vehicleId: vehicle.id,
      category: 'engine', // engine, transmission, suspension, electrical, etc.
      description:
        'Двигун не заводиться, підозра на стартер / Engine won’t start, suspected starter',
      channel: 'web', // web, mobile
      priority: 'normal', // low, normal, high, urgent
      locations: {
        create: [
          {
            kind: 'pickup',
            lat: 50.4501,
            lng: 30.5234,
            address: 'Київ, вул. Хрещатик, 1 / Kyiv, Khreshchatyk St, 1',
            notes: 'Клієнт чекатиме поруч / Customer will wait nearby',
          },
        ],
      },
      timeline: {
        create: [
          {
            event: 'order_created',
            details: { source: 'seed', channel: 'web', locale: 'uk/en' },
          },
        ],
      },
    },
  });

  // ---------------------------
  // Notifications preferences + sample notification
  // ---------------------------
  await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    update: { enabledChannels: ['IN_APP'], enabledTypes: [] },
    create: { userId: user.id, enabledChannels: ['IN_APP'], enabledTypes: [] },
  });
  await prisma.notification.create({
    data: {
      userId: user.id,
      type: 'ORDER_CREATED',
      title: 'Новая заявка создана',
      message: `Заявка #${order.id} успешно создана`,
      priority: 'MEDIUM',
      orderId: order.id,
      metadata: { seed: true },
      channels: ['IN_APP'],
      action: { label: 'Открыть заявку', url: `/orders/${order.id}` } as any,
      status: 'SENT',
    },
  });

  // ---------------------------
  // Estimate (QUOTE)
  // ---------------------------
  await prisma.estimate.create({
    data: {
      orderId: order.id,
      itemsJson: {
        parts: [
          { name: 'Стартер / Starter', partNo: 'BMW-12345', price: 8500, quantity: 1 },
          { name: 'Щітки стартера / Starter brushes', partNo: 'BMW-67890', price: 350, quantity: 1 },
        ],
      },
      laborJson: {
        tasks: [
          { name: 'Діагностика / Diagnostics', hours: 1, rate: 800 },
          { name: 'Заміна стартера / Starter replacement', hours: 2, rate: 800 },
        ],
      },
      total: 11250,
      currency: 'UAH',
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 days
      approved: false,
    },
  });

  // ---------------------------
  // Insurance offer (rule-based, simple)
  // Note: модель InsuranceOffer у схемі має: orderId, code, title, description, price, duration?, coverage?, status?, validUntil?, etc.
  // ---------------------------
  await prisma.insuranceOffer.create({
    data: {
      orderId: order.id,
      code: 'BREAKDOWN_EXTENDED',
      title: 'Розширений захист від поломок / Extended breakdown cover',
      description:
        'Покриття ремонту двигуна і трансмісії на 12 місяців / Engine & transmission repairs for 12 months',
      price: 2500,
      duration: 12, // months
      coverage: {
        engine: true,
        transmission: true,
        electrical: false,
        suspension: false,
      },
      status: 'OFFERED',
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 days
    },
  });

  // ---------------------------
  // Optional: add a maintenance record (to demo history)
  // ---------------------------
  await prisma.maintenanceRecord.create({
    data: {
      vehicleId: vehicle.id,
      type: 'inspection',
      description: 'Первинний огляд / Initial inspection',
      mileage: 45000,
      cost: 0,
      performedAt: new Date(),
      performedBy: 'AutoAssist+ Service',
    },
  });

  console.log('✅ Seed completed.');
  console.log(`📋 Order ID: ${order.id}`);
  console.log(`👤 Client: ${client.name} (${client.phone})`);
  console.log(`👤 User ID: ${user.id}`);
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
