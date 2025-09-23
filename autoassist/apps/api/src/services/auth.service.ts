import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefresh } from '../utils/jwt.js';

type LoginInput = { email?: string; phone?: string; password: string };

export async function login({ email, phone, password }: LoginInput) {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: email ?? undefined }, { phone: phone ?? undefined }] },
    select: { id: true, passwordHash: true, role: true, tokenVersion: true }
  });
  if (!user) throw Object.assign(new Error('INVALID_CREDENTIALS'), { status: 401 });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw Object.assign(new Error('INVALID_CREDENTIALS'), { status: 401 });

  const payload = { sub: user.id, role: user.role, ver: user.tokenVersion };
  const access = signAccessToken(payload);
  const refresh = signRefreshToken(payload);
  return { access, refresh };
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
