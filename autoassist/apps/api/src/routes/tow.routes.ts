import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '@/utils/prisma.js';
import { calculateDistance, formatCurrency } from '../../../../packages/shared/dist/utils/helpers.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { logger } from '../libs/logger.js';

const router = Router();

// ---- helpers ----
type AuthUser = { id: number; role?: string };
const getAuth = (req: Request) => (req as any).user as AuthUser | undefined;
const isStaff = (u?: AuthUser) => !!u && ['admin','manager','dispatcher'].includes(String(u.role).toLowerCase());
const safeEmit = (req: Request, room: string, event: string, payload: unknown) => {
  const io = req.app?.get?.('io');
  if (io?.to) io.to(room).emit(event, payload);
};

// ---- config ----
const TOW_CONFIG = {
  BASE_RATE: 200,
  PER_KM_RATE: 15,
  NIGHT_MULTIPLIER: 1.5,    // 18:00–05:59
  EMERGENCY_MULTIPLIER: 2.0,
  WEEKEND_MULTIPLIER: 1.2,
  SERVICE: {
    STANDARD: { name: 'Standard Tow', etaMultiplier: 1.0, priceMultiplier: 1.0 },
    EXPRESS:  { name: 'Express Tow',  etaMultiplier: 0.7, priceMultiplier: 1.5 },
    PREMIUM:  { name: 'Premium Tow',  etaMultiplier: 0.5, priceMultiplier: 2.0 },
  },
} as const;

// ---- validation ----
const Coord = z.object({
  latitude: z.coerce.number().gte(-90).lte(90),
  longitude: z.coerce.number().gte(-180).lte(180),
  address: z.string().optional(),
});

const QuoteBody = z.object({
  orderId: z.coerce.number().int().positive().optional(),
  pickup: Coord.optional(),
  destination: Coord.optional(),
  serviceLevel: z.enum(['STANDARD','EXPRESS','PREMIUM']).default('STANDARD'),
});

const AssignParams = z.object({ orderId: z.coerce.number().int().positive() });
const AssignBody = z.object({
  towTruckId: z.coerce.number().int().positive().optional(),
  driverId: z.union([z.coerce.number().int().positive(), z.string().min(1)]).optional(),
  serviceLevel: z.enum(['STANDARD','EXPRESS','PREMIUM']).default('STANDARD'),
});

const StatusParams = z.object({ orderId: z.coerce.number().int().positive() });
const UpdateStatusBody = z.object({
  status: z.enum(['ASSIGNED','EN_ROUTE','ARRIVED','LOADING','IN_TRANSIT','DELIVERED','COMPLETED']),
  location: z.object({ lat: z.coerce.number(), lng: z.coerce.number() }).optional(),
  estimatedArrival: z.string().datetime().optional(),
});

// ---- secure all routes ----
router.use(authenticate);

/**
 * POST /api/tow/quote
 */
router.post('/quote', async (req: Request, res: Response, next: NextFunction) => {
  const user = getAuth(req);
  if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

  try {
    const { orderId, pickup, destination, serviceLevel } = QuoteBody.parse(req.body);

    let order: any | null = null;
    let from = pickup;
    let to = destination;

    if (!orderId && !pickup) {
      return res.status(400).json({ error: { code: 'MISSING_PARAMS', message: 'orderId or pickup location is required' } });
    }

    if (orderId) {
      order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { locations: true, vehicle: true, client: { select: { id: true } } },
      });
      if (!order) return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found' } });

      // RBAC: клієнт свого замовлення або staff
      if (!isStaff(user) && order.clientId !== user.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
      }

      // узгоджуємо тип поля локації (kind vs type). Припустимо, в БД зберігаємо lower-case 'pickup'
      const pickupLoc = order.locations.find((l: any) => (l.kind ?? l.type)?.toString().toLowerCase() === 'pickup');
      if (!from && pickupLoc) {
        from = { latitude: pickupLoc.lat ?? pickupLoc.latitude, longitude: pickupLoc.lng ?? pickupLoc.longitude, address: pickupLoc.address ?? undefined };
      }
    }

    if (!from?.latitude || !from?.longitude) {
      return res.status(400).json({ error: { code: 'INVALID_PICKUP', message: 'Valid pickup coordinates are required' } });
    }

    if (!to) {
      to = await findNearestServiceCenter(from);
    }

    const quote = await calculateTowQuote(from, to, serviceLevel, order);

    // якщо orderId є — збережемо/оновимо як QUOTED
    if (orderId) {
      await prisma.towRequest.upsert({
        where: { orderId },
        update: {
          distanceKm: quote.data.distanceKm,
          etaMinutes: quote.data.etaMinutes,
          price: quote.data.price,
          status: 'QUOTED',
          // можна зберігати JSON поля pickup/destination/level
          routeJson: { pickup: quote.pickup, destination: quote.destination, serviceLevel },
        },
        create: {
          orderId,
          distanceKm: quote.data.distanceKm,
          etaMinutes: quote.data.etaMinutes,
          price: quote.data.price,
          status: 'QUOTED',
          routeJson: { pickup: quote.pickup, destination: quote.destination, serviceLevel },
        },
      });

      safeEmit(req, `order:${orderId}`, 'order:updated', {
        id: orderId, kind: 'tow.quote', distanceKm: quote.data.distanceKm, price: quote.data.price, etaMin: quote.data.etaMinutes,
      });
    }

    logger.info('Tow quote generated', { orderId: orderId ?? null, distance: quote.data.distanceKm, price: quote.data.price, serviceLevel });
    return res.status(201).json({ success: true, data: quote, message: 'Tow quote generated successfully' });
  } catch (error) {
    logger.error('Failed to generate tow quote', { userId: getAuth(req)?.id, error: error instanceof Error ? error.message : String(error) });
    return next(error);
  }
});

