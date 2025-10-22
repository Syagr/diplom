// src/utils/httpError.ts
export type HttpErr = Error & {
  status?: number;
  code?: string;
  details?: unknown;
  cause?: unknown;
};

export class HttpError extends Error implements HttpErr {
  status?: number;
  code?: string;
  details?: unknown;
  cause?: unknown;

  constructor(status: number, code: string, message?: string, options?: { details?: unknown; cause?: unknown }) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
    // захватываем стек, сохраняя родительский
    if (typeof (Error as any).captureStackTrace === 'function') {
      (Error as any).captureStackTrace(this, HttpError);
    }
  }

  toJSON() {
    return {
      error: {
        status: this.status ?? 500,
        code: this.code ?? 'INTERNAL',
        message: this.message,
        details: this.details ?? null,
      },
    };
  }
}

/** Базовая фабрика (оставлена совместимой с твоей h) */
function h(status: number, code: string, message?: string, details?: unknown): HttpErr {
  return new HttpError(status, code, message, { details });
}

/** Фабрики 1:1 с твоими именами */
export const Unauthorized   = (msg?: string, details?: unknown) => h(401, 'UNAUTHORIZED', msg, details);
export const Forbidden      = (msg?: string, details?: unknown) => h(403, 'FORBIDDEN', msg, details);
export const NotFound       = (msg?: string, details?: unknown) => h(404, 'NOT_FOUND', msg, details);
export const ValidationError= (msg?: string, details?: unknown) => h(422, 'VALIDATION_ERROR', msg, details);
export const BadRequest     = (msg?: string, details?: unknown) => h(400, 'BAD_REQUEST', msg, details);
export const Conflict       = (msg?: string, details?: unknown) => h(409, 'CONFLICT', msg, details);

/** Сгруппированный экспорт (как у тебя) */
export const HttpErrorExport = { h, Unauthorized, Forbidden, NotFound, ValidationError, BadRequest, Conflict };
// Для drop-in совместимости со старым именем:
export const HttpErrorNS = HttpErrorExport;

/** Type guard */
export function isHttpError(err: unknown): err is HttpErr {
  return !!err && typeof err === 'object' && ('status' in (err as any) || 'code' in (err as any));
}

/** Удобные мапперы популярных ошибок в HttpErr */

// Zod -> 422
export function fromZod(error: any): HttpErr {
  const details = error?.issues ?? error?.errors ?? error;
  const msg = 'Validation failed';
  return ValidationError(msg, details);
}

// Prisma -> 4xx/5xx
export function fromPrisma(error: any): HttpErr {
  const code = error?.code as string | undefined;
  switch (code) {
    case 'P2002': return Conflict('Unique constraint violated', { target: error?.meta?.target });
    case 'P2025': return NotFound('Record not found');
    default:      return new HttpError(500, 'PRISMA_ERROR', error?.message ?? 'Database error', { details: { code, meta: error?.meta } });
  }
}

// Stripe -> 400/402
export function fromStripe(error: any): HttpErr {
  const status = Number(error?.statusCode ?? 402);
  const code = String(error?.code ?? 'STRIPE_ERROR');
  const msg = error?.message ?? 'Payment error';
  return new HttpError(status, code, msg, { details: { type: error?.type, decline_code: error?.decline_code } });
}

/** Обёртка для async-роутов: next(err) без try/catch вокруг каждой функции */
export const asyncRoute =
  <TArgs extends any[], TRes>(fn: (...args: TArgs) => Promise<TRes>) =>
    (...args: TArgs) => fn(...args).catch((err) => (args as any)[2]?.(err)); // args[2] = next

/** Express error middleware (можно подключить глобально) */
export function expressErrorMiddleware(err: any, _req: any, res: any, _next: any) {
  let httpErr: HttpErr;
  if (isHttpError(err)) {
    httpErr = err;
  } else if (err?.name === 'ZodError') {
    httpErr = fromZod(err);
  } else if (err?.code?.toString?.().startsWith('P')) {
    httpErr = fromPrisma(err);
  } else {
    httpErr = new HttpError(500, 'INTERNAL', err?.message ?? 'Internal server error', { details: err });
  }

  const status = httpErr.status ?? 500;
  const payload = (httpErr as any).toJSON?.() ?? {
    error: {
      status,
      code: httpErr.code ?? 'INTERNAL',
      message: httpErr.message ?? 'Internal server error',
      details: (httpErr as any).details ?? null,
    },
  };

  // не палим stack в проде
  if (process.env.NODE_ENV !== 'production' && err?.stack) {
    (payload.error as any).stack = String(err.stack);
  }

  res.status(status).json(payload);
}

/** Примеры использования:
 *   next(BadRequest('Missing orderId'));
 *   next(Conflict('Email taken'));
 *   throw NotFound('Order not found');
 *   try { … } catch (e) { next(fromPrisma(e)); }
 */
