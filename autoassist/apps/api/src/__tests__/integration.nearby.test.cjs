const request = require('supertest');
const jwt = require('jsonwebtoken');

let app;
let prisma;

function makeTestToken(sub, role = 'admin') {
  const secret = process.env.JWT_SECRET || 'test_access_secret';
  return jwt.sign({ sub, role }, secret, { algorithm: 'HS256', expiresIn: '1h' });
}

describe('Service centers nearby (integration, CJS)', () => {
  let token;

  beforeAll(async () => {
    const mod = await import('../../dist/src/app.js');
    app = mod.app;
    prisma = mod.prisma;
    token = makeTestToken(1, 'admin');
  });

  afterAll(async () => {
    try { await prisma?.$disconnect?.(); } catch {}
  });

  it('GET /api/service-centers/nearby returns items with distance', async () => {
    const res = await request(app)
      .get('/api/service-centers/nearby')
      .query({ lat: 50.4501, lng: 30.5234, limit: 5 })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    const first = res.body.items[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('distanceKm');
    expect(typeof first.distanceKm).toBe('number');
  });
});
