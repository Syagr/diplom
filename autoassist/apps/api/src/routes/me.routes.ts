import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '@/utils/prisma.js';
import { authenticate } from '@/middleware/auth.middleware.js';

const router = Router();

const UpdateBody = z.object({
  name: z.string().max(120).optional(),
  email: z.string().email().max(320).optional(),
  phone: z.string().max(32).optional(),
});

router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = Number((req as any).user?.id);
    if (!Number.isFinite(userId)) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, walletAddress: true, role: true, clientId: true },
    });
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });

    return res.json(user);
  } catch (e) {
    return next(e);
  }
});

router.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = Number((req as any).user?.id);
    if (!Number.isFinite(userId)) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const body = UpdateBody.parse(req.body);
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const phone = body.phone?.trim();

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name === '' ? null : name,
        email: email === '' ? null : email,
        phone: phone === '' ? null : phone,
      },
      select: { id: true, name: true, email: true, phone: true, walletAddress: true, role: true, clientId: true },
    });

    return res.json(updated);
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Email or phone already in use' } });
    }
    return next(e);
  }
});

export default router;
