// src/services/walletLogin.service.ts
import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import prisma from '../utils/prisma.js';
import { signAccessToken, signRefreshToken } from '../utils/jwt.js';

const NONCE_TTL_MS = Number(process.env.WALLET_NONCE_TTL_MS || 10 * 60 * 1000); // 10 min

function normalizeAddress(addr: string) {
  try {
    return ethers.getAddress(addr);
  } catch {
    return addr.toLowerCase();
  }
}

function makeMessage(nonce: string) {
  // Keep message stable to verify exactly what was signed
  return `AutoAssist Login\n\nNonce: ${nonce}`;
}

export async function issueNonce(address: string) {
  const addr = normalizeAddress(address);
  const nonce = randomUUID();
  const now = new Date();

  await prisma.walletNonce.upsert({
    where: { address: addr },
    create: { address: addr, nonce, createdAt: now },
    update: { nonce, createdAt: now },
  });
  return { address: addr, nonce, message: makeMessage(nonce), ttlMs: NONCE_TTL_MS };
}

export async function verifyWalletSignature(params: { address: string; signature: string; chainId?: number; createIfMissing?: boolean }) {
  const addr = normalizeAddress(params.address);
  // Optional chainId enforcement (security polish)
  const expected = Number(process.env.EXPECTED_CHAIN_ID || 0);
  if (expected && params.chainId && Number(params.chainId) !== expected) {
    throw Object.assign(new Error('WRONG_CHAIN'), { status: 400, code: 'WRONG_CHAIN', expected, got: Number(params.chainId) });
  }
  const entry = await prisma.walletNonce.findUnique({ where: { address: addr } });
  if (!entry) {
    throw Object.assign(new Error('NONCE_NOT_FOUND'), { status: 400, code: 'NONCE_NOT_FOUND' });
  }

  // TTL check
  const age = Date.now() - new Date(entry.createdAt).getTime();
  if (age > NONCE_TTL_MS) {
    // cleanup expired
    await prisma.walletNonce.delete({ where: { address: addr } }).catch(() => {});
    throw Object.assign(new Error('NONCE_EXPIRED'), { status: 400, code: 'NONCE_EXPIRED' });
  }

  const message = makeMessage(entry.nonce);
  let signer: string;
  try {
    signer = ethers.verifyMessage(message, params.signature);
  } catch (e) {
    throw Object.assign(new Error('INVALID_SIGNATURE'), { status: 400, code: 'INVALID_SIGNATURE' });
  }

  const signerNorm = normalizeAddress(signer);
  if (signerNorm !== addr) {
    throw Object.assign(new Error('SIGNER_MISMATCH'), { status: 400, code: 'SIGNER_MISMATCH' });
  }

  // Link or create user
  let user = await prisma.user.findFirst({ where: { walletAddress: addr } });
  if (!user && params.createIfMissing !== false) {
    user = await prisma.user.create({ data: { walletAddress: addr, passwordHash: '', role: 'customer' } });
  }
  if (!user) {
    throw Object.assign(new Error('USER_NOT_FOUND'), { status: 404, code: 'USER_NOT_FOUND' });
  }

  // Clear nonce (one-time use)
  await prisma.walletNonce.delete({ where: { address: addr } }).catch(() => {});

  const payload = { sub: user.id, role: user.role, ver: user.tokenVersion } as const;
  return { access: signAccessToken(payload), refresh: signRefreshToken(payload) };
}

// ---- SIWE (EIP-4361) support ----
type SiweParsed = {
  domain: string;
  address: string;
  uri?: string;
  version: string;
  chainId?: number;
  nonce: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
};

function parseSiweMessage(msg: string): SiweParsed {
  // Minimal parser for canonical SIWE messages
  const lines = msg.split(/\r?\n/).map((l) => l.trim());
  if (lines.length < 2) throw Object.assign(new Error('BAD_SIWE_FORMAT'), { status: 400, code: 'BAD_SIWE_FORMAT' });
  const first = lines[0];
  const want = ' wants you to sign in with your Ethereum account:';
  const idx = first.indexOf(want);
  if (idx <= 0) throw Object.assign(new Error('BAD_SIWE_FORMAT'), { status: 400, code: 'BAD_SIWE_FORMAT' });
  const domain = first.slice(0, idx);
  // find next non-empty line as address
  let addrLineIdx = 1;
  while (addrLineIdx < lines.length && !lines[addrLineIdx]) addrLineIdx++;
  const address = lines[addrLineIdx];
  const out: SiweParsed = { domain, address, version: '1', nonce: '' };

  for (let i = addrLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const [kRaw, ...rest] = line.split(':');
    if (!kRaw || rest.length === 0) continue;
    const key = kRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'uri') out.uri = value;
    else if (key === 'version') out.version = value;
    else if (key === 'chain id') out.chainId = Number(value);
    else if (key === 'nonce') out.nonce = value;
    else if (key === 'issued at') out.issuedAt = value;
    else if (key === 'expiration time') out.expirationTime = value;
    else if (key === 'not before') out.notBefore = value;
  }

  if (!out.nonce) throw Object.assign(new Error('SIWE_NONCE_MISSING'), { status: 400, code: 'SIWE_NONCE_MISSING' });
  return out;
}

