// src/routes/orders.routes.new.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { completeOrder, getOrderProof } from '../services/orders.service.js';

const router = Router();

const CompleteBody = z.object({
  photos: z.array(z.coerce.number().int().positive()).max(10).optional(),
  coords: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  completedAt: z.string().datetime().optional(),
  notes: z.string().max(1000).optional(),
});

router.post('/:id/complete', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
    const actor = (req as any).user as { id: number; role?: string } | undefined;
    if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const body = CompleteBody.parse(req.body);
    const evidence = {
      photos: body.photos,
      coords: body.coords ? { lat: body.coords.lat, lng: body.coords.lng } : undefined,
      completedAt: body.completedAt,
      notes: body.notes,
    };
    const result = await completeOrder(id, actor.id, evidence);

    // emit socket
    const io = req.app.get('io');
    io?.to(`order:${id}`).emit('order:completed', { orderId: id, proofHash: result.proofHash });
    io?.to('dashboard').emit('order:completed', { orderId: id });

    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

// GET /:id/proof - returns proofHash and canonicalized evidence for completed order
router.get('/:id/proof', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
    const actor = (req as any).user as { id: number; role?: string } | undefined;
    if (!actor) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const proof = await getOrderProof(id, actor.id);
    return res.json({
      orderId: proof.orderId,
      proofHash: proof.proofHash,
      evidence: proof.evidence,
      createdAt: proof.createdAt,
    });
  } catch (e) {
    return next(e);
  }
});

export default router;
