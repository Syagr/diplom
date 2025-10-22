import { Router } from 'express';
import { z } from 'zod';
import { login, refresh as refreshSvc, logoutAll, register } from '../services/auth.service.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';

export const authRouter = Router();

const isProd = process.env.NODE_ENV === 'production';
const ACCESS_COOKIE = 'accessToken';
const REFRESH_COOKIE = 'refreshToken';

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: isProd,               // false на localhost
  path: '/',                    // віддаємо на весь сайт
};

const setAccessCookie = (res: any, token: string, maxAgeMs = 15 * 60 * 1000) => {
  res.cookie(ACCESS_COOKIE, token, { ...cookieOpts, maxAge: maxAgeMs });
};
const setRefreshCookie = (res: any, token: string, maxAgeMs = 30 * 24 * 60 * 60 * 1000) => {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOpts, maxAge: maxAgeMs });
};
const clearAuthCookies = (res: any) => {
  res.clearCookie(ACCESS_COOKIE, { ...cookieOpts });
  res.clearCookie(REFRESH_COOKIE, { ...cookieOpts });
};

// ------------ Schemas ------------
const loginSchema = {
  body: z.object({
    email: z.string().email().toLowerCase().trim(),
    password: z.string().min(6),
  }),
};

const registerSchema = {
  body: z.object({
    email: z.string().email().toLowerCase().trim(),
    password: z.string().min(6),
  }),
};

// refresh беремо з куки, але дозволяємо і з body для сумісності
const refreshSchema = {
  body: z.object({ refresh: z.string().min(10).optional() }),
};

// ------------ Routes ------------

// POST /auth/login
authRouter.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema.body>;
    const tokens = await login({ email, password });
    setAccessCookie(res, tokens.access);
    setRefreshCookie(res, tokens.refresh);
    return res.json({ access: tokens.access, refresh: 'cookie' });
  } catch (e: any) {
    if (e.code === 'BAD_CREDENTIALS' || e.message === 'INVALID_CREDENTIALS') {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Невірний email або пароль' } });
    }
    return next(e);
  }
});

// POST /auth/register
authRouter.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof registerSchema.body>;
    const tokens = await register({ email, password });
    setAccessCookie(res, tokens.access);
    setRefreshCookie(res, tokens.refresh);
    return res.status(201).json({ access: tokens.access, refresh: 'cookie' });
  } catch (e: any) {
    if (e.code === 'EMAIL_TAKEN' || e.message === 'EMAIL_TAKEN') {
      return res.status(409).json({ error: { code: 'EMAIL_TAKEN', message: 'Користувач з такою адресою вже існує' } });
    }
    return next(e);
  }
});

// POST /auth/refresh
authRouter.post('/refresh', validate(refreshSchema), async (req, res) => {
  try {
    const rtFromCookie = req.cookies?.[REFRESH_COOKIE];
    const rt = rtFromCookie || req.body.refresh;
    if (!rt) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Відсутній refresh токен' } });

    // Сервіс має ЗРОТУВАТИ refresh і видати нову пару
    const t = await refreshSvc(rt);
    setAccessCookie(res, t.access);
    setRefreshCookie(res, t.refresh);
    return res.json({ access: t.access, refresh: 'cookie' });
  } catch (e: any) {
    clearAuthCookies(res);
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Неприпустимий або протермінований токен' } });
  }
});

// POST /auth/logout (вийти зі всіх сесій)
authRouter.post('/logout', authenticate, async (req, res, next) => {
  try {
    const userId = Number((req as any).user?.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Некоректний користувач' } });
    }
    await logoutAll(userId);
    clearAuthCookies(res);
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default authRouter;
