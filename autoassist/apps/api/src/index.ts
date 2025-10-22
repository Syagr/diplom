// src/server.ts
import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

// Routes (твои «new» файлы)
import { attachmentsRouter } from './routes/attachments.routes.js';
import { insurance } from './routes/insurance.routes.new.js';
import { tow } from './routes/tow.routes.new.js';
import paymentsRouter from './routes/payments.routes.js';

const prisma = new PrismaClient();
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });

// --- базовая инфраструктура и безопасность ---

// если есть reverse proxy (nginx/ingress), корректно определяем IP
app.set('trust proxy', 1);

// CORS whitelist: CORS_ORIGIN="https://app.example.com,https://admin.example.com"
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl/postman
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // dev-режим без whitelist
      return ALLOWED_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error('CORS_NOT_ALLOWED'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Stripe-Signature', 'Cookie'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
  })
);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'self'"],
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

// единый rate-limit (можешь ослабить max для dev)
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'TOO_MANY_REQUESTS', message: 'Too many requests, try later.' },
  })
);

// gzip/deflate
app.use(compression());

// Stripe webhook (если позже появится) должен идти ДО json-парсера, иначе подпись сломается
// пример задела:
// const rawBodySaver = (req: any, _res: any, buf: Buffer) => {
//   if (buf && buf.length) req.rawBody = buf.toString('utf8');
// };
// app.post('/api/payments/webhook', express.raw({ type: 'application/json', verify: rawBodySaver }), stripeWebhookHandler);

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// --- Socket.IO ---

app.set('io', io);
io.on('connection', (s: Socket) => {
  s.on('join', (room: string) => s.join(room));
});

// --- health/diagnostic ---

app.get('/health', (_: Request, res: Response) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'connected', time: new Date().toISOString() });
  } catch (e: any) {
    res.status(503).json({ ok: false, db: 'unavailable', error: e?.message || String(e) });
  }
});

// --- минимальный orders endpoint (как у тебя), с аккуратной валидацией ---

const createOrderSchema = z.object({
  client: z.object({
    name: z.string().min(1),
    phone: z.string().min(6),
    email: z.string().email().optional(),
  }),
  vehicle: z.object({
    plate: z.string().min(1),
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.number().optional(),
  }),
  category: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  pickup: z
    .object({
      lat: z.number(),
      lng: z.number(),
      address: z.string().optional(),
    })
    .optional(),
});

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const data = createOrderSchema.parse(req.body);

    // upsert client
    const client = await prisma.client.upsert({
      where: { phone: data.client.phone },
      update: { name: data.client.name, email: data.client.email },
      create: { name: data.client.name, phone: data.client.phone, email: data.client.email },
    });

    // upsert vehicle
    const vehicle = await prisma.vehicle.upsert({
      where: { plate: data.vehicle.plate },
      update: { ...(data.vehicle as any) },
      create: { ...(data.vehicle as any), client: { connect: { id: client.id } } } as any,
    });

    // create order
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        vehicleId: vehicle.id,
        category: data.category,
        description: data.description,
        priority: data.priority,
        locations: data.pickup
          ? {
              create: [
                {
                  kind: 'pickup',
                  lat: data.pickup.lat,
                  lng: data.pickup.lng,
                  address: data.pickup.address,
                },
              ],
            }
          : undefined,
      },
    });

    // ws событие
    req.app.get('io').emit('order:created', { orderId: order.id, category: order.category });

    res.status(201).json({ success: true, orderId: order.id });
  } catch (error: any) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', details: error.errors });
    }
    // prisma уникальные ограничения и т.п.
    return res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
  }
});

// --- твои роуты ---

app.use('/api/attachments', attachmentsRouter);
app.use('/api/insurance', insurance);
app.use('/api/tow', tow);
app.use('/api/payments', paymentsRouter);

// --- 404 и обработка ошибок ---

app.use('*', (req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', path: req.originalUrl });
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // единый формат ошибки
  const status = err.status || 500;
  const code =
    err.code ||
    (status === 401
      ? 'UNAUTHORIZED'
      : status === 403
      ? 'FORBIDDEN'
      : status === 404
      ? 'NOT_FOUND'
      : status === 429
      ? 'TOO_MANY_REQUESTS'
      : 'INTERNAL');
  res.status(status).json({ error: { code, message: err.message || 'Internal error' } });
});

// --- graceful shutdown ---

async function shutdown(code = 0) {
  try {
    await new Promise<void>(resolve => http.close(() => resolve()));
    await prisma.$disconnect();
    process.exit(code);
  } catch {
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

// --- старт ---

const port = Number(process.env.API_PORT || process.env.PORT || 8080);
http.listen(port, () => {
  console.log(`API listening on :${port}`);
});
