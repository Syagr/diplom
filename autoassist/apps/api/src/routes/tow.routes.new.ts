import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware.js';
// Сервіс очікується actor-aware
// towQuote(orderId, from, to, actor?) -> { distanceKm, etaMin, price, currency, ... }
// saveTowQuote(orderId, quote, actor?) -> TowQuote
// assignTow(orderId, partnerId, actor?) -> TowAssignment
import { assignTow, saveTowQuote, towQuote } from '../services/tow.service.new.js';

export const tow = Router();

// ---- helpers ----
type AuthUser = { id: number; role?: string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const isStaff = (u?: AuthUser) => !!u && ['admin','manager'].includes(String(u.role).toLowerCase());
const safeEmit = (req: Request, room: string, event: string, payload: unknown) => {
  const io = req.app?.get?.('io');
  if (io?.to) io.to(room).emit(event, payload);
};

// ---- validation ----
const Coord = z.object({
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
});

const QuoteBody = z.object({
  orderId: z.coerce.number().int().positive(),
  from: Coord,
  to:   Coord,
});

const AssignParams = z.object({
  orderId: z.coerce.number().int().positive(),
});

const AssignBody = z.object({
  partnerId: z.coerce.number().int().positive(),
});

// ---- secure all routes ----
tow.use(authenticate);

/**
 * POST /tow/quote
 * Згенерувати та зберегти кошторис евакуації (tow quote).
 * Доступ: власник замовлення або staff (контроль — у сервісі).
 */
tow.post('/quote', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

    const body = QuoteBody.parse(req.body);

    // сервіс сам перевіряє право доступу до order, стан order, idempotency за останнім маршрутом тощо
    const q = await towQuote(
      body.orderId,
      { lat: body.from.lat, lng: body.from.lng },
      { lat: body.to.lat,   lng: body.to.lng },
    );

    const saved = await saveTowQuote(body.orderId, { distanceKm: q.distanceKm, price: q.price, etaMinutes: q.etaMinutes });

    safeEmit(req, `order:${body.orderId}`, 'order:updated', {
      id: body.orderId,
      kind: 'tow.quote',
      quoteId: saved.id,
      distanceKm: saved.distanceKm,
      price: saved.price,
  etaMinutes: saved.etaMinutes,
    });

    return res.status(201).json({ tow: saved });
  } catch (e: any) {
    // узгоджені помилки від сервісу
    if (e.code === 'FORBIDDEN')        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    if (e.code === 'ORDER_NOT_FOUND')  return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    if (e.code === 'INVALID_ROUTE')    return res.status(400).json({ error: { code: 'INVALID_ROUTE', message: 'Invalid tow route' } });
    if (e.code === 'IDEMPOTENT_REPLAY')return res.status(200).json({ tow: e.payload }); // повертаємо попередній quote
    return next(e);
  }
});

/**
 * POST /tow/:orderId/assign
 * Призначити партнера-евакуатор.
 * Доступ: staff (або, якщо хочеш, власник + підтвердження — у сервісі).
 */
tow.post('/:orderId/assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = getAuth(req);
    if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    if (!isStaff(user)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff only' } });

    const { orderId } = AssignParams.parse(req.params);
    const { partnerId } = AssignBody.parse(req.body);

  const t = await assignTow(orderId, partnerId);

    safeEmit(req, `order:${orderId}`, 'order:updated', {
      id: orderId,
      kind: 'tow.assigned',
      partnerId: t.partnerId,
      assignmentId: t.id,
  etaMinutes: t.etaMinutes ?? null,
    });

    return res.json({ tow: t });
  } catch (e: any) {
    if (e.code === 'FORBIDDEN')         return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    if (e.code === 'ORDER_NOT_FOUND')   return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
    if (e.code === 'PARTNER_NOT_FOUND') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tow partner not found' } });
    if (e.code === 'ALREADY_ASSIGNED')  return res.status(409).json({ error: { code: 'ALREADY_ASSIGNED', message: 'Tow already assigned' } });
    return next(e);
  }
});

export default tow;
