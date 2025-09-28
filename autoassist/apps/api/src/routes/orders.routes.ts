import { Router } from 'express';
import type { Request, Response } from 'express';
// @ts-ignore - resolved at runtime via ts-node/NodeNext; keep import without explicit type file
import orderService from '../services/order.service.new';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { OrderStatus } from '@prisma/client';
import { validate } from '../middleware/validate.js';
import { GetOrdersQuery, OrderIdParam, UpdateOrderStatusBody } from '../validators/orders.schema.js';

const router = Router();
// using default exported instance from service

// POST /orders - create a new order (minimal compatible endpoint)
const prisma = new PrismaClient();
const createOrderSchema = z.object({
  client: z.object({ name: z.string().min(1), phone: z.string().min(6), email: z.string().email().optional() }),
  vehicle: z.object({ plate: z.string().min(1), make: z.string().optional(), model: z.string().optional(), year: z.number().optional() }),
  category: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(['low','normal','high','urgent']).default('normal'),
  pickup: z.object({ lat: z.number(), lng: z.number(), address: z.string().optional() }).optional()
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const data = createOrderSchema.parse(req.body);

    const client = await prisma.client.upsert({
      where: { phone: data.client.phone },
      update: { name: data.client.name, email: data.client.email },
      create: { name: data.client.name, phone: data.client.phone, email: data.client.email }
    });

    const vehicle = await prisma.vehicle.upsert({
      where: { plate: data.vehicle.plate },
      update: { ...(data.vehicle as any) },
      create: { ...(data.vehicle as any), client: { connect: { id: client.id } } } as any
    });

    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        vehicleId: vehicle.id,
        category: data.category,
        description: data.description,
        priority: data.priority,
        locations: data.pickup ? { create: [{ kind: 'pickup', lat: data.pickup.lat, lng: data.pickup.lng, address: data.pickup.address }] } : undefined
      }
    });

    req.app.get('io')?.emit && req.app.get('io').emit('order:created', { orderId: order.id, category: order.category });

    return res.status(201).json({ success: true, orderId: order.id });
  } catch (error: any) {
    console.error('Order create error (routes):', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders - получить список заказов пользователя
router.get('/', validate({ query: GetOrdersQuery }), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { status, page, limit, category } = req.query as any;
    // Allow admins/managers to view all orders. Regular clients only see their own orders.
    const userRole = (req.user as any)?.role ?? null;
    const filters: any = {};
    if (!userRole || !['admin', 'manager'].includes(String(userRole))) {
      // non-admins see only their own orders
      filters.clientId = Number(userId);
    }
    if (status && typeof status === 'string') {
      const validStatuses: OrderStatus[] = ['NEW', 'TRIAGE', 'QUOTE', 'APPROVED', 'SCHEDULED', 'INSERVICE', 'READY', 'DELIVERED', 'CLOSED', 'CANCELLED'];
      if (validStatuses.includes(status as OrderStatus)) filters.status = status as OrderStatus;
    }
    if (category) filters.category = category;

    const orders = await orderService.getOrdersWithPagination(filters, Number(page), Number(limit));

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/:id - получить конкретный заказ
router.get('/:id', validate({ params: OrderIdParam }), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
  const orderId = Number((req.params as any).id);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const order = await orderService.getOrderById(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Проверяем права доступа - клиент заказа или админ/менеджер может видеть оценку
    const userRole = (req.user as any)?.role ?? null;
    const isAdminOrManager = userRole && ['admin', 'manager'].includes(String(userRole));
    if (order.clientId !== Number(userId) && !isAdminOrManager) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /orders/:id/status - обновить статус заказа
router.put('/:id/status', validate({ params: OrderIdParam }), validate({ body: UpdateOrderStatusBody }), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
  const orderId = Number(req.params.id);
    const { status } = req.body as any;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Валидация статуса
    const validStatuses: OrderStatus[] = ['NEW', 'TRIAGE', 'QUOTE', 'APPROVED', 'SCHEDULED', 'INSERVICE', 'READY', 'DELIVERED', 'CLOSED', 'CANCELLED'];
    if (!validStatuses.includes(status as OrderStatus)) return res.status(400).json({ error: 'Invalid status' });

  const order = await orderService.getOrderById(Number(orderId));
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Проверяем права доступа - только клиент может обновлять некоторые статусы
    if (order.clientId !== Number(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

  const updatedOrder = await orderService.updateOrderStatus(Number(orderId), status);
    res.json(updatedOrder);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/provider/list - список заказов для сервисных центров
router.get('/provider/list', validate({ query: GetOrdersQuery }), async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { status, page, limit, category } = req.query as any;
    const filters: any = {};
    if (status && typeof status === 'string') {
      const validStatuses: OrderStatus[] = ['NEW', 'TRIAGE', 'QUOTE', 'APPROVED', 'SCHEDULED', 'INSERVICE', 'READY', 'DELIVERED', 'CLOSED', 'CANCELLED'];
      if (validStatuses.includes(status as OrderStatus)) filters.status = status as OrderStatus;
    }
    if (category) filters.category = category;

    const orders = await orderService.getOrdersWithPagination(filters, Number(page), Number(limit));

    res.json(orders);
  } catch (error) {
    console.error('Error fetching provider orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
