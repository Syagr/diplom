import bcrypt from 'bcryptjs'; // consider `argon2` with argon2id
import prisma from '../utils/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefresh } from '../utils/jwt.js';
import type { Prisma } from '@prisma/client';

type LoginInput = { email?: string; phone?: string; password: string };
type RegisterInput = { email: string; password: string; name?: string };

// helpers
const normalizeEmail = (e?: string) => e?.trim().toLowerCase() || undefined;
// TODO: use a real E.164 normalizer (e.g. libphonenumber-js)
const normalizePhone = (p?: string) => (p ? p.replace(/\D+/g, '') : undefined);

// choose a higher cost (12–14) in production; or switch to argon2id
const BCRYPT_COST = Number(process.env.BCRYPT_COST || 12);
// const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 2**16, timeCost: 3, parallelism: 1 });

async function audit(type: string, payload: Prisma.InputJsonValue, userId?: number) {
  try {
    await prisma.auditEvent.create({ data: { type, payload, userId: userId ?? null } });
  } catch {
    /* non-fatal */
  }
}

export async function login({ email, phone, password }: LoginInput) {
  const e = normalizeEmail(email);
  const ph = normalizePhone(phone);

  if (!e && !ph) {
    throw Object.assign(new Error('INVALID_CREDENTIALS'), { status: 401, code: 'BAD_CREDENTIALS' });
  }

  // build where safely (avoid OR with undefineds)
  const or: any[] = [];
  if (e) or.push({ email: e });
  if (ph) or.push({ phone: ph });

  const user = await prisma.user.findFirst({
    where: { OR: or },
    select: { id: true, passwordHash: true, role: true, tokenVersion: true },
  });

  // uniform error to prevent user enumeration
  if (!user) {
    void audit('auth:failed', { email: e ?? null, phone: ph ?? null, reason: 'USER_NOT_FOUND' });
    throw Object.assign(new Error('INVALID_CREDENTIALS'), { status: 401, code: 'BAD_CREDENTIALS' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    // TODO: increment failed-login counter / apply lockout
    void audit('auth:failed', { email: e ?? null, phone: ph ?? null, reason: 'BAD_PASSWORD', userId: user.id }, user.id);
    throw Object.assign(new Error('INVALID_CREDENTIALS'), { status: 401, code: 'BAD_CREDENTIALS' });
  }

  const payload = {
    sub: user.id,
    role: user.role,
    ver: user.tokenVersion,
    // add jti/iat if your signers support it
  };
  void audit('auth:login', { email: e ?? null, phone: ph ?? null, method: 'password' }, user.id);
  return {
    access: signAccessToken(payload),
    refresh: signRefreshToken(payload),
  };
}

export async function register({ email, password, name: _name }: RegisterInput) {
  const e = normalizeEmail(email);

  // optional: enforce password policy here (length/complexity), you already validate via zod at the router layer
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  // const hash = await argon2.hash(password, { ... });

  try {
    const user = await prisma.user.create({
      data: {
        email: e!,
        passwordHash: hash,
        // persist name somewhere meaningful if needed (e.g., profile/client table)
      },
      select: { id: true, role: true, tokenVersion: true },
    });

    const payload = { sub: user.id, role: user.role, ver: user.tokenVersion };
    void audit('auth:register', { email: e }, user.id);
    return {
      access: signAccessToken(payload),
      refresh: signRefreshToken(payload),
    };
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw Object.assign(new Error('EMAIL_TAKEN'), { status: 409, code: 'EMAIL_TAKEN' });
    }
    throw err;
  }
}

export async function refresh(refreshToken: string) {
  // verifyRefresh should throw on bad/expired token
  const payload = verifyRefresh<{ sub: number; role: string; ver: number }>(refreshToken);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, tokenVersion: true },
  });

  if (!user) {
    throw Object.assign(new Error('INVALID_TOKEN'), { status: 401, code: 'INVALID_TOKEN' });
  }
  if (user.tokenVersion !== payload.ver) {
    // token invalidated via logoutAll / password change
    throw Object.assign(new Error('INVALID_TOKEN'), { status: 401, code: 'INVALID_TOKEN' });
  }

  const newPayload = { sub: user.id, role: user.role, ver: user.tokenVersion };
  void audit('auth:refresh', { userId: user.id, role: user.role }, user.id);
  return {
    access: signAccessToken(newPayload),
    refresh: signRefreshToken(newPayload), // consider rotating & revocation list + reuse detection
  };
}

export async function logoutAll(userId: number) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } }, // bump also when password changes
  });
  void audit('auth:logout', { userId }, userId);
  return { ok: true };
}
