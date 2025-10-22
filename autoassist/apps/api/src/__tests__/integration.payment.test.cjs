const request = require('supertest');
const jwt = require('jsonwebtoken');

let app;
let prisma;

function makeTestToken(sub, role = 'admin') {
  const secret = process.env.JWT_SECRET || 'test_access_secret';
  return jwt.sign({ sub, role }, secret, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Payments -> receipt + timeline (integration, CJS)', () => {
  let token;
  let orderId;
  let pendingPaymentId;

  beforeAll(async () => {
    const mod = await import('../../dist/src/app.js');
    app = mod.app;
    prisma = mod.prisma;

    // pick existing seeded order or create a simple one
    const existing = await prisma.order.findFirst();
    if (existing) {
      orderId = existing.id;
    } else {
      const client = await prisma.client.create({ data: { name: 'Test User', phone: '+380500000003' } });
      const vehicle = await prisma.vehicle.create({ data: { clientId: client.id, plate: 'TEST125', make: 'Test', model: 'Car', year: 2022 } });
      const order = await prisma.order.create({ data: { clientId: client.id, vehicleId: vehicle.id, category: 'engine', description: 'Payment test', channel: 'web', priority: 'normal' } });
      orderId = order.id;
    }

    // create a pending STRIPE payment directly (avoid hitting external Stripe API)
    const payment = await prisma.payment.create({
      data: {
        orderId,
        amount: 100,
        provider: 'STRIPE',
        method: 'CARD',
        status: 'PENDING',
        currency: 'UAH',
      },
    });
    pendingPaymentId = payment.id;

    token = makeTestToken(1, 'admin');
  });

  afterAll(async () => {
    try { await prisma?.$disconnect?.(); } catch {}
  });

  it('Marks payment completed via synthetic Stripe event and generates receipt', async () => {
    const event = {
      id: 'evt_test_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_1',
          metadata: { orderId: String(orderId) },
          payment_intent: 'pi_test_1',
        },
      },
    };

    const res = await request(app)
      .post('/api/test/stripe-event')
      .set('Authorization', `Bearer ${token}`)
      .send({ event });

    expect(res.status).toBe(200);

    // Payment should be completed
    const p = await prisma.payment.findUnique({ where: { id: pendingPaymentId } });
    expect(p.status).toBe('COMPLETED');

    // Timeline has 'Payment completed'
    const tlPaid = await prisma.orderTimeline.findMany({ where: { orderId, event: 'Payment completed' } });
    expect(tlPaid.length).toBeGreaterThan(0);

    // Receipt generated (attachment + timeline)
    const tlReceipt = await prisma.orderTimeline.findMany({ where: { orderId, event: 'Receipt generated' } });
    expect(tlReceipt.length).toBeGreaterThan(0);
    const attachmentId = tlReceipt[tlReceipt.length - 1].details.attachmentId;
    const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    expect(att).toBeTruthy();
    expect(att.objectKey).toBeTruthy();
  });
});
