// services/order.service.ts
import prisma from '@/utils/prisma.js';
import type { OrderStatus, Prisma } from '@prisma/client';

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export type OrdersFilters = {
  clientId?: number;
  status?: OrderStatus;
  category?: string;
  providerId?: number; // если нужно фильтровать по исполнителю
};

export class OrderService {
  /**
   * Список заказов с пагинацией и лёгкими фильтрами.
   * Возвращает заказы + пагинацию.
   */
  async getOrdersWithPagination(
    filters: OrdersFilters = {},
    page = 1,
    limit = 20
  ): Promise<{
    orders: any[];
    pagination: { page: number; limit: number; total: number; pages: number };
  }> {
    const safePage = clamp(Number(page) || 1, 1, 10_000);
    const safeLimit = clamp(Number(limit) || 20, 1, 200);
    const skip = (safePage - 1) * safeLimit;

    // prisma where
    const where: Prisma.OrderWhereInput = {
      ...(filters.clientId ? { clientId: Number(filters.clientId) } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.providerId ? { assignedToId: Number(filters.providerId) } : {}),
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        include: {
          client: { select: { id: true, name: true, phone: true, email: true } },
          vehicle: { select: { id: true, plate: true, make: true, model: true, year: true, vin: true } },
          estimate: true,
          payments: true,
          tow: true,
          locations: true,
          offers: true,
          attachments: { where: { status: { in: ['pending', 'ready'] } }, orderBy: { createdAt: 'desc' } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Получить заказ по id.
   */
  async getOrderById(orderId: number) {
    const id = Number(orderId);
    if (!Number.isFinite(id)) return null;

    return prisma.order.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, phone: true, email: true } },
        vehicle: { select: { id: true, plate: true, make: true, model: true, year: true, vin: true } },
        estimate: true,
        payments: true,
        tow: true,
        offers: true,
        attachments: true,
        timeline: { orderBy: { createdAt: 'asc' } },
        locations: true,
      },
    });
  }

  /**
   * Обновить статус заказа (с записью в таймлайн).
   * Выполняется транзакционно.
   */
  async updateOrderStatus(
    orderId: number,
    status: OrderStatus,
    actorUserId?: number
  ) {
    const id = Number(orderId);
    if (!Number.isFinite(id)) throw Object.assign(new Error('INVALID_ORDER_ID'), { status: 400 });

    return prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: { status, updatedAt: new Date() },
        include: {
          client: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { id: true, plate: true, make: true, model: true } },
        },
      });

      await tx.orderTimeline.create({
        data: {
          orderId: id,
          event: `Status changed to ${status}`,
          userId: actorUserId ?? null,
          details: { status },
        },
      });

      return updatedOrder;
    });
  }

  /**
   * Создать заказ (и запись в таймлайн).
   * Возвращает заказ с краткой связанной инфой.
   */
  async createOrder(orderData: {
    clientId: number;
    vehicleId: number;
    category: string;
    description?: string;
    channel?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
  }) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          clientId: orderData.clientId,
          vehicleId: orderData.vehicleId,
          category: orderData.category,
          description: orderData.description ?? null,
          channel: orderData.channel ?? null,
          priority: (orderData.priority as any) ?? 'normal',
          status: 'NEW',
        },
        include: {
          client: { select: { id: true, name: true, phone: true } },
          vehicle: { select: { id: true, plate: true, make: true, model: true } },
        },
      });

      await tx.orderTimeline.create({
        data: {
          orderId: order.id,
          event: 'Order created',
          details: { category: order.category, priority: order.priority },
        },
      });

      return order;
    });
  }

  /**
   * Статистика по статусам (опционально по клиенту).
   */
  async getOrderStatistics(clientId?: number) {
    const where: Prisma.OrderWhereInput = clientId ? { clientId: Number(clientId) } : {};

    const stats = await prisma.order.groupBy({
      by: ['status'],
      where,
      _count: { status: true },
    });

    return stats.reduce((acc, s) => {
      acc[s.status] = s._count.status;
      return acc;
    }, {} as Record<OrderStatus, number>);
  }
}

export default new OrderService();