/**
 * POST /api/tow/:orderId/assign
 */
router.post('/:orderId/assign', async (req: Request, res: Response, next: NextFunction) => {
  const user = getAuth(req);
  if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  if (!isStaff(user)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Staff only' } });

  try {
    const { orderId } = AssignParams.parse(req.params);
    const { towTruckId, driverId, serviceLevel } = AssignBody.parse(req.body);

    const towRequest = await prisma.towRequest.findUnique({
      where: { orderId },
      include: { order: { include: { locations: true, client: true } } },
    });
    if (!towRequest) return res.status(404).json({ error: { code: 'TOW_REQUEST_NOT_FOUND', message: 'Tow request not found for this order' } });

    if (towRequest.status !== 'QUOTED') {
      return res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Tow request must be in QUOTED status to assign' } });
    }

    const updatedRequest = await prisma.towRequest.update({
      where: { orderId },
      data: {
        status: 'ASSIGNED',
        partnerId: towTruckId ?? towRequest.partnerId ?? null,
        driverName: driverId ? String(driverId) : towRequest.driverName ?? null,
        vehicleInfo: serviceLevel,
      },
    });

    await prisma.order.update({ where: { id: orderId }, data: { status: 'SCHEDULED' } });

    safeEmit(req, `order:${orderId}`, 'order:updated', {
      id: orderId, kind: 'tow.assigned', partnerId: updatedRequest.partnerId, assignmentId: updatedRequest.id,
    });

    return res.json({
      success: true,
      data: { towRequestId: updatedRequest.id, status: updatedRequest.status, etaMinutes: updatedRequest.etaMinutes, price: updatedRequest.price, assignedAt: new Date() },
      message: 'Tow truck assigned successfully',
    });
  } catch (error) {
    logger.error('Failed to assign tow truck', { userId: getAuth(req)?.id, error: error instanceof Error ? error.message : String(error) });
    return next(error);
  }
});

/**
 * GET /api/tow/:orderId/status
 */
router.get('/:orderId/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId } = StatusParams.parse(req.params);

    const towRequest = await prisma.towRequest.findUnique({
      where: { orderId },
      include: { order: { select: { id: true, status: true } } },
    });
    if (!towRequest) return res.status(404).json({ error: { code: 'TOW_REQUEST_NOT_FOUND', message: 'Tow request not found' } });

    const response = {
      id: towRequest.id,
      orderId: towRequest.orderId,
      status: towRequest.status,
      distanceKm: towRequest.distanceKm,
      etaMinutes: towRequest.etaMinutes,
      price: towRequest.price,
      priceFormatted: formatCurrency(Number(towRequest.price), 'UAH'),
      metadata: towRequest.trackingJson ?? null,
      createdAt: towRequest.createdAt,
      updatedAt: towRequest.updatedAt,
    };

    return res.json({ success: true, data: response });
  } catch (error) {
    logger.error('Failed to get tow status', { error: error instanceof Error ? error.message : String(error) });
    return next(error);
  }
});

/**
 * PUT /api/tow/:orderId/status
 */
