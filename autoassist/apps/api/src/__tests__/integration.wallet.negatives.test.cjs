// Negative scenarios for wallet auth
// We set env vars BEFORE importing the compiled app so that the service module reads them at load time
process.env.WALLET_NONCE_TTL_MS = '1'; // 1 ms TTL to force expiry in the first test
process.env.EXPECTED_CHAIN_ID = '80002'; // Polygon Amoy testnet (wrong chain will be 1)

const request = require('supertest');

let app;
let prisma;
let ethersLib;

describe('Wallet auth negatives (integration, CJS)', () => {
  beforeAll(async () => {
    // Load compiled app and prisma from dist after env is set
    const mod = await import('../../dist/src/app.js');
    app = mod.app;
    prisma = mod.prisma;
    ethersLib = await import('ethers');
  });

  afterAll(async () => {
    try { await prisma?.$disconnect?.(); } catch {}
  });

  it('returns NONCE_EXPIRED when TTL elapsed before verify', async () => {
    const wallet = ethersLib.Wallet.createRandom();

    const nonceRes = await request(app)
      .post('/api/auth/wallet/nonce')
      .send({ address: wallet.address });

    expect(nonceRes.status).toBe(200);
    const { message } = nonceRes.body;
    const signature = await wallet.signMessage(message);

    // Wait enough to ensure the 1ms TTL expires
    await new Promise((r) => setTimeout(r, 5));

    const verifyRes = await request(app)
      .post('/api/auth/wallet/verify')
      .send({ address: wallet.address, signature });

    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body).toHaveProperty('error');
    const code = verifyRes.body?.error?.code || verifyRes.body?.error;
    expect(String(code)).toMatch(/NONCE_EXPIRED|NONCE_NOT_FOUND/);
  });

  it('returns WRONG_CHAIN when chainId mismatches EXPECTED_CHAIN_ID', async () => {
    const wallet = ethersLib.Wallet.createRandom();

    const nonceRes = await request(app)
      .post('/api/auth/wallet/nonce')
      .send({ address: wallet.address });

    expect(nonceRes.status).toBe(200);
    const { message } = nonceRes.body;
    const signature = await wallet.signMessage(message);

    const verifyRes = await request(app)
      .post('/api/auth/wallet/verify')
      .send({ address: wallet.address, signature, chainId: 1 }); // mismatch vs EXPECTED_CHAIN_ID=80002

    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body).toHaveProperty('error');
    const code = verifyRes.body?.error?.code || verifyRes.body?.error;
    expect(String(code)).toMatch(/WRONG_CHAIN/);
  });
});
