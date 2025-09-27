import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { attachmentsRouter } from './routes/attachments.routes.js';
import { insurance } from './routes/insurance.routes.new.js';
import { tow } from './routes/tow.routes.new.js';
import { payments } from './routes/payments.routes.new.js';

const prisma = new PrismaClient();

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));

const http = createServer(app);
const io = new Server(http, { cors: { origin: '*' } });
app.set('io', io);

io.on('connection', (s: Socket) => {
  s.on('join', (room: string) => s.join(room));
});

app.get('/health', (_: Request, res: Response) => res.json({ ok: true }));

// Minimal orders endpoint for testing
const createOrderSchema = z.object({
  client: z.object({
    name: z.string().min(1),
    phone: z.string().min(10),
    email: z.string().email().optional()
  }),
  vehicle: z.object({
    plate: z.string().min(1),
    make: z.string().optional(),
    model: z.string().optional(),
    year: z.number().optional()
  }),
  category: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  pickup: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional()
  }).optional()
});

app.post('/api/orders', async (req: Request, res: Response) => {
  try {
    const data = createOrderSchema.parse(req.body);
    
    // Upsert client
    const client = await prisma.client.upsert({
      where: { phone: data.client.phone },
      update: { name: data.client.name, email: data.client.email },
      create: { name: data.client.name, phone: data.client.phone, email: data.client.email }
    });

    // Upsert vehicle
    const vehicle = await prisma.vehicle.upsert({
      where: { plate: data.vehicle.plate },
      update: { ...data.vehicle },
      create: { ...data.vehicle, client: { connect: { id: client.id } } }
    });

    // Create order
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        vehicleId: vehicle.id,
        category: data.category,
        description: data.description,
        priority: data.priority,
        locations: data.pickup ? {
          create: [{
            kind: 'pickup',
            lat: data.pickup.lat,
            lng: data.pickup.lng,
            address: data.pickup.address
          }]
        } : undefined
      }
    });

    // Emit WebSocket event
    req.app.get('io').emit('order:created', { orderId: order.id, category: order.category });

    res.status(201).json({ success: true, orderId: order.id });
  } catch (error: any) {
    console.error('Order creation error:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.use('/api/attachments', attachmentsRouter);
app.use('/api/insurance', insurance);
app.use('/api/tow', tow);
app.use('/api/payments', payments);

// TODO: orders.routes.ts, estimate.routes.ts уже подключены здесь же

const port = Number(process.env.API_PORT || 8080);
http.listen(port, () => console.log(`API listening on :${port}`));