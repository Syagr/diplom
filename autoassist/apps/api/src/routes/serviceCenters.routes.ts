// src/routes/serviceCenters.routes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import prisma from '../utils/prisma.js';
import { findNearbyServiceCenters } from '../services/serviceCenters.service.js';

const router = Router();

const ServiceCenterBody = z.object({
  name: z.string().min(2).max(120),
  phone: z.string().min(5).max(32).optional(),
  email: z.string().email().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  scheduleJson: z.any().optional(),
  amenitiesJson: z.any().optional(),
  rating: z.number().min(0).max(5).optional(),
});

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

router.get('/', authenticate, requireRole(['admin', 'service_manager', 'dispatcher']), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.serviceCenter.findMany({
      orderBy: { id: 'asc' },
    });
    return res.json({ items });
  } catch (e) {
    return next(e);
  }
});

router.post('/', authenticate, requireRole(['admin', 'service_manager']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ServiceCenterBody.parse(req.body);
    const created = await prisma.serviceCenter.create({ data: body as any });
    return res.status(201).json({ success: true, data: created });
  } catch (e) {
    return next(e);
  }
});

router.put('/:id', authenticate, requireRole(['admin', 'service_manager']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
    const body = ServiceCenterBody.partial().parse(req.body);
    const updated = await prisma.serviceCenter.update({ where: { id }, data: body as any });
    return res.json({ success: true, data: updated });
  } catch (e) {
    return next(e);
  }
});

router.delete('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
    await prisma.serviceCenter.delete({ where: { id } });
    return res.json({ success: true });
  } catch (e) {
    return next(e);
  }
});

export default router;
