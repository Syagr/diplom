import { Router } from 'express';
import type { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

// Reuse a global PrismaClient instance to avoid creating multiple clients in dev/hot-reload
const g: any = globalThis as any;
const prisma: PrismaClient = g.__prisma ?? (g.__prisma = new PrismaClient());
const router = Router();

// GET /admin/audit - recent audit events (admin only)
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const role = (req.user as any)?.role;
    if (!role || String(role).toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'Admin role required' });
    }

    const events = await prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    // Batch collect estimateIds referenced in payloads so we can annotate events with current estimate state
    const estimateIds = Array.from(new Set(events
      .map(e => {
        try {
          const p = e.payload as any;
          if (!p) return null;
          if (p.estimateId) return Number(p.estimateId);
          if (p.estimate && p.estimate.id) return Number(p.estimate.id);
        } catch (err) { }
        return null;
      })
      .filter(Boolean)
    )) as number[];

    const estimatesById: Record<number, { id: number; approved: boolean }> = {};
    if (estimateIds.length > 0) {
      const ests = await prisma.estimate.findMany({ where: { id: { in: estimateIds } }, select: { id: true, approved: true } });
      for (const e of ests) estimatesById[e.id] = e;
    }

    // Attach an internal flag to payload if we know the estimate is approved
    const annotated = events.map(ev => {
      try {
        const payload = ev.payload as any;
        if (payload) {
          let id: number | null = null;
          if (payload.estimateId) id = Number(payload.estimateId);
          else if (payload.estimate && payload.estimate.id) id = Number(payload.estimate.id);
          if (id !== null) {
            const est = estimatesById[id];
            if (est) payload._estimateApproved = !!est.approved;
          }
        }
      } catch (e) { /* ignore payload parsing errors */ }
      return ev;
    });

    res.json(annotated);
  } catch (err: any) {
    const msg = err?.message || String(err);
    // If the audit_events table is missing (Prisma/migrations not applied), return an empty list
    if (typeof msg === 'string' && msg.includes('audit_events') && msg.includes('does not exist')) {
      console.warn('Audit table missing - returning empty audit list. Run Prisma migrations to populate DB tables.');
      return res.json([]);
    }

    console.error('Failed to fetch audit events', {
      message: msg,
      stack: err?.stack
    });
    res.status(500).json({ error: 'INTERNAL', message: 'Failed to fetch audit events' });
  }
});

export default router;