export async function verifySiweSignature(params: { siweMessage: string; signature: string; expected?: { domain?: string; uriPrefix?: string; chainId?: number } }) {
  const parsed = parseSiweMessage(params.siweMessage);

  // Verify signature recovers same address
  let signer: string;
  try {
    signer = ethers.verifyMessage(params.siweMessage, params.signature);
  } catch (e) {
    throw Object.assign(new Error('INVALID_SIGNATURE'), { status: 400, code: 'INVALID_SIGNATURE' });
  }
  const addr = normalizeAddress(signer);
  const addrInMsg = normalizeAddress(parsed.address);
  if (addr !== addrInMsg) {
    throw Object.assign(new Error('SIGNER_MISMATCH'), { status: 400, code: 'SIGNER_MISMATCH' });
  }

  // Domain/URI/chain checks
  const expDomain = params.expected?.domain || process.env.EXPECTED_SIWE_DOMAIN;
  if (expDomain && parsed.domain !== expDomain) {
    throw Object.assign(new Error('DOMAIN_MISMATCH'), { status: 400, code: 'DOMAIN_MISMATCH', expected: expDomain, got: parsed.domain });
  }
  const uriPrefix = params.expected?.uriPrefix || process.env.EXPECTED_SIWE_URI_PREFIX;
  if (uriPrefix && parsed.uri && !parsed.uri.startsWith(uriPrefix)) {
    throw Object.assign(new Error('URI_MISMATCH'), { status: 400, code: 'URI_MISMATCH', expected: uriPrefix, got: parsed.uri });
  }
  const expectedChain = params.expected?.chainId || (process.env.EXPECTED_CHAIN_ID ? Number(process.env.EXPECTED_CHAIN_ID) : undefined);
  if (expectedChain && parsed.chainId && parsed.chainId !== expectedChain) {
    throw Object.assign(new Error('WRONG_CHAIN'), { status: 400, code: 'WRONG_CHAIN', expected: expectedChain, got: parsed.chainId });
  }

  // Nonce replay protection
  const entry = await prisma.walletNonce.findUnique({ where: { address: addr } });
  if (!entry) {
    throw Object.assign(new Error('NONCE_NOT_FOUND'), { status: 400, code: 'NONCE_NOT_FOUND' });
  }
  if (entry.nonce !== parsed.nonce) {
    throw Object.assign(new Error('NONCE_MISMATCH'), { status: 400, code: 'NONCE_MISMATCH' });
  }
  // TTL check (reuse NONCE_TTL_MS semantics)
  const age = Date.now() - new Date(entry.createdAt).getTime();
  if (age > NONCE_TTL_MS) {
    await prisma.walletNonce.delete({ where: { address: addr } }).catch(() => {});
    throw Object.assign(new Error('NONCE_EXPIRED'), { status: 400, code: 'NONCE_EXPIRED' });
  }
  // ExpirationTime within message (optional)
  if (parsed.expirationTime) {
    const expAt = Date.parse(parsed.expirationTime);
    if (!Number.isNaN(expAt) && Date.now() > expAt) {
      await prisma.walletNonce.delete({ where: { address: addr } }).catch(() => {});
      throw Object.assign(new Error('MESSAGE_EXPIRED'), { status: 400, code: 'MESSAGE_EXPIRED' });
    }
  }

  // Clear nonce one-time
  await prisma.walletNonce.delete({ where: { address: addr } }).catch(() => {});

  // Link or create user
  let user = await prisma.user.findFirst({ where: { walletAddress: addr } });
  if (!user) {
    user = await prisma.user.create({ data: { walletAddress: addr, passwordHash: '', role: 'customer' } });
  }

  const payload = { sub: user.id, role: user.role, ver: user.tokenVersion } as const;
  return { access: signAccessToken(payload), refresh: signRefreshToken(payload) };
}
