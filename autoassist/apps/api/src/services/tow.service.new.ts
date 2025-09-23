import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const BASE_FEE = 800;          // UAH
const KM_RATE = 25;            // UAH/km
const NIGHT_COEF = 1.25;       // 22:00-06:00
const AVG_SPEED_KMPH = 35;
const BUFFER_MIN = 15;

function haversineKm(a:{lat:number;lng:number}, b:{lat:number;lng:number}) {
  const toRad = (v:number)=>v*Math.PI/180;
  const R=6371; const dLat=toRad(b.lat-a.lat); const dLon=toRad(b.lng-a.lng);
  const la1=toRad(a.lat), la2=toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

export async function towQuote(orderId: number, from: {lat:number;lng:number}, to: {lat:number;lng:number}) {
  const dist = haversineKm(from, to);
  const now = new Date(); const h = now.getHours();
  const night = (h >= 22 || h <= 6);
  const price = Math.max(BASE_FEE + KM_RATE * dist, BASE_FEE) * (night ? NIGHT_COEF : 1);
  const eta = Math.round((dist / AVG_SPEED_KMPH) * 60 + BUFFER_MIN);
  return { distanceKm: Number(dist.toFixed(1)), price: Number(price.toFixed(0)), etaMinutes: eta };
}

export async function saveTowQuote(orderId: number, q: {distanceKm:number; price:number; etaMinutes:number}) {
  return prisma.towRequest.upsert({
    where: { orderId },
    update: { distanceKm: q.distanceKm, price: q.price, etaMinutes: q.etaMinutes, status: 'REQUESTED' },
    create: { orderId, distanceKm: q.distanceKm, price: q.price, etaMinutes: q.etaMinutes, status: 'REQUESTED' }
  });
}

export async function assignTow(orderId: number, partnerId: number) {
  return prisma.towRequest.update({ where: { orderId }, data: { partnerId, status: 'ASSIGNED' } });
}