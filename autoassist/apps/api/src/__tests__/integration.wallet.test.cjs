const request = require('supertest');

let app;
let prisma;
let ethersLib;

describe('Wallet nonce -> verify login (integration, CJS)', () => {
  let wallet;

  beforeAll(async () => {
    // Load compiled app and prisma from dist
    const mod = await import('../../dist/src/app.js');
    app = mod.app;
    prisma = mod.prisma;

    // Dynamic import for ESM-only ethers v6
    ethersLib = await import('ethers');
    wallet = ethersLib.Wallet.createRandom();
  });

  afterAll(async () => {
    try { await prisma?.$disconnect?.(); } catch {}
  });

  it('issues nonce and verifies signature to return tokens', async () => {
    // 1) Request nonce for address
    const nonceRes = await request(app)
      .post('/api/auth/wallet/nonce')
      .send({ address: wallet.address });

    expect(nonceRes.status).toBe(200);
    expect(nonceRes.body).toHaveProperty('nonce');
    expect(nonceRes.body).toHaveProperty('message');

    const { nonce, message } = nonceRes.body;
    expect(typeof nonce).toBe('string');
    expect(typeof message).toBe('string');

    // 2) Sign the exact message and verify
    const signature = await wallet.signMessage(message);

    const verifyRes = await request(app)
      .post('/api/auth/wallet/verify')
      .send({ address: wallet.address, signature });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toHaveProperty('access');
    expect(verifyRes.body).toHaveProperty('refresh');

    // Optional: ensure user is persisted with wallet address
    const user = await prisma.user.findFirst({ where: { walletAddress: ethersLib.getAddress(wallet.address) } });
    expect(user).toBeTruthy();
  });
});
