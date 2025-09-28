import type { AnyZodObject } from 'zod';
import { ZodError } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { zodToUa } from '../utils/zod-ua.js';

export function validate(
  schema: { body?: AnyZodObject; query?: AnyZodObject; params?: AnyZodObject }
) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body)  req.body  = schema.body.parse(req.body);
      if (schema.query) req.query = schema.query.parse(req.query);
      if (schema.params) req.params = schema.params.parse(req.params);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json(zodToUa(err));
      }
      next(err);
    }
  };
}
