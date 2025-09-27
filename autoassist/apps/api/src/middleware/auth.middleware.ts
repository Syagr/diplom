import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Unauthorized, Forbidden } from '../utils/httpError.js';

type JwtPayload = { sub: number; role?: string; ver?: number; iat?: number; exp?: number };

// Robust authenticate middleware: accepts token from Authorization Bearer, x-access-token header or cookies
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  // Diagnostic logging (dev only) - prints Authorization header and cookie string
  try {
    // eslint-disable-next-line no-console
    console.log('AUTH HEADERS', { authorization: req.headers.authorization, cookie: req.headers.cookie, xAccess: req.headers['x-access-token'] });
  } catch (e) {}

  try {
    const h = (req.headers['authorization'] ?? (req.headers as any)['Authorization']) as string | undefined;
    const bearer = h?.match(/^Bearer\s+(.+)$/i)?.[1];
    const xAccess = typeof req.headers['x-access-token'] === 'string' ? (req.headers['x-access-token'] as string) : undefined;
    const cookieTok = (req as any).cookies?.accessToken as string | undefined || (req as any).cookies?.access as string | undefined;

    const token = bearer || xAccess || cookieTok;
    if (!token) return next(Unauthorized());

    const secret = process.env.JWT_SECRET;
    if (!secret) return next(Unauthorized());

  const raw = jwt.verify(token, secret) as unknown;
  const payload = raw as JwtPayload;
  const sub = typeof payload.sub === 'string' ? parseInt(payload.sub, 10) : (payload.sub ?? 0);
  (req as any).user = { id: sub, role: payload.role ?? 'user', ver: payload.ver ?? 0 };
    return next();
  } catch (err: any) {
    try {
      // eslint-disable-next-line no-console
      console.error('AUTH ERROR', { name: err?.name, message: err?.message });
    } catch (e) {}
    return next(Unauthorized());
  }
}

export function requireRole(roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = String((req as any).user?.role || '');
    if (!role || !roles.includes(role)) {
      return next(Forbidden());
    }
    next();
  };
}
