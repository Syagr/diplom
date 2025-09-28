import { PrismaClient } from '@prisma/client';
import type { Estimate } from '@prisma/client';

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

    try {
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
    } catch (err: any) {
      // If the record does not exist, return null so route can return 404
      if (err && err.code === 'P2025') return null;
      console.error('Error updating estimate:', err);
      throw err;
    }
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
    try {
      // Read current state first to make this operation idempotent
      const existing = await prisma.estimate.findUnique({
        where: { id: estimateId },
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

      if (!existing) return null;

      // If already approved - make sure order status is consistent and return existing without creating duplicate timeline/audit
      if (existing.approved) {
        try {
          if (existing.order && existing.order.status !== 'APPROVED') {
            await prisma.order.update({ where: { id: existing.orderId }, data: { status: 'APPROVED' } });
          }
        } catch (e) {
          console.warn('Failed to reconcile order status for already-approved estimate', e?.message || e);
        }

        return existing;
      }

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
          userId: String(userId),
          details: {
            total: Number(estimate.total)
          }
        }
      });

      // Записываем в глобальный аудит для админки (idempotent: skip if an approval audit already exists for this estimate)
      try {
        // Use a small raw query to check JSON payload for existing estimateId
        const existingAudit: any = await prisma.$queryRaw`
          SELECT id FROM audit_events WHERE type = 'estimate:approved' AND (payload->>'estimateId')::int = ${estimate.id} LIMIT 1
        `;

        if (!existingAudit || (Array.isArray(existingAudit) && existingAudit.length === 0)) {
          await prisma.auditEvent.create({
            data: {
              type: 'estimate:approved',
              payload: { estimateId: estimate.id, approvedBy: Number(userId) },
              userId: Number(userId)
            }
          });
        } else {
          // already recorded - skip creating duplicate
          console.debug('Audit event for estimate approval already exists, skipping duplicate creation', { estimateId: estimate.id });
        }
      } catch (e) {
        // non-fatal: log and continue
        console.warn('Failed to write or check audit event for estimate approval', e?.message || e);
      }

      return estimate;
    } catch (err: any) {
      if (err && err.code === 'P2025') return null;
      console.error('Error approving estimate:', err);
      throw err;
    }
  }

  async rejectEstimate(estimateId: number, userId: string, reason?: string) {
    try {
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
          userId: String(userId),
          details: {
            reason: reason || 'No reason provided'
          }
        }
      });

      // Записываем в глобальный аудит для админки (avoid duplicate rejection events for same estimate)
      try {
        const existingAudit: any = await prisma.$queryRaw`
          SELECT id FROM audit_events WHERE type = 'estimate:rejected' AND (payload->>'estimateId')::int = ${estimate.id} LIMIT 1
        `;

        if (!existingAudit || (Array.isArray(existingAudit) && existingAudit.length === 0)) {
          await prisma.auditEvent.create({
            data: {
              type: 'estimate:rejected',
              payload: { estimateId: estimate.id, rejectedBy: Number(userId), reason: reason || null },
              userId: Number(userId)
            }
          });
        } else {
          console.debug('Audit event for estimate rejection already exists, skipping duplicate', { estimateId: estimate.id });
        }
      } catch (e) {
        console.warn('Failed to write or check audit event for estimate rejection', e?.message || e);
      }

      return estimate;
    } catch (err: any) {
      if (err && err.code === 'P2025') return null;
      console.error('Error rejecting estimate:', err);
      throw err;
    }
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