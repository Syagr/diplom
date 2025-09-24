export type HttpErr = Error & { status?: number; code?: string };

function h(status: number, code: string, message?: string): HttpErr {
  const e: HttpErr = new Error(message || code);
  e.status = status;
  e.code = code;
  return e;
}

export const Unauthorized = (msg?: string) => h(401, 'UNAUTHORIZED', msg);
export const Forbidden = (msg?: string) => h(403, 'FORBIDDEN', msg);
export const NotFound = (msg?: string) => h(404, 'NOT_FOUND', msg);
export const ValidationError = (msg?: string) => h(422, 'VALIDATION_ERROR', msg);
export const BadRequest = (msg?: string) => h(400, 'BAD_REQUEST', msg);
export const Conflict = (msg?: string) => h(409, 'CONFLICT', msg);

export const HttpError = { h, Unauthorized, Forbidden, NotFound, ValidationError, BadRequest, Conflict };
