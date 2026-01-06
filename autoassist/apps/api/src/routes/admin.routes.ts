// src/routes/admin.routes.ts
import { Router } from 'express';
import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

// ---- Prisma singleton (hot-reload friendly) ----
const g = globalThis as any;
const prisma: PrismaClient = g.__prisma ?? (g.__prisma = new PrismaClient());

const router = Router();

// ---- Query validation & types ----
const AuditQuery = z.object({
  // keyset pagination по id
  cursor: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .optional()
    .default('100') // zod trick: перетрится transform-ом
    .pipe(z.number().int().min(1).max(200)),
  // фильтры
  type: z.string().min(1).optional(),
  handled: z
    .string()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined))
    .optional(),
  since: z
    .string()
    .datetime()
    .transform((s) => new Date(s))
    .optional(),
});

// ---- Helpers ----
function isAdminRole(role?: unknown) {
  if (!role) return false;
  const r = String(role).toLowerCase();
  return r === 'admin';
}

// ---- GET /admin/audit ----
// Возвращает последние события аудита с пагинацией и аннотацией по смете (_estimateApproved)
router.get('/audit', async (req: Request, res: Response) => {
  try {
    // authZ
    const role = (req.user as any)?.role;
    if (!isAdminRole(role)) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin role required' });
    }

    // validate query
    const parsed = AuditQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      });
    }
    const { cursor, limit, type, handled, since } = parsed.data;

    // where + cursor
    const where: any = {};
    if (typeof type === 'string') where.type = type;
    if (typeof handled === 'boolean') where.handled = handled;
    if (since instanceof Date) where.createdAt = { gte: since };

    // keyset: orderBy id desc; если есть cursor — fetch < cursor
    if (cursor) {
      where.id = { lt: cursor };
    }

    // fetch limit+1 для определения nextCursor
    const rows = await prisma.auditEvent.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1].id) : null;

    // собрать estimateIds из payload
    const estimateIds: number[] = Array.from(
      new Set(
        items
          .map((e) => {
            try {
              const p = e.payload as any;
              if (!p) return null;
              if (p.estimateId) return Number(p.estimateId);
              if (p.estimate?.id) return Number(p.estimate.id);
            } catch (_e) {
              // ignore malformed payloads
              void 0;
            }
            return null;
          })
          .filter(Boolean) as number[],
      ),
    );

    // map estimateId -> {approved}
    const estimatesById: Record<number, { id: number; approved: boolean }> = {};
    if (estimateIds.length) {
      const ests = await prisma.estimate.findMany({
        where: { id: { in: estimateIds } },
        select: { id: true, approved: true },
      });
      for (const e of ests) estimatesById[e.id] = e;
    }

    // аннотация: payload._estimateApproved
    const annotated = items.map((ev) => {
      try {
        const payload: any = ev.payload;
        if (payload) {
          let id: number | null = null;
          if (payload.estimateId) id = Number(payload.estimateId);
          else if (payload.estimate?.id) id = Number(payload.estimate.id);
          if (id != null) {
            const est = estimatesById[id];
            if (est) payload._estimateApproved = !!est.approved;
          }
        }
      } catch (_e) {
        // skip annotation errors
        void 0;
      }
      // не меняем структуру события — только payload
      return ev;
    });

    // единый контракт ответа
    return res.json({
      items: annotated,
      nextCursor,
      count: annotated.length,
    });
  } catch (err: any) {
    const msg = err?.message || String(err);

    // Если таблица отсутствует — вернём пусто, чтобы не падать на «чистой» БД
    if (typeof msg === 'string' && msg.includes('audit_events') && msg.includes('does not exist')) {
      console.warn('Audit table missing - returning empty audit list. Run Prisma migrations to populate DB tables.');
      return res.json({ items: [], nextCursor: null, count: 0 });
    }

    console.error('Failed to fetch audit events', {
      message: msg,
      stack: err?.stack,
    });
    return res.status(500).json({ error: 'INTERNAL', message: 'Failed to fetch audit events' });
  }
});

export default router;
