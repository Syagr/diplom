// src/utils/jwt.ts
import jwt from 'jsonwebtoken';

export type BasePayload = { sub: number; role: string; ver: number };

type SignOpts = {
  /** JWT audience */
  aud?: string | string[];
  /** JWT issuer */
  iss?: string;
  /** Доп. заголовки токена */
  header?: jwt.JwtHeader;
};

type VerifyOpts = {
  aud?: string | (string | RegExp)[] | RegExp;
  iss?: string;
  /** Допуск часов в секундах (по умолчанию 5 сек) */
  clockToleranceSec?: number;
};

const ACCESS_TTL_ENV = process.env.ACCESS_TOKEN_TTL ?? '15m';
const REFRESH_TTL_ENV = process.env.REFRESH_TOKEN_TTL ?? '30d';
const CLOCK_SKEW_SEC = Number(process.env.JWT_CLOCK_SKEW_SEC ?? 5);

/** Парсим ttl: "15m" | "30d" | 900 -> оставляем как строку либо число */
function parseTtl(raw: string | number | undefined, fallback: string): string | number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'number') return raw;
  const s = String(raw).trim();
  return /^[0-9]+$/.test(s) ? Number(s) : s; // "900" -> 900 (sec), иное — оставляем строкой, чтобы jsonwebtoken сам распарсил ("15m","2h")
}

/** Жёстко пиним алгоритм (HS256). Если нужен RS256 — расширим опциями отдельно. */
const ACCESS_SECRET = process.env.JWT_SECRET || '';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || '';
const ACCESS_EXPIRES_IN = parseTtl(process.env.ACCESS_TOKEN_TTL, ACCESS_TTL_ENV);
const REFRESH_EXPIRES_IN = parseTtl(process.env.REFRESH_TOKEN_TTL, REFRESH_TTL_ENV);

const alg: jwt.Algorithm = 'HS256';

function assertSecret(name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET', value: string) {
  if (!value) {
    const e: any = new Error(`ENV ${name} is required`);
    e.code = 'ENV_MISSING';
    throw e;
  }
}

/** ---- Signers ---- */
export function signAccessToken(payload: BasePayload, opts: SignOpts = {}) {
  assertSecret('JWT_SECRET', ACCESS_SECRET);
  const signOpts: jwt.SignOptions = {
    algorithm: alg,
    expiresIn: ACCESS_EXPIRES_IN as any,
  };
  if (typeof opts.iss !== 'undefined') {
    signOpts.issuer = opts.iss;
  }
  if (typeof opts.aud !== 'undefined') {
    signOpts.audience = opts.aud as any;
  }
  if (typeof opts.header !== 'undefined') {
    signOpts.header = opts.header;
  }
  return jwt.sign(payload, ACCESS_SECRET, signOpts);
}

export function signRefreshToken(payload: BasePayload, opts: SignOpts = {}) {
  assertSecret('JWT_REFRESH_SECRET', REFRESH_SECRET);
  const signOpts: jwt.SignOptions = {
    algorithm: alg,
    expiresIn: REFRESH_EXPIRES_IN as any,
  };
  if (typeof opts.iss !== 'undefined') {
    signOpts.issuer = opts.iss;
  }
  if (typeof opts.aud !== 'undefined') {
    signOpts.audience = opts.aud as any;
  }
  if (typeof opts.header !== 'undefined') {
    signOpts.header = opts.header;
  }
  return jwt.sign(payload, REFRESH_SECRET, signOpts);
}

/** ---- Verifiers ---- */
export function verifyAccess<T extends BasePayload>(token: string, opts: VerifyOpts = {}): T {
  assertSecret('JWT_SECRET', ACCESS_SECRET);
  // Coerce audience type per @types/jsonwebtoken
  const audience = Array.isArray(opts.aud)
    ? (opts.aud.length === 1 ? opts.aud[0] : (opts.aud as [string | RegExp, ...(string | RegExp)[]]))
    : (opts.aud as string | RegExp | undefined);
  return jwt.verify(token, ACCESS_SECRET, {
    algorithms: [alg],
    audience,
    issuer: opts.iss,
    clockTolerance: opts.clockToleranceSec ?? CLOCK_SKEW_SEC,
  }) as unknown as T;

}
export function verifyRefresh<T extends BasePayload>(token: string, opts: VerifyOpts = {}): T {
  assertSecret('JWT_REFRESH_SECRET', REFRESH_SECRET);
  const audience = Array.isArray(opts.aud)
    ? (opts.aud.length === 1 ? opts.aud[0] : (opts.aud as [string | RegExp, ...(string | RegExp)[]]))
    : (opts.aud as string | RegExp | undefined);
  return jwt.verify(token, REFRESH_SECRET, {
    algorithms: [alg],
    audience,
    issuer: opts.iss,
    clockTolerance: opts.clockToleranceSec ?? CLOCK_SKEW_SEC,
  }) as unknown as T;
}

/** ---- Helpers ---- */

/** Без верификации (например, для логов/трассировки). Не используйте для авторизации. */
export function decodeJwt<T = unknown>(token: string): { header: jwt.JwtHeader; payload: T } | null {
  const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt | null;
  if (!decoded || typeof decoded !== 'object' || !('header' in decoded)) return null;
  return { header: decoded.header as jwt.JwtHeader, payload: decoded.payload as T };
}

/** Достаёт Bearer токен из Authorization header. */
export function getBearerToken(authorization?: string | null): string | null {
  if (!authorization) return null;
  const [scheme, token] = authorization.split(' ');
  if (!scheme || !token) return null;
  return /^Bearer$/i.test(scheme) ? token : null;
}
