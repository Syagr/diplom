import request from 'supertest';
import { app } from '../app';

describe('API smoke', () => {
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
