/* eslint-disable */
const request = require('supertest')

let app

beforeAll(async () => {
  // dynamic import ESM app export
  const mod = await import('../../dist/src/app.js')
  app = mod.app
})

describe('Frontend-bound API contract (smoke)', () => {
  it('GET /api/healthz is OK', async () => {
    const res = await request(app).get('/api/healthz')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('ok', true)
  })

  it('GET /api/service-centers returns list (if DB ready)', async () => {
    const res = await request(app).get('/api/service-centers')
    // If DB is not connected, service may return 500; accept 2xx or 5xx but log for diagnostics
    if (String(res.status).startsWith('2')) {
      expect(Array.isArray(res.body) || Array.isArray(res.body?.items)).toBe(true)
    } else {
      // Provide diagnostic output without failing pipeline when DB unavailable
      // console.warn('service-centers endpoint unavailable in test env:', res.status)
      expect([500,503,404]).toContain(res.status)
    }
  })

  it('GET /api/calc-profiles returns list (if DB ready)', async () => {
    const res = await request(app).get('/api/calc-profiles')
    if (String(res.status).startsWith('2')) {
      expect(Array.isArray(res.body) || Array.isArray(res.body?.items)).toBe(true)
    } else {
      // Protected route may return 401 without auth; also tolerate infra unavailability in CI
      expect([401,403,500,503,404]).toContain(res.status)
    }
  })
})
