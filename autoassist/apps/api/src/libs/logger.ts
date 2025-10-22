// src/libs/logger.ts
import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

// Relax types for metadata by augmenting the logger with a generic signature
const base = pino({
  level,
  base: {
    service: process.env.SERVICE_NAME || 'autoassist-api',
    env: process.env.NODE_ENV || 'development',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            singleLine: false,
          },
        },
      }),
});

type AnyRecord = Record<string, unknown>;
export const logger = {
  info: (msg: string, meta?: AnyRecord, ...args: unknown[]) => base.info({ ...(meta || {}) }, msg, ...args),
  warn: (msg: string, meta?: AnyRecord, ...args: unknown[]) => base.warn({ ...(meta || {}) }, msg, ...args),
  error: (msg: string, meta?: AnyRecord, ...args: unknown[]) => base.error({ ...(meta || {}) }, msg, ...args),
  debug: (msg: string, meta?: AnyRecord, ...args: unknown[]) => base.debug({ ...(meta || {}) }, msg, ...args),
};

export default logger;
