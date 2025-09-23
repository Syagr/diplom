import { PrismaClient, Estimate } from '@prisma/client';

const prisma = new PrismaClient();

export class EstimateService {
  async getEstimateByOrderId(orderId: number) {
    return await prisma.estimate.findUnique({
      where: { orderId },
      include: {
        order: {
          include: {
            client: {
              select: { id: true, name: true, phone: true }
            },
            vehicle: {
              select: { id: true, plate: true, make: true, model: true }
            }
          }
        }
      }
    });
  }

  async createEstimate(estimateData: {
    orderId: number;
    laborCost: number;
    partsCost: number;
    totalCost: number;
    estimatedDays?: number | null;
    description?: string | null;
    breakdown?: any;
  }) {
    const estimate = await prisma.estimate.create({
      data: {
        orderId: estimateData.orderId,
        itemsJson: estimateData.breakdown || {},
        laborJson: { labor: estimateData.laborCost || 0 },
        total: estimateData.totalCost,
        currency: 'UAH',
        validUntil: estimateData.estimatedDays ? new Date(Date.now() + estimateData.estimatedDays * 24 * 60 * 60 * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  // `Estimate` model doesn't have `description` column; skip if provided
      },
      include: {
        order: {
          include: {
            client: {
              select: { id: true, name: true, phone: true }
            }
          }
        }
      }
    });

    // Обновляем статус заказа на QUOTE (Order.status enum exists)
    await prisma.order.update({
      where: { id: estimateData.orderId },
      data: { status: 'QUOTE' }
    });

    // Добавляем запись в timeline (use details as Json)
    await prisma.orderTimeline.create({
      data: {
        orderId: estimateData.orderId,
        event: 'Estimate created',
        details: {
          total: Number(estimateData.totalCost),
          estimatedDays: estimateData.estimatedDays || null
        }
      }
    });

    return estimate;
  }

  async updateEstimate(estimateId: number, updateData: Partial<{
    laborCost: number;
    partsCost: number;
    totalCost: number;
    estimatedDays: number | null;
    description: string | null;
    breakdown: any;
  }>) {
    // Map incoming updateData to DB fields
    const data: any = {};
    if (updateData.laborCost !== undefined) data.laborJson = { labor: updateData.laborCost };
    if (updateData.partsCost !== undefined) data.itemsJson = updateData.breakdown || {};
    if (updateData.totalCost !== undefined) data.total = updateData.totalCost;
    if (updateData.estimatedDays !== undefined) data.validUntil = updateData.estimatedDays ? new Date(Date.now() + updateData.estimatedDays * 24 * 60 * 60 * 1000) : undefined;
    if (updateData.description !== undefined) data['description'] = updateData.description;

    const estimate = await prisma.estimate.update({
      where: { id: estimateId },
      data,
      include: {
        order: {
          include: {
            client: {
              select: { id: true, name: true, phone: true }
            }
          }
        }
      }
    });

    // Добавляем запись в timeline
    await prisma.orderTimeline.create({
      data: {
        orderId: estimate.orderId,
        event: 'Estimate updated',
        details: data
      }
    });

    return estimate;
  }

  async deleteEstimate(estimateId: number) {
    try {
      const estimate = await prisma.estimate.findUnique({
        where: { id: estimateId },
        select: { orderId: true }
      });

      if (!estimate) {
        return false;
      }

      await prisma.estimate.delete({
        where: { id: estimateId }
      });

      // Добавляем запись в timeline
      await prisma.orderTimeline.create({
        data: {
          orderId: estimate.orderId,
          event: 'Estimate deleted'
        }
      });

      return true;
    } catch (error) {
      console.error('Error deleting estimate:', error);
      return false;
    }
  }

  async approveEstimate(estimateId: number, userId: string) {
    const estimate = await prisma.estimate.update({
      where: { id: estimateId },
      data: {
        approved: true,
        approvedAt: new Date()
      },
      include: {
        order: {
          include: {
            client: {
              select: { id: true, name: true, phone: true }
            }
          }
        }
      }
    });

    // Обновляем статус заказа на APPROVED
    await prisma.order.update({
      where: { id: estimate.orderId },
      data: { status: 'APPROVED' }
    });

    // Добавляем запись в timeline
    await prisma.orderTimeline.create({
      data: {
        orderId: estimate.orderId,
        event: 'Estimate approved',
        userId,
        details: {
          total: Number(estimate.total)
        }
      }
    });

    return estimate;
  }

  async rejectEstimate(estimateId: number, userId: string, reason?: string) {
    const estimate = await prisma.estimate.update({
      where: { id: estimateId },
      data: {
        approved: false
      },
      include: {
        order: {
          include: {
            client: {
              select: { id: true, name: true, phone: true }
            }
          }
        }
      }
    });

    // Добавляем запись в timeline
    await prisma.orderTimeline.create({
      data: {
        orderId: estimate.orderId,
        event: 'Estimate rejected',
        userId,
        details: {
          reason: reason || 'No reason provided'
        }
      }
    });

    return estimate;
  }

  async getEstimateStatistics() {
    // Estimate model does not have a `status` enum; we group by `approved` flag instead
    const stats = await prisma.estimate.groupBy({
      by: ['approved'],
      _count: {
        approved: true
      },
      _avg: {
        total: true
      }
    });

    return stats.reduce((acc, stat) => {
      acc[String(stat.approved)] = {
        count: stat._count.approved,
        avgCost: stat._avg.total ? Number(stat._avg.total) : null
      };
      return acc;
    }, {} as Record<string, { count: number; avgCost: number | null }>);
  }
}

export default new EstimateService();