// src/routes/estimates.routes.new.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { autoCalculateEstimate, lockEstimate } from '../services/estimates.service.js';
import prisma from '../utils/prisma.js';

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

// Compatibility: approve by estimate id
router.post('/:id/approve', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user as { id: number; role?: string } | undefined;
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const estimateId = z.coerce.number().int().positive().parse(req.params.id);
    const estimate = await prisma.estimate.findUnique({
      where: { id: estimateId },
      include: { order: { select: { id: true, clientId: true } } },
    });
    if (!estimate) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Estimate not found' } });

    const isStaff = ['admin', 'manager'].includes(String(user.role || '').toLowerCase());
    let isOwner = false;
    if (!isStaff) {
      const u = await prisma.user.findUnique({ where: { id: user.id }, select: { clientId: true } });
      isOwner = !!u?.clientId && u.clientId === estimate.order?.clientId;
    }
    if (!isStaff && !isOwner) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    if (estimate.approved) {
      return res.status(409).json({ error: { code: 'ALREADY_APPROVED', message: 'Estimate already approved' } });
    }

    const locked = await lockEstimate(estimate.orderId);
    const io = req.app.get('io');
    io?.to(`order:${estimate.orderId}`).emit('estimate:locked', { orderId: estimate.orderId, estimateId: locked.id });
    const payload = { ...locked, total: Number((locked as any).total) } as any;
    return res.json({ estimate: payload });
  } catch (e) {
    return next(e);
  }
});

export default router;
