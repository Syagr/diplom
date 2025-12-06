// src/routes/test.routes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { handleStripeEvent } from '../services/payments.service.js';
import { verifyAndCompleteWeb3PaymentFromReceipt } from '../services/web3payments.service.js';

const router = Router();

// POST /api/test/stripe-event
// Test-only helper: inject a synthetic Stripe-like event payload directly into handler.
router.post('/stripe-event', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV !== 'test') {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const { event } = req.body || {};
    if (!event || typeof event !== 'object' || !event.id || !event.type) {
      return res.status(400).json({ error: 'INVALID_EVENT' });
    }
    // Make event and nested ids unique per invocation to avoid uniqueness collisions in repeated test runs
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    event.id = `evt_${suffix}`;
    if (event?.data?.object) {
      const obj: any = event.data.object;
      if (obj.payment_intent) obj.payment_intent = `pi_${suffix}`;
      if (obj.id) obj.id = `cs_${suffix}`;
    }
    const result = await handleStripeEvent(event);
    return res.json(result || { ok: true });
  } catch (e) {
    return next(e);
  }
});

// POST /api/test/web3-receipt
// Test-only helper: verify web3 payment using a provided transaction receipt (no RPC).
router.post('/web3-receipt', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (process.env.NODE_ENV !== 'test') {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const { orderId, paymentId, txHash, receipt } = req.body || {};
    if (!orderId || !paymentId || !txHash || !receipt) {
      return res.status(400).json({ error: 'INVALID_INPUT' });
    }
    const result = await verifyAndCompleteWeb3PaymentFromReceipt({ orderId: Number(orderId), paymentId: Number(paymentId), txHash, receipt });
    return res.json({ ok: true, payment: { id: result.id, status: result.status, txHash: result.txHash } });
  } catch (e) {
    return next(e);
  }
});

export default router;
