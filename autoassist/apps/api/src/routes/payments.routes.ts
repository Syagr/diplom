import { Router } from 'express';
import { z } from 'zod';
import { createInvoice, handleStripeEvent } from '../services/payments.service.js';
import { stripe } from '../utils/stripe.js';

const paymentsRouter = Router();

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
      const e: any = new Error('ONLY_STRIPE_IMPLEMENTED'); e.status = 400; throw e;
    }
    const data = await createInvoice(userId, role, body as any);
    res.status(201).json(data);
  } catch (e) { next(e); }
});

// Webhook handler will be registered as raw route in app.ts
paymentsRouter.post('/webhook', (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    if (!sig || Array.isArray(sig)) {
      const e: any = new Error('SIGNATURE_MISSING'); e.status = 400; throw e;
    }
    const secret = process.env.STRIPE_WEBHOOK_SECRET!;
    const event = stripe.webhooks.constructEvent((req as any).rawBody, sig, secret);
    handleStripeEvent(event)
      .then(result => res.json(result))
      .catch(err => res.status(500).json({ error: 'WEBHOOK_HANDLER_ERROR', detail: String(err) }));
  } catch (e) { res.status(400).json({ error: 'WEBHOOK_INVALID', message: (e as any).message }); }
});

export default paymentsRouter;