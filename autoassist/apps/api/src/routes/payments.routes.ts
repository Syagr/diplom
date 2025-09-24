import { Router } from 'express';
import { z } from 'zod';
import { createInvoice, handleStripeEvent } from '../services/payments.service.js';
import { stripe } from '../utils/stripe.js';
import { BadRequest } from '../utils/httpError.js';

export const paymentsRouter = Router();

const getAuth = (req: any) => ({ userId: Number(req.user?.id ?? 0), role: String(req.user?.role ?? 'customer') });

const CreateInvoiceBody = z.object({
  orderId: z.number().int().positive(),
  amount: z.number().positive(),
  purpose: z.enum(['ADVANCE','REPAIR','INSURANCE']),
  provider: z.enum(['LIQPAY','STRIPE']).default('STRIPE'),
  currency: z.string().optional()
});

paymentsRouter.post('/invoice', async (req, res, next) => {
  try {
    const body = CreateInvoiceBody.parse(req.body);
    const { userId, role } = getAuth(req);
    if (body.provider !== 'STRIPE') {
      return next(BadRequest('ONLY_STRIPE_IMPLEMENTED'));
    }
  const data = await createInvoice(userId, role, body as any);
    res.status(201).json(data);
  } catch (e) { next(e); }
});

// >>>> НОВОЕ: экспортируем чистый обработчик вебхука <<<<
export function stripeWebhookHandler(req: any, res: any, next: any) {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig || Array.isArray(sig)) {
      return next(BadRequest('SIGNATURE_MISSING'));
    }
    const secret = process.env.STRIPE_WEBHOOK_SECRET!;
    const event = stripe.webhooks.constructEvent(req.rawBody as string, sig, secret);
    handleStripeEvent(event)
      .then(result => res.json(result))
      .catch(next);
  } catch (e) { next(e); }
}

export default paymentsRouter;