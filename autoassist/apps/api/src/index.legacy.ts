import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { attachments } from './routes/attachments.routes';
import { insurance } from './routes/insurance.routes.new';
import { tow } from './routes/tow.routes.new';
import { payments } from './routes/payments.routes.new';

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));

const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });
app.set('io', io);

io.on('connection', s => {
  s.on('join', (room: string) => s.join(room));
});

app.get('/health', (_,res)=>res.json({ ok:true }));

app.use('/api/attachments', attachments);
app.use('/api/insurance', insurance);
app.use('/api/tow', tow);
app.use('/api/payments', payments);

// TODO: orders.routes.ts, estimate.routes.ts уже подключены здесь же

const port = Number(process.env.API_PORT || 8080);
http.listen(port, () => console.log(`API listening on :${port}`)); 
}));
app.use(express.json({ limit: '10mb' }));

// Database & Cache
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// WebSocket setup
const httpServer = createServer(app);
const io = new Server(httpServer, { 
  cors: { 
    origin: process.env.NODE_ENV === 'production' 
      ? process.env.CORS_ORIGIN?.split(',') 
      : '*' 
  } 
});

// WebSocket connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('join', (room: string) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room: ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Health check
app.get('/health', (_, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    service: 'autoassist-api'
  });
});

// Auth middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET!, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Validation schemas
const createOrderSchema = z.object({
  client: z.object({
    name: z.string().min(1),
    phone: z.string().min(10),
    email: z.string().email().optional(),
    tgUserId: z.string().optional()
  }),
  vehicle: z.object({
    plate: z.string().min(1),
    vin: z.string().optional(),
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.number().optional(),
    mileage: z.number().optional()
  }),
  category: z.string().min(1),
  description: z.string().optional(),
  channel: z.string().default('web'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  pickup: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
    notes: z.string().optional()
  }).optional()
});

// Create order endpoint
app.post('/api/orders', async (req, res) => {
  try {
    const data = createOrderSchema.parse(req.body);

    // Upsert client
    const client = await prisma.client.upsert({
      where: { phone: data.client.phone },
      update: { 
        name: data.client.name, 
        email: data.client.email || undefined,
        tgUserId: data.client.tgUserId || undefined
      },
      create: { 
        name: data.client.name, 
        phone: data.client.phone, 
        email: data.client.email,
        tgUserId: data.client.tgUserId
      }
    });

    // Upsert vehicle
    const vehicle = await prisma.vehicle.upsert({
      where: { plate: data.vehicle.plate },
      update: { 
        vin: data.vehicle.vin || undefined,
        make: data.vehicle.make || undefined,
        model: data.vehicle.model || undefined,
        year: data.vehicle.year || undefined,
        mileage: data.vehicle.mileage || undefined
      },
      create: { 
        clientId: client.id,
        plate: data.vehicle.plate, 
        vin: data.vehicle.vin,
        make: data.vehicle.make,
        model: data.vehicle.model,
        year: data.vehicle.year,
        mileage: data.vehicle.mileage
      }
    });

    // Create order
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        vehicleId: vehicle.id,
        category: data.category,
        description: data.description,
        channel: data.channel,
        priority: data.priority,
        locations: data.pickup ? {
          create: [{
            kind: 'pickup',
            lat: data.pickup.lat,
            lng: data.pickup.lng,
            address: data.pickup.address,
            notes: data.pickup.notes
          }]
        } : undefined,
        timeline: {
          create: [{
            event: 'order_created',
            details: { channel: data.channel, priority: data.priority }
          }]
        }
      },
      include: {
        client: true,
        vehicle: true,
        locations: true
      }
    });

    // Notify via WebSocket
    io.to('managers').emit('order:new', { 
      orderId: order.id, 
      client: order.client,
      vehicle: order.vehicle,
      category: order.category,
      priority: order.priority
    });

    // Cache order for quick access
    await redis.setex(`order:${order.id}`, 3600, JSON.stringify(order));

    res.status(201).json({ 
      success: true,
      order: {
        id: order.id,
        status: order.status,
        category: order.category,
        priority: order.priority,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    console.error('Error creating order:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        success: false,
        error: 'Validation error', 
        details: error.errors 
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// Get orders endpoint
app.get('/api/orders', async (req, res) => {
  try {
    const { status, limit = '10', offset = '0' } = req.query;
    
    const orders = await prisma.order.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        client: true,
        vehicle: true,
        locations: true,
        estimate: true,
        tow: true
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string)
    });

    const total = await prisma.order.count({
      where: status ? { status: status as any } : undefined
    });

    res.json({
      success: true,
      orders,
      pagination: {
        total,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// Get single order
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Try cache first
    const cached = await redis.get(`order:${id}`);
    if (cached) {
      return res.json({ 
        success: true,
        order: JSON.parse(cached),
        cached: true
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: {
        client: true,
        vehicle: true,
        locations: true,
        estimate: true,
        payments: true,
        tow: true,
        offers: true,
        attachments: true,
        timeline: { orderBy: { createdAt: 'desc' } }
      }
    });

    if (!order) {
      return res.status(404).json({ 
        success: false,
        error: 'Order not found' 
      });
    }

    // Cache the order
    await redis.setex(`order:${id}`, 3600, JSON.stringify(order));

    res.json({ 
      success: true,
      order 
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// Update order status
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const order = await prisma.order.update({
      where: { id: parseInt(id) },
      data: { 
        status,
        timeline: {
          create: [{
            event: 'status_changed',
            details: { 
              oldStatus: req.body.oldStatus,
              newStatus: status,
              notes 
            }
          }]
        }
      },
      include: { client: true }
    });

    // Clear cache
    await redis.del(`order:${id}`);

    // Notify client
    io.to(`client:${order.clientId}`).emit('order:status_changed', {
      orderId: order.id,
      status: order.status
    });

    res.json({ 
      success: true,
      order: { id: order.id, status: order.status }
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
});

// Start server
const port = process.env.API_PORT || 8080;
httpServer.listen(port, () => {
  console.log(`🚀 AutoAssist+ API running on port ${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  await redis.disconnect();
  process.exit(0);
});