import { Router } from 'express';
import { z } from 'zod';
import { login, refresh, logoutAll, register } from '../services/auth.service.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import { registerSchema } from '../schemas/auth.schema.js';

export const authRouter = Router();

const loginSchema = { body: z.object({
  email: z.string().email(),
  password: z.string().min(6),
}) };

authRouter.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const tokens = await login({ email, password } as any);
    return res.json(tokens);
  } catch (e: any) {
    // friendly messages
    if (e.code === 'BAD_CREDENTIALS' || e.message === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Невірний email або пароль' } });
    }
    next(e);
  }
});

const regSchema = { body: z.object({
  email: z.string().email(),
  password: z.string().min(6),
}) };

authRouter.post('/register', validate(regSchema), async (req, res, next) => {
  try {
    const tokens = await register(req.body as any);
    return res.status(201).json(tokens);
  } catch (e: any) {
    if (e.code === 'EMAIL_TAKEN' || e.message === 'EMAIL_TAKEN') {
      return res.status(409).json({ error: { code: 'EMAIL_TAKEN', message: 'Користувач з такою адресою вже існує' } });
    }
    next(e);
  }
});

const refreshSchema = { body: z.object({ refresh: z.string().min(10) }) };
authRouter.post('/refresh', validate(refreshSchema), async (req, res, next) => {
  try {
    const t = await refresh(req.body.refresh);
    res.json(t);
  } catch (e:any) {
    return res.status(401).json({ message: 'Неприпустимий або протермінований токен' });
  }
});

authRouter.post('/logout', authenticate, async (req, res, next) => {
  try {
    const userId = Number((req as any).user?.id);
    const out = await logoutAll(userId);
    res.json(out);
  } catch (e) { next(e); }
});

export default authRouter;
