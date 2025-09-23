import { Router } from 'express';
import { z } from 'zod';
// @ts-ignore
import { createInvoice, onPaid } from '../services/payments.service.new';

export const payments = Router();

payments.post('/invoice', async (req, res, next) => {
  try {
    const body = z.object({ orderId: z.number(), amount: z.number().positive() }).parse(req.body);
    const inv = await createInvoice(body.orderId, body.amount);
    res.status(201).json({ payment: inv });
  } catch (e) { next(e); }
});

// Заглушка webhook: в реальности проверяй подписи провайдера
payments.post('/webhook', async (req, res, next) => {
  try {
    const body = z.object({ orderId: z.number(), paymentId: z.number(), status: z.enum(['COMPLETED','FAILED']) }).parse(req.body);
    if (body.status === 'COMPLETED') {
      const p = await onPaid(body.orderId, body.paymentId);
      req.app.get('io').to(`order:${body.orderId}`).emit('payment:status', { orderId: body.orderId, paymentId: p.id, status: p.status });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});