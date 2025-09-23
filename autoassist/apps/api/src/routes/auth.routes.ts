import { Router } from 'express';
import { z } from 'zod';
import { login, refresh, logoutAll } from '../services/auth.service.js';
import { authenticate } from '../middleware/auth.middleware.js';

export const authRouter = Router();

const LoginBody = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(5).optional(),
  password: z.string().min(6),
}).refine(x => !!x.email || !!x.phone, { message: 'email or phone required' });
type LoginBodyT = z.infer<typeof LoginBody>;

authRouter.post('/login', async (req, res, next) => {
  try {
    const body: LoginBodyT = LoginBody.parse(req.body);
    const tokens = await login(body as any);
    res.json(tokens);
  } catch (e) { next(e); }
});

const RefreshBody = z.object({ refreshToken: z.string().min(10) });
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = RefreshBody.parse(req.body);
    const tokens = await refresh(refreshToken);
    res.json(tokens);
  } catch (e) { next(e); }
});

authRouter.post('/logout', authenticate, async (req, res, next) => {
  try {
    const userId = Number((req as any).user?.id);
    const out = await logoutAll(userId);
    res.json(out);
  } catch (e) { next(e); }
});

export default authRouter;
