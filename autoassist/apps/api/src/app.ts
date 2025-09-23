import './utils/env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
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
import paymentsRoutes from './routes/payments.routes.js';
import towRoutes from './routes/tow.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import { authenticate } from './middleware/auth.middleware.js';

const app = express();
const httpServer = createServer(app);
const prisma = new PrismaClient();

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

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware - note: webhook raw route is added before json parser below
app.use(compression());

// Stripe webhook raw endpoint will be registered separately before json parser
app.post('/api/payments/webhook',
  express.raw({ type: '*/*', verify: (req: any, res, buf: Buffer) => { if (buf && buf.length) req.rawBody = buf.toString('utf8'); } }),
  (req, res) => {
    // delegate to payments router which expects rawBody to be present
    // require('./routes/payments.routes.js').default.handleWebhook?.(req, res);
    res.status(200).json({ ok: true });
  }
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled application error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    body: req.body
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: isDevelopment ? error.message : 'An internal server error occurred',
    ...(isDevelopment && { stack: error.stack })
  });
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