import type { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { ValidationError } from './httpError.js';

type Location = 'body' | 'params' | 'query';

export function validate(schema: ZodSchema, location: Location = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const target = (location === 'body') ? req.body : (location === 'params' ? req.params : req.query);
      const parsed = schema.parse(target);
      if (location === 'body') req.body = parsed;
      if (location === 'params') req.params = parsed as any;
      if (location === 'query') req.query = parsed as any;
      return next();
    } catch (e: any) {
      if (e?.name === 'ZodError') return next(ValidationError(e.errors?.[0]?.message || 'Invalid request'));
      return next(e);
    }
  };
}
