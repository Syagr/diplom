// src/routes/estimates.routes.new.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { autoCalculateEstimate, lockEstimate } from '../services/estimates.service.js';

const router = Router();

const AutoBody = z.object({
  orderId: z.coerce.number().int().positive(),
  profile: z.enum(['ECONOMY', 'STANDARD', 'PREMIUM']).default('STANDARD'),
  night: z.coerce.boolean().optional(),
  urgent: z.coerce.boolean().optional(),
  suv: z.coerce.boolean().optional(),
});

router.post('/auto', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
  const body = AutoBody.parse(req.body);
  const params = { orderId: body.orderId as number, profile: body.profile, night: body.night, urgent: body.urgent, suv: body.suv };
  const est = await autoCalculateEstimate(params);
    const io = req.app.get('io');
    io?.to(`order:${body.orderId}`).emit('estimate:updated', { orderId: body.orderId, estimateId: est.id, total: est.total });
    // Ensure numeric total for test stability (Prisma Decimal may serialize as string)
    const estimate = { ...est, total: Number((est as any).total) } as any;
    return res.status(201).json({ estimate });
  } catch (e) {
    return next(e);
  }
});

router.post('/:orderId/lock', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = z.coerce.number().int().positive().parse(req.params.orderId);
    const est = await lockEstimate(orderId);
    const io = req.app.get('io');
    io?.to(`order:${orderId}`).emit('estimate:locked', { orderId, estimateId: est.id });
    const estimate = { ...est, total: Number((est as any).total) } as any;
    return res.json({ estimate });
  } catch (e) {
    return next(e);
  }
});

export default router;
