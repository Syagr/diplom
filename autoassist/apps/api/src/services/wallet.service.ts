// services/wallet.service.ts
import prisma from '@/utils/prisma.js';
import { signAccessToken, signRefreshToken } from '@/utils/jwt.js';
import { ethers } from 'ethers';
import crypto from 'node:crypto';

const NONCE_TTL_SEC = Number(process.env.WALLET_NONCE_TTL_SEC ?? 10 * 60); // 10 мин
const LOGIN_MSG_PREFIX = 'AutoAssist Wallet auth nonce:';
const LINK_MSG_PREFIX  = 'AutoAssist Wallet link nonce:';

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function makeNonce(): string {
  // 16 байт крипто + timestamp (base36) => трудно предсказать и удобно логировать
  return crypto.randomBytes(16).toString('base64url') + '.' + Date.now().toString(36);
}

function normalizeAddr(address: string): string {
  // Приведём и провалидируем адрес (ethers бросит при невалидности)
  const parsed = ethers.getAddress(address);
  return parsed.toLowerCase();
}

async function upsertNonce(address: string) {
  const a = normalizeAddr(address);
  const nonce = makeNonce();
  const expiresAt = new Date((nowUnix() + NONCE_TTL_SEC) * 1000);

  await prisma.walletNonce.upsert({
    where: { address: a },
    update: { nonce, expiresAt },
    create: { address: a, nonce, expiresAt },
  });

  return { nonce, expiresAt };
}

async function fetchNonceRecord(address: string) {
  const a = normalizeAddr(address);
  const rec = await prisma.walletNonce.findUnique({ where: { address: a } });
  if (!rec) {
    throw Object.assign(new Error('NONCE_NOT_FOUND'), { status: 400 });
  }
  if (rec.expiresAt && rec.expiresAt.getTime() < Date.now()) {
    // Сразу удалим, чтобы не копился мусор
    await prisma.walletNonce.delete({ where: { address: a } }).catch(() => {});
    throw Object.assign(new Error('NONCE_EXPIRED'), { status: 400 });
  }
  return rec;
}

function verifySignature(expectedAddress: string, message: string, signature: string) {
  let signer: string;
  try {
    signer = ethers.verifyMessage(message, signature);
  } catch {
    throw Object.assign(new Error('INVALID_SIGNATURE'), { status: 400 });
  }
  if (normalizeAddr(signer) !== normalizeAddr(expectedAddress)) {
    throw Object.assign(new Error('INVALID_SIGNATURE'), { status: 400 });
  }
}

async function issueTokensForUser(user: { id: number; role: string; tokenVersion: number }) {
  const payload = { sub: user.id, role: user.role, ver: user.tokenVersion };
  return {
    access: signAccessToken(payload),
    refresh: signRefreshToken(payload),
  };
}

/**
 * Публичные методы
 */

// 1) Запросить одноразовый nonce для адреса
export async function getNonceForAddress(address: string) {
  const { nonce, expiresAt } = await upsertNonce(address);
  return { nonce, expiresAt };
}

// 2) Авторизация кошельком: проверяем подпись, создаём пользователя при необходимости, выдаём токены.
//    Возвращаем и access, и refresh, а nonce уничтожаем (one-shot).
export async function verifyWalletSignature(address: string, signature: string, name?: string) {
  const a = normalizeAddr(address);
  const rec = await fetchNonceRecord(a);

  const msg = `${LOGIN_MSG_PREFIX} ${rec.nonce}`;
  verifySignature(a, msg, signature);

  // Одноразовость: удаляем nonce даже при дальнейших ошибках (best-effort)
  await prisma.walletNonce.delete({ where: { address: a } }).catch(() => {});

  // Ищем пользователя по кошельку
  let user = await prisma.user.findUnique({
    where: { walletAddress: a },
    select: { id: true, role: true, tokenVersion: true },
  });

  // Если нет — создаём "customer" с этим кошельком
  if (!user) {
    user = await prisma.user.create({
      data: {
        walletAddress: a,
        name: name || null,
        // фиктивный пароль, чтобы поле было заполнено (если в схеме NOT NULL)
        passwordHash: crypto.randomBytes(16).toString('hex'),
        role: 'customer',
      },
      select: { id: true, role: true, tokenVersion: true },
    });
  }

  // Аудит
  void prisma.auditEvent.create({
    data: { type: 'wallet:login', payload: { address: a }, userId: user.id },
  }).catch(() => {});

  return issueTokensForUser(user);
}

// 3) Привязать кошелёк к существующему пользователю (по userId).
//    Проверяем подпись отдельным сообщением и предотвращаем коллизию: адрес не должен быть привязан к другому юзеру.
export async function linkWalletToUser(address: string, signature: string, userId: number) {
  const a = normalizeAddr(address);
  const rec = await fetchNonceRecord(a);

  const msg = `${LINK_MSG_PREFIX} ${rec.nonce}`;
  verifySignature(a, msg, signature);

  // Удалим nonce (one-shot)
  await prisma.walletNonce.delete({ where: { address: a } }).catch(() => {});

  // Проверим, не привязан ли адрес к другому пользователю
  const existing = await prisma.user.findUnique({
    where: { walletAddress: a },
    select: { id: true },
  });
  if (existing && existing.id !== Number(userId)) {
    const err: any = new Error('WALLET_ALREADY_LINKED');
    err.status = 409;
    throw err;
  }

  // Привязываем
  await prisma.user.update({
    where: { id: Number(userId) },
    data: { walletAddress: a },
  });

  // Аудит
  void prisma.auditEvent.create({
    data: { type: 'wallet:link', payload: { address: a }, userId: Number(userId) },
  }).catch(() => {});

  return { ok: true };
}
