// src/config.ts
// Ensure .env is loaded when this module is imported (dev/local)
import 'dotenv/config';
import { z } from 'zod';

/**
 * Schema & validation
 * - оставляем TTL как строки (например "15m", "30d") — пусть библиотека JWT их парсит
 * - делаем мягкие дефолты, но критичные ключи обязательны
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Required secrets
  JWT_SECRET: z.string().min(1, 'ENV JWT_SECRET is required'),
  JWT_REFRESH_SECRET: z.string().min(1, 'ENV JWT_REFRESH_SECRET is required'),

  // Optional with defaults
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),

  // Часто полезные опции; не обязательны
  PORT: z
    .string()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().positive().optional())
    .optional(),
  CORS_ORIGIN: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Сформируем удобное сообщение об ошибках по env
  const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Invalid environment variables: ${issues}`);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

// Экспорт тех же констант, что были в исходнике — для drop-in совместимости
export const JWT_SECRET = env.JWT_SECRET;
export const JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET;
export const ACCESS_TOKEN_TTL = env.ACCESS_TOKEN_TTL;   // e.g. "15m"
export const REFRESH_TOKEN_TTL = env.REFRESH_TOKEN_TTL; // e.g. "30d"

// Дополнительно — порт и cors, если хочешь использовать
export const PORT = env.PORT ?? 3000;
export const CORS_ORIGIN = env.CORS_ORIGIN ?? '*';

// Также можно экспортировать объект конфигурации целиком
const config = {
  NODE_ENV: env.NODE_ENV,
  isProd,
  isDev,
  isTest,
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
  PORT,
  CORS_ORIGIN,
};

export default config;
