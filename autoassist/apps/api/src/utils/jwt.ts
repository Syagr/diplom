import jwt from 'jsonwebtoken';

const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL = process.env.REFRESH_TOKEN_TTL || '30d';

export type BasePayload = { sub: number; role: string; ver: number };

const jwtAny = jwt as any;

export function signAccessToken(payload: BasePayload) {
  const secret = process.env.JWT_SECRET || '';
  const raw = process.env.ACCESS_TOKEN_TTL ?? ACCESS_TTL;
  const expiresIn = /^[0-9]+$/.test(String(raw)) ? Number(raw) : raw;
  return jwtAny.sign(payload, secret, { expiresIn });
}
export function signRefreshToken(payload: BasePayload) {
  const secret = process.env.JWT_REFRESH_SECRET || '';
  const raw = process.env.REFRESH_TOKEN_TTL ?? REFRESH_TTL;
  const expiresIn = /^[0-9]+$/.test(String(raw)) ? Number(raw) : raw;
  return jwtAny.sign(payload, secret, { expiresIn });
}

export function verifyAccess<T extends BasePayload>(token: string): T {
  const secret = process.env.JWT_SECRET || '';
  return jwtAny.verify(token, secret) as T;
}
export function verifyRefresh<T extends BasePayload>(token: string): T {
  const secret = process.env.JWT_REFRESH_SECRET || '';
  return jwtAny.verify(token, secret) as T;
}
