// src/middleware/validate.ts
import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError, ZodIssue } from 'zod';
import { ValidationError } from './httpError.js';

type Location = 'body' | 'params' | 'query';

function formatZodIssues(issues: ZodIssue[]) {
  return issues.map((i) => ({
    path: i.path.join('.'),
    code: i.code,
    message: i.message,
  }));
}

/**
 * Drop-in совместимая версия:
 * validate(schema, 'body' | 'params' | 'query')
 */
export function validate(schema: ZodSchema, location: Location = 'body') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const target =
        location === 'body' ? req.body :
        location === 'params' ? req.params :
        req.query;

      // поддержка async refinements
      const parsed = await schema.parseAsync(target);

      if (location === 'body')   (req as any).body = parsed;
      if (location === 'params') (req as any).params = parsed;
      if (location === 'query')  (req as any).query = parsed;

      return next();
    } catch (e: any) {
      if (e?.name === 'ZodError') {
        const issues = formatZodIssues((e as ZodError).issues || []);
        return next(ValidationError(issues[0]?.message || 'Invalid request', { issues }));
      }
      return next(e);
    }
  };
}

/**
 * Валидировать сразу несколько частей запроса.
 * Пример:
 *   router.get(
 *     '/:id',
 *     validateAll({ params: IdParam, query: FilterQuery })
 *   )
 */
export function validateAll(schemas: Partial<Record<Location, ZodSchema>>) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        const parsed = await schemas.body.parseAsync(req.body);
        (req as any).body = parsed;
      }
      if (schemas.params) {
        const parsed = await schemas.params.parseAsync(req.params);
        (req as any).params = parsed;
      }
      if (schemas.query) {
        const parsed = await schemas.query.parseAsync(req.query);
        (req as any).query = parsed;
      }
      return next();
    } catch (e: any) {
      if (e?.name === 'ZodError') {
        const issues = formatZodIssues((e as ZodError).issues || []);
        return next(ValidationError(issues[0]?.message || 'Invalid request', { issues }));
      }
      return next(e);
    }
  };
}
