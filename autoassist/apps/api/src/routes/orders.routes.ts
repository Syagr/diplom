import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { OrderStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.js';
import orderService from '../services/order.service.new.js';
import prisma from '@/utils/prisma.js';
import { GetOrdersQuery, OrderIdParam, UpdateOrderStatusBody } from '../validators/orders.schema.js';

const router = Router();

// ---- helpers ----
type AuthUser = { id: number; role?: string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const isStaff = (u?: AuthUser) => !!u && ['admin', 'manager'].includes(String(u.role).toLowerCase());
const safeEmit = (req: Request, room: string, event: string, payload: unknown) => {
  const io = req.app?.get?.('io');
  if (io?.to) io.to(room).emit(event, payload);
};

// ---- validation ----
const CreateOrderBody = z.object({
  client: z.object({
    name: z.string().min(1).trim(),
    phone: z.string().min(6).trim(),
    email: z.string().email().trim().optional(),
  }),
  vehicle: z.object({
    plate: z.string().min(1).trim(),
    make: z.string().trim().optional(),
    model: z.string().trim().optional(),
    year: z.coerce.number().int().positive().max(new Date().getFullYear() + 1).optional(),
  }),
  category: z.string().min(1).trim(),
  description: z.string().trim().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  pickup: z.object({
    lat: z.coerce.number(),
    lng: z.coerce.number(),
    address: z.string().trim().optional(),
  }).optional(),
});

const ListQuery = z.object({
  status: z.enum(['NEW','TRIAGE','QUOTE','APPROVED','SCHEDULED','INSERVICE','READY','DELIVERED','CLOSED','CANCELLED']).optional(),
  category: z.string().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ---- secure all routes ----
router.use(authenticate);

/**
 * GET /orders/provider/list  — ставимо ПЕРЕД /:id
 * Список замовлень для сервіс-провайдерів / staff
 */
router.get('/provider/list', validate({ query: GetOrdersQuery }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    if (!isStaff(user)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff only' } });

    const { status, page, limit, category } = ListQuery.parse(req.query);
    const filters: any = {};
    if (status) filters.status = status;
    if (category) filters.category = category;

    const orders = await orderService.getOrdersWithPagination(filters, page, limit);
    return res.json(orders);
  } catch (e) {
    console.error('Error fetching provider orders:', e);
    return next(e);
  }
});

/**
 * POST /orders — створити нове замовлення
 */
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req); // може бути анонімний сценарій; якщо потрібен приватний — вимагай user
    const data = CreateOrderBody.parse(req.body);

    // 1) знайти/створити клієнта по телефону (або email)
    const client = await prisma.client.upsert({
      where: { phone: data.client.phone },
      update: { name: data.client.name, email: data.client.email ?? undefined },
      create: { name: data.client.name, phone: data.client.phone, email: data.client.email ?? null },
    });

    // 2) авто: перевірити власника, якщо plate вже існує
    const existingVehicle = await prisma.vehicle.findUnique({ where: { plate: data.vehicle.plate } });
    if (existingVehicle && existingVehicle.clientId !== client.id) {
      return res.status(409).json({ error: { code: 'VEHICLE_OWNERSHIP_CONFLICT', message: 'Vehicle with this plate belongs to another client' } });
    }

    const vehicle = existingVehicle
      ? await prisma.vehicle.update({
          where: { plate: data.vehicle.plate },
          data: { make: data.vehicle.make, model: data.vehicle.model, year: data.vehicle.year ?? undefined },
        })
      : await prisma.vehicle.create({
          data: {
            plate: data.vehicle.plate,
            make: data.vehicle.make,
            model: data.vehicle.model,
            year: data.vehicle.year ?? null,
            clientId: client.id,
          },
        });

    // 3) створити order
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        vehicleId: vehicle.id,
        category: data.category,
        description: data.description ?? null,
        priority: data.priority,
        locations: data.pickup
          ? { create: [{ kind: 'pickup', lat: data.pickup.lat, lng: data.pickup.lng, address: data.pickup.address ?? null }] }
          : undefined,
      },
    });

    safeEmit(req, `order:${order.id}`, 'order:created', { orderId: order.id, category: order.category });
    return res.status(201).json({ success: true, orderId: order.id });
  } catch (e) {
    console.error('Order create error (routes):', e);
    return next(e);
  }
});

/**
 * GET /orders — список замовлень користувача; staff бачить всі
 */
router.get('/', validate({ query: GetOrdersQuery }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const { status, page, limit, category } = ListQuery.parse(req.query);

    const filters: any = {};
    if (!isStaff(user)) filters.clientId = user.id; // клієнт — лише свої
    if (status) filters.status = status;
    if (category) filters.category = category;

    const orders = await orderService.getOrdersWithPagination(filters, page, limit);
    return res.json(orders);
  } catch (e) {
    console.error('Error fetching orders:', e);
    return next(e);
  }
});

/**
 * GET /orders/:id — деталі замовлення (власник або staff)
 */
router.get('/:id', validate({ params: OrderIdParam }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const orderId = Number((req.params as any).id);
    const order = await orderService.getOrderById(orderId);
    if (!order) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });

    if (!isStaff(user) && order.clientId !== user.id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    return res.json(order);
  } catch (e) {
    console.error('Error fetching order:', e);
    return next(e);
  }
});

/**
 * PUT /orders/:id/status — оновити статус (клієнт: лише безпечні переходи; інше — staff)
 */
router.put('/:id/status', validate({ params: OrderIdParam }), validate({ body: UpdateOrderStatusBody }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const orderId = Number(req.params.id);
    const { status } = req.body as { status: OrderStatus };

    const order = await orderService.getOrderById(orderId);
    if (!order) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });

    // FSM-перевірка дозволених переходів:
    const allowedByClient: Record<OrderStatus, OrderStatus[]> = {
      NEW: ['CANCELLED'],
      TRIAGE: [],
      QUOTE: ['APPROVED', 'CANCELLED'],
      APPROVED: [],
      SCHEDULED: [],
      INSERVICE: [],
      READY: ['DELIVERED'],
      DELIVERED: [],
      CLOSED: [],
      CANCELLED: [],
    };

    const isOwner = order.clientId === user.id;
    const current = order.status as OrderStatus;

    if (isOwner && !isStaff(user)) {
      // клієнт може тільки те, що дозволено таблицею
      const allowed = allowedByClient[current] ?? [];
      if (!allowed.includes(status)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Transition ${current} → ${status} is not allowed for client` } });
      }
    } else if (!isStaff(user)) {
      // ні власник, ні staff
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    const updated = await orderService.updateOrderStatus(orderId, status);
    safeEmit(req, `order:${orderId}`, 'order:updated', { id: orderId, kind: 'status', status });

    return res.json(updated);
  } catch (e) {
    console.error('Error updating order status:', e);
    return next(e);
  }
});

export default router;
