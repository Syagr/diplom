import jwt from 'jsonwebtoken';

const ACCESS_SECRET = process.env.JWT_SECRET || '';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '';
const ACCESS_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TTL = process.env.REFRESH_TOKEN_TTL || '30d';

export type BasePayload = { sub: number; role: string; ver: number };

const jwtAny = jwt as any;

export function signAccessToken(payload: BasePayload) {
  return jwtAny.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}
export function signRefreshToken(payload: BasePayload) {
  return jwtAny.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyAccess<T extends BasePayload>(token: string): T {
  return jwtAny.verify(token, ACCESS_SECRET) as T;
}
export function verifyRefresh<T extends BasePayload>(token: string): T {
  return jwtAny.verify(token, REFRESH_SECRET) as T;
}
