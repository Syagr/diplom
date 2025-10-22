// src/utils/stripe.ts
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error('ENV STRIPE_SECRET_KEY is required');

/**
 * Если хочешь пиновать версию API, укажи её в .env:
 *   STRIPE_API_VERSION=2024-06-20
 * Конфиг типобезопасен: строка приводится к типу Stripe.StripeConfig['apiVersion'].
 * Если переменная не задана — версия берётся из Dashboard (recommended by Stripe).
 */
const apiVersion = process.env.STRIPE_API_VERSION as Stripe.StripeConfig['apiVersion'] | undefined;

export const stripe = new Stripe(key, {
  apiVersion,
  // Автоматические ретраи на сетевые ошибки/429
  maxNetworkRetries: Number(process.env.STRIPE_MAX_NETWORK_RETRIES ?? 2),
  // Для Node 18+ можно явно выбрать http-клиент; по умолчанию ок
  // httpClient: Stripe.createFetchHttpClient(),
  // Удобно видеть в логах, что это за приложение
  appInfo: {
    name: 'AutoAssist+',
    version: process.env.APP_VERSION || '1.0.0',
    url: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
  },
  // Stripe telemetry помогает Stripe диагностировать SDK-проблемы (в проде обычно включено)
  telemetry: process.env.STRIPE_TELEMETRY !== 'off',
});

export default stripe;

/**
 * Helper для Stripe webhook:
 * - Читает и валидирует подпись из заголовка 'stripe-signature'
 * - Требует, чтобы в express Request был `rawBody` (см. raw body мидлварь).
 * - Секрет берёт из ENV STRIPE_WEBHOOK_SECRET.
 *
 * Пример использования в маршруте:
 *   const event = constructStripeEvent(req); // бросит 400 при проблеме
 *   await handleStripeEvent(event);
 */
export function constructStripeEvent(req: { headers: any; rawBody?: string | Buffer }) {
  const sig = req.headers?.['stripe-signature'];
  if (!sig || Array.isArray(sig)) {
    const e: any = new Error('SIGNATURE_MISSING');
    e.status = 400;
    throw e;
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const e: any = new Error('ENV STRIPE_WEBHOOK_SECRET is required');
    e.status = 500;
    throw e;
  }
  if (!req.rawBody) {
    const e: any = new Error('RAW_BODY_REQUIRED');
    e.status = 400;
    throw e;
  }
  // rawBody может быть Buffer или string — Stripe примет оба
  return stripe.webhooks.constructEvent(req.rawBody as any, sig, secret);
}
