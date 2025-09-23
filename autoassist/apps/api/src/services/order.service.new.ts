import { PrismaClient, Order, OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

export class OrderService {
  async getOrdersWithPagination(filters: any, page: number, limit: number) {
    const skip = (page - 1) * limit;
    
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: filters,
        skip,
        take: limit,
        include: {
          client: {
            select: { id: true, name: true, phone: true }
          },
          vehicle: {
            select: { id: true, plate: true, make: true, model: true, year: true }
          },
          estimate: true,
          payments: true,
          tow: true,
          locations: true
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.order.count({ where: filters })
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  async getOrderById(orderId: string) {
    return await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      include: {
        client: {
          select: { id: true, name: true, phone: true, email: true }
        },
        vehicle: {
          select: { id: true, plate: true, make: true, model: true, year: true, vin: true }
        },
        estimate: true,
        payments: true,
        tow: true,
        offers: true,
        attachments: true,
        timeline: true,
        locations: true
      }
    });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus) {
    const updatedOrder = await prisma.order.update({
      where: { id: parseInt(orderId) },
      data: { 
        status,
        updatedAt: new Date()
      },
      include: {
        client: {
          select: { id: true, name: true, phone: true }
        },
        vehicle: {
          select: { id: true, plate: true, make: true, model: true }
        }
      }
    });

    // Добавляем запись в timeline
    await prisma.orderTimeline.create({
      data: {
        orderId: parseInt(orderId),
        event: `Status changed to ${status}`,
        userId: undefined // можно добавить userId если есть в контексте
      }
    });

    return updatedOrder;
  }

  async createOrder(orderData: {
    clientId: number;
    vehicleId: number;
    category: string;
    description?: string;
    channel?: string;
    priority?: string;
  }) {
    const order = await prisma.order.create({
      data: {
        ...orderData,
        status: 'NEW'
      },
      include: {
        client: {
          select: { id: true, name: true, phone: true }
        },
        vehicle: {
          select: { id: true, plate: true, make: true, model: true }
        }
      }
    });

    // Добавляем запись в timeline
    await prisma.orderTimeline.create({
      data: {
        orderId: order.id,
        event: 'Order created',
        userId: undefined
      }
    });

    return order;
  }

  async getOrderStatistics(clientId?: number) {
    const where = clientId ? { clientId } : {};
    
    const stats = await prisma.order.groupBy({
      by: ['status'],
      where,
      _count: {
        status: true
      }
    });

    return stats.reduce((acc, stat) => {
      acc[stat.status] = stat._count.status;
      return acc;
    }, {} as Record<string, number>);
  }
}

export default new OrderService();