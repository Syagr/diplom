import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Unauthorized, Forbidden } from '../utils/httpError.js';

type JwtPayload = {
  sub: number | string;
  role?: string;
  ver?: number;
  iat?: number;
  exp?: number;
};

function extractToken(req: Request): string | undefined {
  const auth = (req.headers['authorization'] ??
    (req.headers as any)['Authorization']) as string | undefined;
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1];

  const xAccess =
    typeof req.headers['x-access-token'] === 'string'
      ? (req.headers['x-access-token'] as string)
      : undefined;

  const cookies = (req as any).cookies || {};
  const cookieTok: string | undefined = cookies.accessToken || cookies.access;

  return bearer || xAccess || cookieTok;
}

// Robust authenticate middleware
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) return next(Unauthorized());

    const secret = process.env.JWT_SECRET;
    if (!secret) return next(Unauthorized());

    const raw = jwt.verify(token, secret, { algorithms: ['HS256'] }) as unknown;
    const payload = raw as JwtPayload;

    // normalize sub → number
    const sub =
      typeof payload.sub === 'string' ? parseInt(payload.sub, 10) : payload.sub;
    if (!sub || Number.isNaN(Number(sub))) return next(Unauthorized());

    const role = (payload.role || 'user').toString().toLowerCase();

    (req as any).user = { id: Number(sub), role, ver: payload.ver ?? 0 };
    return next();
  } catch (err: any) {
    // мягкая нормализация ошибок JWT (совместимо с ESM/CJS)
    const TokenExpiredError = (jwt as any)?.TokenExpiredError;
    const JsonWebTokenError = (jwt as any)?.JsonWebTokenError;
    if (TokenExpiredError && (err instanceof TokenExpiredError || err?.name === 'TokenExpiredError')) {
      return next(Unauthorized());
    }
    if (JsonWebTokenError && (err instanceof JsonWebTokenError || err?.name === 'JsonWebTokenError')) {
      return next(Unauthorized());
    }
    return next(Unauthorized());
  }
}

export function requireRole(roles: string[]) {
  const allow = new Set(roles.map((r) => r.toLowerCase()));
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = String((req as any).user?.role || '').toLowerCase();
    if (!role || !allow.has(role)) {
      return next(Forbidden());
    }
    next();
  };
}
