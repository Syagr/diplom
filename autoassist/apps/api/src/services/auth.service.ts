import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefresh } from '../utils/jwt.js';

type LoginInput = { email?: string; phone?: string; password: string };
type RegisterInput = { email: string; password: string; name?: string };

export async function login({ email, phone, password }: LoginInput) {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: email ?? undefined }, { phone: phone ?? undefined }] },
    select: { id: true, passwordHash: true, role: true, tokenVersion: true }
  });
  if (!user) throw Object.assign(new Error('INVALID_CREDENTIALS'), { status: 401, code: 'BAD_CREDENTIALS' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw Object.assign(new Error('INVALID_CREDENTIALS'), { status: 401, code: 'BAD_CREDENTIALS' });

  const payload = { sub: user.id, role: user.role, ver: user.tokenVersion };
  const access = signAccessToken(payload);
  const refresh = signRefreshToken(payload);
  return { access, refresh };
}

export async function register({ email, password, name }: RegisterInput) {
  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hash,
        // name isn't a field on User in schema; if you need to store name consider Client relation or add field later
      },
      select: { id: true, role: true, tokenVersion: true }
    });

    const payload = { sub: user.id, role: user.role, ver: user.tokenVersion };
    const access = signAccessToken(payload);
    const refresh = signRefreshToken(payload);
    return { access, refresh };
  } catch (e: any) {
    // Handle unique constraint violation (email already taken)
    if (e?.code === 'P2002') {
      throw Object.assign(new Error('EMAIL_TAKEN'), { status: 409, code: 'EMAIL_TAKEN' });
    }
    throw e;
  }
}

export async function refresh(refreshToken: string) {
  const payload = verifyRefresh<{ sub: number; role: string; ver: number }>(refreshToken);
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, role: true, tokenVersion: true }
  });
  if (!user || user.tokenVersion !== payload.ver) {
    throw Object.assign(new Error('INVALID_TOKEN'), { status: 401 });
  }
  const newPayload = { sub: user.id, role: user.role, ver: user.tokenVersion };
  return {
    access: signAccessToken(newPayload),
    refresh: signRefreshToken(newPayload),
  };
}

export async function logoutAll(userId: number) {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } }
  });
  return { ok: true };
}
