// services/tow.service.ts
import prisma from '@/utils/prisma.js';
// если хочешь realtime — передай инстанс SocketService через setSocketService
import type SocketService from '@/services/socket.service.js';

type LatLng = { lat: number; lng: number };

export type TowStatus =
  | 'REQUESTED'
  | 'ASSIGNED'
  | 'ENROUTE'
  | 'ARRIVED'
  | 'LOADING'
  | 'INTRANSIT'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

const CONFIG = {
  BASE_FEE: 800,          // UAH
  KM_RATE: 25,            // UAH/km
  NIGHT_COEF: 1.25,       // 22:00-06:00
  AVG_SPEED_KMPH: 35,
  BUFFER_MIN: 15,
  NIGHT_FROM: 22,         // 22:00
  NIGHT_TO: 6,            // 06:00
} as const;

let socketService: SocketService | undefined;
export function setSocketService(s: SocketService) { socketService = s; }

const toRad = (v: number) => (v * Math.PI) / 180;
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat), la2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function isNight(h: number) {
  return h >= CONFIG.NIGHT_FROM || h <= CONFIG.NIGHT_TO;
}

function roundMoney(n: number) {
  return Math.round(n);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * Чистый расчёт без побочек.
 */
export function calculateTowQuote(
  from: LatLng,
  to: LatLng,
  now: Date = new Date()
): { distanceKm: number; price: number; etaMinutes: number; isNight: boolean } {
  const dist = haversineKm(from, to);
  const night = isNight(now.getHours());
  const base = Math.max(CONFIG.BASE_FEE + CONFIG.KM_RATE * dist, CONFIG.BASE_FEE);
  const price = base * (night ? CONFIG.NIGHT_COEF : 1);
  const eta = Math.round((dist / CONFIG.AVG_SPEED_KMPH) * 60 + CONFIG.BUFFER_MIN);

  return {
    distanceKm: round1(dist),
    price: roundMoney(price),
    etaMinutes: eta,
    isNight: night,
  };
}

/**
 * Возвращает котировку и сохраняет/обновляет её для заказа (идемпотентно).
 */
export async function quoteTowForOrder(
  orderId: number,
  from: LatLng,
  to: LatLng,
  now: Date = new Date()
) {
  const order = await prisma.order.findUnique({ where: { id: Number(orderId) }, select: { id: true } });
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });

  const q = calculateTowQuote(from, to, now);

  const tow = await prisma.towRequest.upsert({
    where: { orderId: Number(orderId) },
    update: {
      distanceKm: q.distanceKm,
      price: q.price,
      etaMinutes: q.etaMinutes,
      status: 'REQUESTED',
    },
    create: {
      orderId: Number(orderId),
      distanceKm: q.distanceKm,
      price: q.price,
      etaMinutes: q.etaMinutes,
      status: 'REQUESTED',
    },
  });

  // опционально эмитим событие в комнату заказа
  socketService?.emitTowUpdate(String(orderId), { kind: 'tow.quote', ...q });

  return { tow, quote: q };
}

/**
 * Сохранить котировку (если она уже посчитана где-то снаружи).
 */
export async function saveTowQuote(
  orderId: number,
  q: { distanceKm: number; price: number; etaMinutes: number }
) {
  const tow = await prisma.towRequest.upsert({
    where: { orderId: Number(orderId) },
    update: { distanceKm: q.distanceKm, price: q.price, etaMinutes: q.etaMinutes, status: 'REQUESTED' },
    create: { orderId: Number(orderId), distanceKm: q.distanceKm, price: q.price, etaMinutes: q.etaMinutes, status: 'REQUESTED' },
  });

  socketService?.emitTowUpdate(String(orderId), { kind: 'tow.quote', ...q });
  return tow;
}

/**
 * Назначить эвакуатор/партнёра.
 */
export async function assignTow(
  orderId: number,
  partnerId: number,
  options?: { driverName?: string; driverPhone?: string; vehicleInfo?: string }
) {
  const tow = await prisma.towRequest.update({
    where: { orderId: Number(orderId) },
    data: {
      partnerId: Number(partnerId),
      status: 'ASSIGNED',
      driverName: options?.driverName ?? undefined,
      driverPhone: options?.driverPhone ?? undefined,
      vehicleInfo: options?.vehicleInfo ?? undefined,
    },
  });

  // обновим статус заказа до SCHEDULED (по желанию)
  await prisma.order.update({
    where: { id: Number(orderId) },
    data: { status: 'SCHEDULED' as any },
  });

  socketService?.emitTowUpdate(String(orderId), { kind: 'tow.assigned', partnerId, ...options });
  return tow;
}

/**
 * Получить статус букера.
 */
export async function getTowStatus(orderId: number) {
  const tow = await prisma.towRequest.findUnique({
    where: { orderId: Number(orderId) },
    include: { order: { select: { id: true, status: true } } },
  });
  if (!tow) throw Object.assign(new Error('TOW_REQUEST_NOT_FOUND'), { status: 404 });

  return {
    id: tow.id,
    orderId: tow.orderId,
    status: tow.status as TowStatus,
    distanceKm: tow.distanceKm,
    etaMinutes: tow.etaMinutes,
    price: tow.price,
  // route field removed in schema
  route: null,
    createdAt: tow.createdAt,
    updatedAt: tow.updatedAt,
  };
}

/**
 * Обновить рабочий статус эвакуации (для диспетчера/водителя).
 * Можно передать текущую координату — уйдёт в metadata.
 */
export async function updateTowStatus(
  orderId: number,
  status: TowStatus,
  options?: { location?: LatLng; estimatedArrival?: string | Date }
) {
  const valid: TowStatus[] = [
    'ASSIGNED','ENROUTE','ARRIVED','LOADING','INTRANSIT','DELIVERED','COMPLETED','CANCELLED',
    'REQUESTED',
  ];
  if (!valid.includes(status)) {
    throw Object.assign(new Error('INVALID_STATUS'), { status: 400 });
  }

  const tow = await prisma.towRequest.findUnique({ where: { orderId: Number(orderId) } });
  if (!tow) throw Object.assign(new Error('TOW_REQUEST_NOT_FOUND'), { status: 404 });

  const updated = await prisma.towRequest.update({
    where: { orderId: Number(orderId) },
    data: {
      status,
    },
  });

  // маппинг на статус заказа, если нужно
  const map: Partial<Record<TowStatus, string>> = {
    ENROUTE: 'SCHEDULED',
    ARRIVED: 'INSERVICE',
    LOADING: 'INSERVICE',
    INTRANSIT: 'INSERVICE',
    DELIVERED: 'READY',
    COMPLETED: 'READY',
    CANCELLED: 'QUOTE',
  };
  const nextOrderStatus = map[status];
  if (nextOrderStatus) {
    await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: nextOrderStatus as any },
    });
  }

  socketService?.emitTowUpdate(String(orderId), {
    kind: 'tow.status',
    status,
    location: options?.location,
    estimatedArrival: options?.estimatedArrival,
  });

  return updated;
}

/**
 * Утилита: посчитать и сразу сохранить котировку (shortcut).
 */
export async function towQuote(orderId: number, from: LatLng, to: LatLng) {
  const { quote, tow } = await quoteTowForOrder(orderId, from, to);
  return { tow, ...quote };
}
