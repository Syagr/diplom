// src/routes/calcProfiles.routes.ts
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';
import { listProfiles, createProfile, updateProfile, deleteProfile } from '../services/calcProfiles.service.js';

const router = Router();

const UpsertSchema = z.object({
  code: z.string().min(2).max(32).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(2).max(64),
  partsCoeff: z.number().positive().max(5).optional(),
  laborCoeff: z.number().positive().max(5).optional(),
  nightCoeff: z.number().positive().max(5).optional(),
  urgentCoeff: z.number().positive().max(5).optional(),
  suvCoeff: z.number().positive().max(5).optional(),
  laborRate: z.number().positive().max(100000).optional(),
  active: z.boolean().optional(),
});

// List
router.get('/', authenticate, requireRole(['admin','service_manager','dispatcher']), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await listProfiles();
    res.json({ success: true, data });
  } catch (e) { next(e); }
});

// Create
router.post('/', authenticate, requireRole(['admin','service_manager']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = UpsertSchema.parse(req.body) as any;
    const input: import('../services/calcProfiles.service.js').CalcProfileInput = {
      code: raw.code,
      name: raw.name,
      partsCoeff: raw.partsCoeff,
      laborCoeff: raw.laborCoeff,
      nightCoeff: raw.nightCoeff,
      urgentCoeff: raw.urgentCoeff,
      suvCoeff: raw.suvCoeff,
      laborRate: raw.laborRate,
      active: raw.active,
    };
    const created = await createProfile(input);
    res.status(201).json({ success: true, data: created });
  } catch (e) { next(e); }
});

// Update
router.put('/:id', authenticate, requireRole(['admin','service_manager']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
    const body: Partial<import('../services/calcProfiles.service.js').CalcProfileInput> = UpsertSchema.partial().parse(req.body);
    const updated = await updateProfile(id, body);
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
});

// Delete
router.delete('/:id', authenticate, requireRole(['admin']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'INVALID_ID' });
    const result = await deleteProfile(id);
    res.json(result);
  } catch (e) { next(e); }
});

export default router;
