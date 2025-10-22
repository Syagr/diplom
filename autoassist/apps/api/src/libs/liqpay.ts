// src/libs/liqpay.ts
import crypto from 'node:crypto';

const PUBLIC_KEY = process.env.LIQPAY_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.LIQPAY_PRIVATE_KEY || '';
const LIQPAY_API_URL =
  process.env.LIQPAY_CHECKOUT_URL || 'https://www.liqpay.ua/api/3/checkout';

export type LiqPayCurrency = 'UAH' | 'USD' | 'EUR';
export interface CheckoutParams {
  public_key: string;
  version: number;
  action: 'pay';
  amount: number;
  currency: LiqPayCurrency;
  description: string;
  order_id: string;
  result_url?: string;
  server_url?: string;
  language?: 'uk' | 'ru' | 'en';
}

function base64(data: string) {
  return Buffer.from(data).toString('base64');
}

function sha1(data: string) {
  return crypto.createHash('sha1').update(data).digest('base64');
}

/**
 * Создать checkout-пакет и URL для редиректа на LiqPay.
 */
export function createCheckout(
  amount: number,
  orderId: number | string,
  opts?: {
    currency?: LiqPayCurrency;
    description?: string;
    resultUrl?: string;
    serverUrl?: string;
    language?: 'uk' | 'ru' | 'en';
  }
): { url: string; data: string; signature: string } {
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error('LiqPay keys are not configured');
  }

  const payload: CheckoutParams = {
    public_key: PUBLIC_KEY,
    version: 3,
    action: 'pay',
    amount: Number(amount),
    currency: opts?.currency || 'UAH',
    description:
      opts?.description || `Оплата замовлення #${orderId} у AutoAssist+`,
    order_id: String(orderId),
    result_url:
      opts?.resultUrl || `${process.env.PUBLIC_BASE_URL || ''}/payments/success`,
    server_url:
      opts?.serverUrl || `${process.env.API_BASE_URL || ''}/api/payments/webhook`,
    language: opts?.language || 'uk',
  };

  const json = JSON.stringify(payload);
  const data = base64(json);
  const signature = sha1(PRIVATE_KEY + data + PRIVATE_KEY);

  const url = `${LIQPAY_API_URL}?data=${encodeURIComponent(
    data
  )}&signature=${encodeURIComponent(signature)}`;

  return { url, data, signature };
}
