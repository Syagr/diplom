import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { app } from '../app';

const prisma = new PrismaClient();

function makeTestToken(sub: number | string, role: string = 'admin') {
  const secret = process.env.JWT_SECRET || 'test_access_secret';
  return jwt.sign({ sub, role }, secret, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Order completion proof (integration)', () => {
  let orderId: number;
  let token: string;

  beforeAll(async () => {
    // Ensure there's at least one order from seed; otherwise create a minimal one
    const existing = await prisma.order.findFirst();
    if (existing) {
      orderId = existing.id;
    } else {
      const client = await prisma.client.create({ data: { name: 'Test User', phone: '+380500000001' } });
      const vehicle = await prisma.vehicle.create({ data: { clientId: client.id, plate: 'TEST123', make: 'Test', model: 'Car', year: 2024 } });
      const order = await prisma.order.create({ data: { clientId: client.id, vehicleId: vehicle.id, category: 'engine', description: 'Test order', channel: 'web', priority: 'normal' } });
      orderId = order.id;
    }
    token = makeTestToken(1, 'admin');
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('POST /api/orders/:id/complete returns proofHash', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        photos: [],
        coords: { lat: 50.45, lng: 30.52 },
        notes: 'Completed by integration test'
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('proofHash');
    expect(typeof res.body.proofHash).toBe('string');
  });

  it('GET /api/orders/:id/proof returns same proofHash and evidence', async () => {
    const completeRes = await request(app)
      .post(`/api/orders/${orderId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coords: { lat: 50.45, lng: 30.52 }, notes: 'Proof check' });

    const { proofHash } = completeRes.body;

    const res = await request(app)
      .get(`/api/orders/${orderId}/proof`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('proofHash');
    expect(res.body.proofHash).toBe(proofHash);
    expect(res.body).toHaveProperty('evidence');
    expect(res.body.evidence).toHaveProperty('completedAt');
  });
});