router.put('/:orderId/status', async (req: Request, res: Response, next: NextFunction) => {
  const user = getAuth(req);
  if (!user) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });

  try {
    const { orderId } = StatusParams.parse(req.params);
    const { status, location, estimatedArrival } = UpdateStatusBody.parse(req.body);

    // право оновлення: staff або призначений виконавець (перевірка у проді — через сервіс)
    if (!isStaff(user)) {
      // TODO: перевірити, що user — водій/партнер towRequest
    }

    const towRequest = await prisma.towRequest.findUnique({ where: { orderId } });
    if (!towRequest) return res.status(404).json({ error: { code: 'TOW_REQUEST_NOT_FOUND', message: 'Tow request not found' } });

    const updated = await prisma.towRequest.update({
      where: { orderId },
      data: {
        status,
        trackingJson: { lastUpdate: new Date(), currentLocation: location ?? null, estimatedArrival: estimatedArrival ?? null },
      },
    });

    // мапа статусів order
    const orderStatusMap: Record<string, string> = {
      EN_ROUTE: 'SCHEDULED',
      ARRIVED: 'INSERVICE',
      LOADING: 'INSERVICE',
      IN_TRANSIT: 'INSERVICE',
      DELIVERED: 'READY',
      COMPLETED: 'READY',
    };
    const nextOrderStatus = orderStatusMap[status];
    if (nextOrderStatus) {
      await prisma.order.update({ where: { id: orderId }, data: { status: nextOrderStatus as any } });
    }

    safeEmit(req, `order:${orderId}`, 'tow:status', { status, location: location ?? null });

    return res.json({ success: true, data: { id: updated.id, status: updated.status, metadata: updated.trackingJson ?? null }, message: 'Tow status updated successfully' });
  } catch (error) {
    logger.error('Failed to update tow status', { error: error instanceof Error ? error.message : String(error) });
    return next(error);
  }
});

// ---- helpers ----
function formatETA(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60); const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function calculateTowQuote(pickup: any, destination: any, serviceLevel: keyof typeof TOW_CONFIG['SERVICE'], order?: any) {
  const distance = calculateDistance(pickup.latitude, pickup.longitude, destination.latitude, destination.longitude);
  const lv = TOW_CONFIG.SERVICE[serviceLevel] ?? TOW_CONFIG.SERVICE.STANDARD;

  let price = TOW_CONFIG.BASE_RATE + distance * TOW_CONFIG.PER_KM_RATE;
  price *= lv.priceMultiplier;

  const hour = new Date().getHours();
  const isNight = hour >= 18 || hour < 6;          // до 05:59
  const isWeekend = [0, 6].includes(new Date().getDay());
  const isEmergency = order?.type?.toString().toUpperCase() === 'EMERGENCY';

  if (isNight)    price *= TOW_CONFIG.NIGHT_MULTIPLIER;
  if (isWeekend)  price *= TOW_CONFIG.WEEKEND_MULTIPLIER;
  if (isEmergency)price *= TOW_CONFIG.EMERGENCY_MULTIPLIER;

  const avgSpeed = distance > 50 ? 60 : 30;
  let etaMinutes = Math.round((distance / avgSpeed) * 60);
  etaMinutes = Math.round(etaMinutes * lv.etaMultiplier) + (isEmergency ? 5 : 15);

  const roundedDistance = Math.round(distance * 10) / 10;
  const roundedPrice = Math.round(price);

  return {
    data: { distanceKm: roundedDistance, etaMinutes, price: roundedPrice },
    display: {
      distance: `${roundedDistance} km`,
      eta: formatETA(etaMinutes),
      price: formatCurrency(roundedPrice, 'UAH'),
      serviceLevel: lv.name,
      isNight, isWeekend, isEmergency,
    },
    pickup: { latitude: pickup.latitude, longitude: pickup.longitude, address: pickup.address ?? `${pickup.latitude}, ${pickup.longitude}` },
    destination: { latitude: destination.latitude, longitude: destination.longitude, address: destination.address ?? `${destination.latitude}, ${destination.longitude}` },
  };
}

async function findNearestServiceCenter(pickup: any) {
  const centers = [
    { name: 'Kyiv Service Center',    latitude: 50.4501, longitude: 30.5234, address: 'Kyiv, Ukraine' },
    { name: 'Lviv Service Center',    latitude: 49.8397, longitude: 24.0297, address: 'Lviv, Ukraine' },
    { name: 'Kharkiv Service Center', latitude: 49.9935, longitude: 36.2304, address: 'Kharkiv, Ukraine' },
    { name: 'Odesa Service Center',   latitude: 46.4825, longitude: 30.7233, address: 'Odesa, Ukraine' },
  ];
  let nearest = centers[0];
  let min = calculateDistance(pickup.latitude, pickup.longitude, nearest.latitude, nearest.longitude);
  for (const c of centers.slice(1)) {
    const d = calculateDistance(pickup.latitude, pickup.longitude, c.latitude, c.longitude);
    if (d < min) { min = d; nearest = c; }
  }
  return nearest;
}

export default router;
