// src/routes/serviceCenters.routes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
import { findNearbyServiceCenters } from '../services/serviceCenters.service.js';

const router = Router();

router.get('/nearby', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        limit: z.coerce.number().int().positive().max(50).optional(),
        maxKm: z.coerce.number().positive().max(1000).optional(),
      })
      .parse(req.query);

  const params = { lat: q.lat as number, lng: q.lng as number, limit: q.limit, maxKm: q.maxKm };
  const list = await findNearbyServiceCenters(params);
    return res.json({ items: list, count: list.length });
  } catch (e) {
    return next(e);
  }
});

export default router;
