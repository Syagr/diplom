import type { Request, Response, NextFunction } from 'express';
import { verifyAccess } from '../utils/jwt.js';
import { Unauthorized, Forbidden } from '../utils/httpError.js';

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const hdr = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(hdr);
  if (!m) return next(Unauthorized());
  try {
    const payload = verifyAccess<{ sub: number; role: string; ver: number }>(m[1]);
    (req as any).user = { id: payload.sub, role: payload.role, ver: payload.ver };
    next();
  } catch {
    next(Unauthorized());
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
