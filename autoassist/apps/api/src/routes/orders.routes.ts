import { Router, Request, Response } from 'express';
// @ts-ignore - resolved at runtime via ts-node/NodeNext; keep import without explicit type file
import orderService from '../services/order.service.new';
import { OrderStatus } from '@prisma/client';

const router = Router();
// using default exported instance from service

// GET /orders - получить список заказов пользователя
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { status, page = 1, limit = 10 } = req.query;
    
    const filters: any = { clientId: parseInt(userId) };
    if (status && typeof status === 'string') {
      // Валидация статуса
      const validStatuses: OrderStatus[] = ['NEW', 'TRIAGE', 'QUOTE', 'APPROVED', 'SCHEDULED', 'INSERVICE', 'READY', 'DELIVERED', 'CLOSED', 'CANCELLED'];
      if (validStatuses.includes(status as OrderStatus)) {
        filters.status = status as OrderStatus;
      }
    }

    const orders = await orderService.getOrdersWithPagination(
      filters,
      parseInt(page as string),
      parseInt(limit as string)
    );

    res.json(orders);
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/:id - получить конкретный заказ
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const orderId = req.params.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const order = await orderService.getOrderById(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Проверяем права доступа
    if (order.clientId !== parseInt(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(order);
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /orders/:id/status - обновить статус заказа
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const orderId = req.params.id;
    const { status } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Валидация статуса
    const validStatuses: OrderStatus[] = ['NEW', 'TRIAGE', 'QUOTE', 'APPROVED', 'SCHEDULED', 'INSERVICE', 'READY', 'DELIVERED', 'CLOSED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const order = await orderService.getOrderById(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Проверяем права доступа - только клиент может обновлять некоторые статусы
    if (order.clientId !== parseInt(userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updatedOrder = await orderService.updateOrderStatus(orderId, status);
    res.json(updatedOrder);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/provider/list - список заказов для сервисных центров
router.get('/provider/list', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { status, page = 1, limit = 10, category } = req.query;
    
    const filters: any = {};
    if (status && typeof status === 'string') {
      const validStatuses: OrderStatus[] = ['NEW', 'TRIAGE', 'QUOTE', 'APPROVED', 'SCHEDULED', 'INSERVICE', 'READY', 'DELIVERED', 'CLOSED', 'CANCELLED'];
      if (validStatuses.includes(status as OrderStatus)) {
        filters.status = status as OrderStatus;
      }
    }

    if (category && typeof category === 'string') {
      filters.category = category;
    }

    const orders = await orderService.getOrdersWithPagination(
      filters,
      parseInt(page as string),
      parseInt(limit as string)
    );

    res.json(orders);
  } catch (error) {
    console.error('Error fetching provider orders:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;