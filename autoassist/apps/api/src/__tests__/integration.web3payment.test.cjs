const request = require('supertest');
const jwt = require('jsonwebtoken');

let app;
let prisma;

function makeTestToken(sub, role = 'admin') {
  const secret = process.env.JWT_SECRET || 'test_access_secret';
  return jwt.sign({ sub, role }, secret, { algorithm: 'HS256', expiresIn: '1h' });
}

function padTopicAddress(addr) {
  return '0x' + '0'.repeat(24) + addr.slice(2).toLowerCase();
}

describe('Web3 Payments -> receipt + timeline via synthetic receipt (integration, CJS)', () => {
  let token;
  let orderId;
  let pendingPaymentId;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.USDC_TOKEN_ADDRESS = process.env.USDC_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000009';
    process.env.PLATFORM_RECEIVE_ADDRESS = process.env.PLATFORM_RECEIVE_ADDRESS || '0x00000000000000000000000000000000000000aa';
    process.env.WEB3_ENFORCE_AMOUNT = '1';
    process.env.USDC_DECIMALS = '6';

    const mod = await import('../../dist/src/app.js');
    app = mod.app;
    prisma = mod.prisma;

    // pick existing seeded order or create simple one
    const existing = await prisma.order.findFirst();
    if (existing) {
      orderId = existing.id;
    } else {
      const client = await prisma.client.create({ data: { name: 'Test User', phone: '+380500000099' } });
      const vehicle = await prisma.vehicle.create({ data: { clientId: client.id, plate: 'TESTW3', make: 'Test', model: 'EV', year: 2023 } });
      const order = await prisma.order.create({ data: { clientId: client.id, vehicleId: vehicle.id, category: 'engine', description: 'Web3 Payment test', channel: 'web', priority: 'normal' } });
      orderId = order.id;
    }

    // create a pending WEB3 payment (USDC)
    const amountMajor = 100.0; // 100.00
    const payment = await prisma.payment.create({
      data: {
        orderId,
        amount: amountMajor,
        provider: 'WEB3',
        method: 'CRYPTO',
        status: 'PENDING',
        currency: 'USDC',
      },
    });
    pendingPaymentId = payment.id;

    token = makeTestToken(1, 'admin');
  });

  afterAll(async () => {
    try { await prisma?.$disconnect?.(); } catch {}
  });

  it('Marks web3 payment completed via synthetic ERC-20 Transfer receipt and generates receipt', async () => {
    const txHash = '0x' + 'a'.repeat(64);
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const token = process.env.USDC_TOKEN_ADDRESS;
    const platform = process.env.PLATFORM_RECEIVE_ADDRESS;

    // amount in token smallest units: 100.00 USDC => 100_000_000 (6 decimals)
    const amountSmallest = 100000000n;
    const receipt = {
      status: 1,
      logs: [
        {
          address: token,
          topics: [
            TRANSFER_TOPIC,
            padTopicAddress('0x0000000000000000000000000000000000000123'),
            padTopicAddress(platform),
          ],
          data: '0x' + amountSmallest.toString(16),
        },
      ],
    };

    const res = await request(app)
      .post('/api/test/web3-receipt')
      .set('Authorization', `Bearer ${token}`)
      .send({ orderId, paymentId: pendingPaymentId, txHash, receipt });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    const p = await prisma.payment.findUnique({ where: { id: pendingPaymentId } });
    expect(p.status).toBe('COMPLETED');

    const tlPaid = await prisma.orderTimeline.findMany({ where: { orderId, event: 'Payment completed (web3)' } });
    expect(tlPaid.length).toBeGreaterThan(0);

    const tlReceipt = await prisma.orderTimeline.findMany({ where: { orderId, event: 'Receipt generated' } });
    expect(tlReceipt.length).toBeGreaterThan(0);
    const attachmentId = tlReceipt[tlReceipt.length - 1].details.attachmentId;
    const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
    expect(att).toBeTruthy();
    expect(att.objectKey).toBeTruthy();
  });
});
