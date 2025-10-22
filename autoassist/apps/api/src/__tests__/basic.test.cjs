const request = require('supertest');

// Build must be run before tests; import compiled ESM app dynamically
let app;
let prisma;
let httpServer;
beforeAll(async () => {
  const mod = await import('../../dist/src/app.js');
  app = mod.app;
  prisma = mod.prisma;
  httpServer = mod.httpServer;
});

afterAll(async () => {
  try { await prisma?.$disconnect?.(); } catch {}
  try { await new Promise((r) => httpServer?.close?.(() => r(null))); } catch {}
});

describe('API smoke (CJS)', () => {
  it('GET /api/healthz returns ok', async () => {
    const res = await request(app).get('/api/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  it('GET /unknown returns 404 json', async () => {
    const res = await request(app).get('/__definitely_missing__');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'NOT_FOUND');
  });
});
