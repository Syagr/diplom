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
import NotificationService from './services/notification.service.js';

// Import routes
import authRoutes from './routes/auth.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import attachmentsRoutes from './routes/attachments.routes.js';
import insuranceRoutes from './routes/insurance.routes.js';
import paymentsRoutes, { stripeWebhookHandler } from './routes/payments.routes.js';
import towRoutes from './routes/tow.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import { authenticate } from './middleware/auth.middleware.js';

const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();

// Diagnostic: attempt to connect to DB immediately and log the URL the process sees.
(async () => {
  try {
    // Mask the password when logging
    const raw = process.env.DATABASE_URL ?? '(not set)';
    const masked = raw.replace(/:\/\/.+?:.+?@/, '://***:***@');
    logger.info('Prisma startup: DATABASE_URL', { value: masked });
    await prisma.$connect();
    logger.info('Prisma startup: connected to database');
  } catch (err) {
    logger.error('Prisma startup: connection failed', { error: err instanceof Error ? err.message : String(err), stack: err?.stack });
  }
})();

// Initialize services
const socketService = new SocketService(httpServer);
const notificationService = new NotificationService();
notificationService.setSocketService(socketService);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many requests from this IP, please try again later.'
  }
});

app.use('/api/', limiter);

// Additional global security middleware per final-shrug request
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

// Lightweight healthz endpoint
app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
  });
});

// Swagger UI (static openapi.json)
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const specPath = path.join(__dirname, 'openapi.json');
  if (fs.existsSync(specPath)) {
    const openapiSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    app.use('/_docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
  }
} catch (err) {
  logger.warn('Failed to mount Swagger UI', { error: err instanceof Error ? err.message : String(err) });
}

// CORS configuration
// CORS whitelist from env (comma-separated)
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow curl/postman
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // permissive for dev if not set
    return ALLOWED_ORIGINS.includes(origin) ? cb(null, true) : cb(new Error('CORS_NOT_ALLOWED'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware - note: webhook raw route is added before json parser below
app.use(compression());

// Stripe webhook raw endpoint will be registered separately before json parser
const rawBodySaver = (req: any, _res: any, buf: Buffer) => { if (buf && buf.length) req.rawBody = buf.toString('utf8'); };

app.post('/api/payments/webhook',
  express.raw({ type: '*/*', verify: rawBodySaver }),
  stripeWebhookHandler
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Parse cookies so auth middleware can read access tokens from cookies when present
app.use(cookieParser());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
  });
  
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        websocket: 'running'
      },
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    logger.error('Health check failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed'
    });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/orders', authenticate, ordersRoutes);
app.use('/api/attachments', authenticate, attachmentsRoutes);
app.use('/api/insurance', authenticate, insuranceRoutes);
app.use('/api/payments', authenticate, paymentsRoutes);
app.use('/api/tow', authenticate, towRoutes);
app.use('/api/notifications', authenticate, notificationsRoutes);

// WebSocket status endpoint
app.get('/api/socket/status', (req, res) => {
  res.json({
    connected: socketService.getOnlineUsersCount(),
    rooms: {
      // Add room statistics if needed
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'The requested resource was not found',
    path: req.originalUrl
  });
});

// Global error handler
// Centralized error handler - normalize to { error: { code, message } }
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled application error', {
    code: err.code || err.name,
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });

  const status = err.status || (err.name === 'UnauthorizedError' ? 401 : 500);
  const code = err.code || (
    status === 401 ? 'UNAUTHORIZED' :
    status === 403 ? 'FORBIDDEN' :
    status === 404 ? 'NOT_FOUND' :
    status === 422 ? 'VALIDATION_ERROR' : 'INTERNAL'
  );

  res.status(status).json({ error: { code, message: err.message ?? String(err) } });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  httpServer.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info('Database disconnected');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(1);
    }
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  httpServer.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info('Database disconnected');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(1);
    }
  });
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

// Uncaught exception handler
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  logger.info(`AutoAssist+ API Server started`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version
  });
});

// Export for testing
export { app, httpServer, socketService, notificationService, prisma };