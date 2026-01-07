// estimate.service.ts
import prisma from '../utils/prisma.js';
import type { Prisma } from '@prisma/client';

const DAY_MS = 86_400_000;

async function audit(type: string, payload: Record<string, unknown>, userId?: number | string | null) {
  try {
    await prisma.auditEvent.create({ data: { type, payload, userId: userId != null ? Number(userId) : null } });
  } catch {
    /* non-fatal */
  }
}

function httpError(code: string, status = 400, message?: string) {
  const err: any = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

export class EstimateService {
  // === READ ===
  async getEstimateByOrderId(orderId: number) {
    return prisma.estimate.findUnique({
      where: { orderId },
      include: {
        order: {
          include: {
            client: { select: { id: true, name: true, phone: true } },
            vehicle: { select: { id: true, plate: true, make: true, model: true } },
          },
        },
      },
    });
  }

  async getEstimateById(estimateId: number) {
    return prisma.estimate.findUnique({
      where: { id: estimateId },
      include: {
        order: {
          include: {
            client: { select: { id: true, name: true, phone: true } },
            vehicle: { select: { id: true, plate: true, make: true, model: true } },
          },
        },
      },
    });
  }

  // === CREATE ===
  async createEstimate(input: {
    orderId: number;
    laborCost: number;
    partsCost: number;
    totalCost: number;
    estimatedDays?: number | null;
    description?: string | null; // колонка может отсутствовать — не пишем её
    breakdown?: Record<string, unknown>;
  }) {
    const expiresAt = new Date(Date.now() + (input.estimatedDays ?? 7) * DAY_MS);

    return prisma.$transaction(async (tx) => {
      // 1) проверим заказ
      const order = await tx.order.findUnique({
        where: { id: input.orderId },
        select: { id: true, status: true },
      });
      if (!order) throw httpError('ORDER_NOT_FOUND', 404);

      // 2) идемпотентность: одна смета на заказ
      const existing = await tx.estimate.findUnique({ where: { orderId: input.orderId } });
      if (existing) throw httpError('ESTIMATE_EXISTS', 409);

      // 3) создаём смету
      const estimate = await tx.estimate.create({
        data: {
          orderId: input.orderId,
          itemsJson: input.breakdown ?? {},                           // детали запчастей
          laborJson: { labor: input.laborCost ?? 0, parts: input.partsCost ?? 0 }, // структура затрат
          total: input.totalCost,
          currency: 'UAH',
          validUntil: expiresAt,
          // description: input.description ?? null, // если колонка появится
        },
        include: {
          order: { include: { client: { select: { id: true, name: true, phone: true } } } },
        },
      });

      // 4) статус заказа — только если он ещё "назад" (NEW|TRIAGE|QUOTE)
      const forwardOnly = new Set(['NEW', 'TRIAGE', 'QUOTE']);
      if (order.status && forwardOnly.has(order.status)) {
        await tx.order.update({ where: { id: input.orderId }, data: { status: 'QUOTE' } });
      }

      // 5) таймлайн
      await tx.orderTimeline.create({
        data: {
          orderId: input.orderId,
          event: 'Estimate created',
          details: { total: Number(input.totalCost), estimatedDays: input.estimatedDays ?? null },
        },
      });

      void audit('estimate:created', {
        estimateId: estimate.id,
        orderId: input.orderId,
        total: Number(input.totalCost),
      });

      return estimate;
    });
  }

  // === UPDATE ===
  async updateEstimate(
    estimateId: number,
    updateData: Partial<{
      laborCost: number;
      partsCost: number;
      totalCost: number;
      estimatedDays: number | null;
      description: string | null; // колонка может отсутствовать
      breakdown: Record<string, unknown>;
    }>
  ) {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.estimate.findUnique({
          where: { id: estimateId },
          select: { id: true, orderId: true, itemsJson: true, laborJson: true },
        });
        if (!current) return null;

        // merge JSON
        const itemsJson =
          updateData.breakdown
            ? { ...(current.itemsJson as Record<string, unknown> ?? {}), ...updateData.breakdown }
            : (current.itemsJson as Record<string, unknown> ?? {});

        const laborJson = {
          ...(current.laborJson as Record<string, unknown> ?? {}),
          ...(updateData.laborCost !== undefined ? { labor: updateData.laborCost } : {}),
          ...(updateData.partsCost !== undefined ? { parts: updateData.partsCost } : {}),
        };

        const data: Prisma.EstimateUpdateInput = {
          itemsJson: { set: itemsJson },
          laborJson: { set: laborJson },
        };

        if (updateData.totalCost !== undefined) (data as any).total = updateData.totalCost;

        if (updateData.estimatedDays !== undefined) {
          (data as any).validUntil =
            updateData.estimatedDays === null
              ? null
              : new Date(Date.now() + updateData.estimatedDays * DAY_MS);
        }

        // Не пишем description, если колонки нет:
        // if (updateData.description !== undefined) (data as any).description = updateData.description;

        const estimate = await tx.estimate.update({
          where: { id: estimateId },
          data,
          include: {
            order: { include: { client: { select: { id: true, name: true, phone: true } } } },
          },
        });

        await tx.orderTimeline.create({
          data: { orderId: estimate.orderId, event: 'Estimate updated', details: data as any },
        });

        void audit('estimate:updated', {
          estimateId,
          orderId: estimate.orderId,
        });

        return estimate;
      });
    } catch (err: any) {
      if (err?.code === 'P2025') return null; // not found
      throw err;
    }
  }

  // === DELETE ===
  async deleteEstimate(estimateId: number) {
    try {
      return await prisma.$transaction(async (tx) => {
        const estimate = await tx.estimate.findUnique({
          where: { id: estimateId },
          select: { orderId: true },
        });
        if (!estimate) return false;

        await tx.estimate.delete({ where: { id: estimateId } });

        await tx.orderTimeline.create({
          data: { orderId: estimate.orderId, event: 'Estimate deleted' },
        });

        void audit('estimate:deleted', {
          estimateId,
          orderId: estimate.orderId,
        });

        return true;
      });
    } catch (error) {
      // лог можно вынести на уровень роутера
      return false;
    }
  }

  // === APPROVE ===
  async approveEstimate(estimateId: number, userId: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.estimate.findUnique({
          where: { id: estimateId },
          include: { order: true },
        });
        if (!existing) return null;

        // уже одобрено — поддерживаем согласованность статуса заказа и выходим
        if (existing.approved) {
          if (existing.order && existing.order.status !== 'APPROVED') {
            await tx.order.update({ where: { id: existing.orderId }, data: { status: 'APPROVED' } });
          }
          return existing;
        }

        // запретим approve для отменённых/закрытых заказов
        if (existing.order?.status && ['CANCELLED', 'CLOSED'].includes(existing.order.status)) {
          throw httpError('INVALID_STATE', 409, 'Order state does not allow approval');
        }

        const estimate = await tx.estimate.update({
          where: { id: estimateId },
          data: { approved: true, approvedAt: new Date() },
          include: {
            order: { include: { client: { select: { id: true, name: true, phone: true } } } },
          },
        });

        await tx.order.update({ where: { id: estimate.orderId }, data: { status: 'APPROVED' } });

        await tx.orderTimeline.create({
          data: {
            orderId: estimate.orderId,
            event: 'Estimate approved',
            userId: String(userId),
            details: { total: Number(estimate.total) },
          },
        });

        // аудит (лучше иметь отдельную колонку estimateId + unique index)
        try {
          const exists: any = await tx.$queryRaw`
            SELECT id FROM audit_events
            WHERE type = 'estimate:approved' AND (payload->>'estimateId')::int = ${estimate.id} LIMIT 1
          `;
          const already = Array.isArray(exists) ? exists.length > 0 : !!exists;
          if (!already) {
            await tx.auditEvent.create({
              data: {
                type: 'estimate:approved',
                payload: { estimateId: estimate.id, approvedBy: Number(userId) },
                userId: Number(userId),
              },
            });
          }
        } catch { /* non-fatal */ }

        return estimate;
      });
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  // === REJECT ===
  async rejectEstimate(estimateId: number, userId: string, reason?: string) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.estimate.findUnique({
          where: { id: estimateId },
          include: { order: true },
        });
        if (!existing) return null;

        // нельзя отклонять уже одобренную
        if (existing.approved) throw httpError('ALREADY_APPROVED', 409);

        const estimate = await tx.estimate.update({
          where: { id: estimateId },
          data: { approved: false, approvedAt: null },
          include: {
            order: { include: { client: { select: { id: true, name: true, phone: true } } } },
          },
        });

        await tx.orderTimeline.create({
          data: {
            orderId: estimate.orderId,
            event: 'Estimate rejected',
            userId: String(userId),
            details: { reason: reason || 'No reason provided' },
          },
        });

        try {
          const exists: any = await tx.$queryRaw`
            SELECT id FROM audit_events
            WHERE type = 'estimate:rejected' AND (payload->>'estimateId')::int = ${estimate.id} LIMIT 1
          `;
          const already = Array.isArray(exists) ? exists.length > 0 : !!exists;
          if (!already) {
            await tx.auditEvent.create({
              data: {
                type: 'estimate:rejected',
                payload: { estimateId: estimate.id, rejectedBy: Number(userId), reason: reason || null },
                userId: Number(userId),
              },
            });
          }
        } catch { /* non-fatal */ }

        return estimate;
      });
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  // === STATS ===
  async getEstimateStatistics() {
    const stats = await prisma.estimate.groupBy({
      by: ['approved'],
      _count: { approved: true },
      _avg: { total: true },
    });

    return stats.reduce((acc, s) => {
      acc[String(s.approved)] = {
        count: s._count.approved,
        avgCost: s._avg.total != null ? Number(s._avg.total) : null,
      };
      return acc;
    }, {} as Record<string, { count: number; avgCost: number | null }>);
  }
}

export default new EstimateService();
