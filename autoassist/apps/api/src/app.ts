// src/server.ts
import './utils/env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { PrismaClient } from '@prisma/client';
import { logger } from './libs/logger.js';
import SocketService from './services/socket.service.js';
import { v4 as uuidv4 } from 'uuid';

// Routes
// Legacy server wiring — keep minimal imports to avoid module-not-found.
import attachmentsRoutes from './routes/attachments.routes.js';
import insuranceRoutes from './routes/insurance.routes.new.js';
import paymentsRoutes, { stripeWebhookHandler } from './routes/payments.routes.js';
import towRoutes from './routes/tow.routes.new.js';
import ordersRoutesNew from './routes/orders.routes.new.js';
import ordersRoutes from './routes/orders.routes.js';
import serviceCentersRoutes from './routes/serviceCenters.routes.js';
import estimatesRoutesNew from './routes/estimates.routes.new.js';
import authRoutes from './routes/auth.routes.js';
import authWalletRoutes from './routes/auth.wallet.routes.js';
import walletRoutes from './routes/wallet.routes.js';
import calcProfilesRoutes from './routes/calcProfiles.routes.js';
import testRoutes from './routes/test.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import receiptsRoutes from './routes/receipts.routes.js';
import meRoutes from './routes/me.routes.js';
import adminRoutes from './routes/admin.routes.js';
import { authenticate } from './middleware/auth.middleware.js';

import { ZodError } from 'zod';
import { zodToUa } from './utils/zod-ua.js';
import { metricsRegistry, metricsMiddleware } from './utils/metrics.js';

const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();

// Try DB connect on boot (диагностика)
(async () => {
  try {
    const raw = process.env.DATABASE_URL ?? '(not set)';
    const masked = raw.replace(/:\/\/.+?:.+?@/, '://***:***@');
    logger.info('Prisma startup: DATABASE_URL', { value: masked });
    await prisma.$connect();
    logger.info('Prisma startup: connected to database');
  } catch (err: any) {
    logger.error('Prisma startup: connection failed', {
      error: err?.message || String(err),
      stack: err?.stack,
    });
  }
})();

// Init services
const socketService = new SocketService(httpServer);

// Прокинуть io в app для использования в роутинге как req.app.get('io')
app.set('io', (socketService as any)['io']);

// ---------- Security / Infra middleware ----------

// Correlate requests with a requestId for tracing and audit
app.use((req, res, next) => {
  const rid = (req.headers['x-request-id'] as string) || uuidv4();
  (req as any).requestId = rid;
  res.setHeader('X-Request-Id', rid);
  next();
});

// если стоим за прокси — понадобится для корректного IP в rate-limit
app.set('trust proxy', 1);

// Единая настройка Helmet (без дубликатов)
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
        frameSrc: ["'self'"], // можно 'none' если не нужно встраивание
      },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

// Rate limiting (единый)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many requests, try later.' },
});
app.use('/api', limiter);

// Swagger UI (static openapi.json)
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const specPath = path.join(__dirname, 'openapi.json');
  if (fs.existsSync(specPath)) {
    const openapiSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    app.use('/_docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
  }
} catch (err: any) {
  logger.warn('Failed to mount Swagger UI', { error: err?.message || String(err) });
}

// ---------- CORS ----------
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl/postman
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // dev-поблажка
      return ALLOWED_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error('CORS_NOT_ALLOWED'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    // добавили Stripe-Signature и Cookie
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Stripe-Signature', 'Cookie'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
  })
);

// ---------- Health ----------
const healthPayload = () => ({
  ok: true,
  time: new Date().toISOString(),
  uptimeSec: Math.round(process.uptime()),
});

app.get('/api/healthz', (_req, res) => res.json(healthPayload()));
app.get('/healthz', (_req, res) => res.json(healthPayload()));

// Доп. health (проверка DB)
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: { database: 'connected', websocket: 'running' },
      version: process.env.npm_package_version || '1.0.0',
    });
  } catch (error: any) {
    logger.error('Health check failed', { error: error?.message || String(error) });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed',
    });
  }
});

// ---------- Body parsing & Stripe webhook ----------

app.use(compression());
// Metrics collection (lightweight)
app.use(metricsMiddleware());

// Stripe webhook — сырое тело ДОЛЖНО идти до json-парсера
const rawBodySaver = (req: any, _res: any, buf: Buffer) => {
  if (buf && buf.length) req.rawBody = buf.toString('utf8');
};

app.post('/api/payments/webhook', express.raw({ type: 'application/json', verify: rawBodySaver }), stripeWebhookHandler);

