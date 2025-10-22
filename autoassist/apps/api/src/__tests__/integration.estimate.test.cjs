const request = require('supertest');
const jwt = require('jsonwebtoken');

let app;
let prisma;

function makeTestToken(sub, role = 'admin') {
  const secret = process.env.JWT_SECRET || 'test_access_secret';
  return jwt.sign({ sub, role }, secret, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Estimate auto + lock (integration, CJS)', () => {
  let token;
  let orderId;

  beforeAll(async () => {
    const mod = await import('../../dist/src/app.js');
    app = mod.app;
    prisma = mod.prisma;

    // pick existing seeded order or create a simple one
    const existing = await prisma.order.findFirst();
    if (existing) {
      orderId = existing.id;
    } else {
      const client = await prisma.client.create({ data: { name: 'Test User', phone: '+380500000002' } });
      const vehicle = await prisma.vehicle.create({ data: { clientId: client.id, plate: 'TEST124', make: 'Test', model: 'Car', year: 2023 } });
      const order = await prisma.order.create({ data: { clientId: client.id, vehicleId: vehicle.id, category: 'engine', description: 'Estimate test', channel: 'web', priority: 'normal' } });
      orderId = order.id;
    }

    token = makeTestToken(1, 'admin');
  });

  afterAll(async () => {
    try { await prisma?.$disconnect?.(); } catch {}
  });

  it('POST /api/estimates/auto creates/updates estimate and writes timeline', async () => {
    const res = await request(app)
      .post('/api/estimates/auto')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, profile: 'STANDARD' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('estimate');
    expect(res.body.estimate).toHaveProperty('id');
    expect(typeof res.body.estimate.total).toBe('number');

    const timeline = await prisma.orderTimeline.findMany({ where: { orderId, event: 'Estimate auto-calculated' } });
    expect(timeline.length).toBeGreaterThan(0);
  });

  it('POST /api/estimates/:orderId/lock approves estimate and writes timeline', async () => {
    const res = await request(app)
      .post(`/api/estimates/${orderId}/lock`)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('estimate');
    expect(res.body.estimate).toHaveProperty('approved', true);

    const timeline = await prisma.orderTimeline.findMany({ where: { orderId, event: 'Estimate locked' } });
    expect(timeline.length).toBeGreaterThan(0);
  });
});