// Остальные парсеры
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ---------- Logging ----------
app.use((req, _res, next) => {
  try {
    logger.info('INCOMING_REQUEST', {
      method: req.method,
      originalUrl: req.originalUrl,
      url: req.url,
      host: req.headers.host,
      forwarded: req.headers['x-forwarded-for'] || null,
    });
  } catch (_e) {
    // ignore logging failures to avoid breaking request flow
    void 0;
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const requestId = (req as any).requestId;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      requestId,
    });

    // Audit only error responses to avoid noise
    if (res.statusCode >= 400) {
      void prisma.auditEvent
        .create({
          data: {
            type: 'http:error',
            payload: {
              status: res.statusCode,
              method: req.method,
              url: req.originalUrl,
              requestId,
              userAgent: req.get('User-Agent') || null,
              ip: req.ip,
            },
            userId: (req as any)?.user?.id ?? null,
          },
        })
        .catch(() => {});
    }
  });
  next();
});

// ---------- API routes ----------

app.use('/api/auth', authRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/attachments', authenticate, attachmentsRoutes);
app.use('/api/insurance', authenticate, insuranceRoutes);
app.use('/api/payments', authenticate, paymentsRoutes);
app.use('/api/tow', authenticate, towRoutes);
app.use('/api/orders', authenticate, ordersRoutesNew);
app.use('/api/service-centers', serviceCentersRoutes);
app.use('/api/estimates', estimatesRoutesNew);
app.use('/api/auth', authWalletRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/calc-profiles', calcProfilesRoutes);
app.use('/api/receipts', receiptsRoutes);
app.use('/api/me', meRoutes);
// Prometheus metrics endpoint (no auth). Consider protecting in production via network.
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    const data = await metricsRegistry.metrics();
    res.send(data);
  } catch (e: any) {
    res.status(500).send(`# metrics error: ${e?.message || 'unknown'}`);
  }
});
// Test-only helpers
if (process.env.NODE_ENV === 'test') {
  app.use('/api/test', testRoutes);
}
app.use('/api/notifications', authenticate, notificationsRoutes);
// app.use('/api/wallet', walletRoutes);
// app.use('/api/estimates', authenticate, estimatesRoutes);
app.use('/api/admin', authenticate, adminRoutes);

// Admin test event
app.post('/api/admin/test-event', authenticate, (req, res) => {
  try {
    const role = (req.user as any)?.role || null;
    if (!role || !['admin', 'manager'].includes(String(role).toLowerCase())) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin role required' });
    }
    const payload = req.body && Object.keys(req.body).length ? req.body : { test: true, ts: new Date().toISOString() };
    socketService.emitToRole('admin', 'order:created', payload);
    return res.json({ ok: true });
  } catch (err: any) {
    logger.error('Failed to emit admin test event', { error: err?.message || String(err) });
    return res.status(500).json({ error: 'INTERNAL', message: 'Failed to emit event' });
  }
});

// WebSocket status
app.get('/api/socket/status', (_req, res) => {
  res.json({ connected: socketService.getOnlineUsersCount(), rooms: {} });
});

// ---------- 404 & Errors ----------

app.use('*', (req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'The requested resource was not found',
    path: req.originalUrl,
  });
});

// Zod -> UA
app.use((err: any, _req: any, res: any, next: any) => {
  if (err instanceof ZodError) {
    return res.status(400).json(zodToUa(err));
  }
  next(err);
});

// Глобальная обработка ошибок
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled application error', {
    code: err.code || err.name,
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    requestId: (req as any)?.requestId,
  });

  const status = err.status || (err.name === 'UnauthorizedError' ? 401 : 500);
  const code =
    err.code ||
    (status === 401
      ? 'UNAUTHORIZED'
      : status === 403
      ? 'FORBIDDEN'
      : status === 404
      ? 'NOT_FOUND'
      : status === 422
      ? 'VALIDATION_ERROR'
      : 'INTERNAL');

  void prisma.auditEvent
    .create({
      data: {
        type: 'error:http',
        payload: {
          status,
          code,
          message: err?.message || String(err),
          url: req.originalUrl,
          method: req.method,
          requestId: (req as any)?.requestId,
        },
        userId: (req as any)?.user?.id ?? null,
      },
    })
    .catch(() => {});

  res.status(status).json({ error: { code, message: err.message ?? String(err) } });
});

// ---------- Graceful shutdown & process handlers ----------

async function shutdown(code = 0) {
  try {
    // корректно закрыть HTTP и сокеты
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    // закрыть Socket.IO (если есть метод)
    await (socketService as any).close?.();
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(code);
  } catch (error: any) {
    logger.error('Error during shutdown', { error: error?.message || String(error) });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  void shutdown(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  void shutdown(0);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

// ---------- Start ----------
const PORT = process.env.PORT || 3001;

// Avoid binding a port during tests to prevent EADDRINUSE and open handles
if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  httpServer.listen(PORT, () => {
    logger.info(`AutoAssist+ API Server started`, {
      port: PORT,
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
    });
  });
}

// Export for testing
export { app, httpServer, socketService, prisma };
