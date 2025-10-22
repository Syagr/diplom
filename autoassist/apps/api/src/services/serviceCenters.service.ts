// src/services/serviceCenters.service.ts
import prisma from '../utils/prisma.js';

export type NearbyParams = {
  lat: number;
  lng: number;
  limit?: number;
  maxKm?: number;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function findNearbyServiceCenters({ lat, lng, limit = 10, maxKm }: NearbyParams) {
  // naive: fetch centers and compute distance in app; for large data, move to raw SQL with earthdistance
  const centers = await prisma.serviceCenter.findMany({
    select: {
      id: true,
      name: true,
      lat: true,
      lng: true,
      address: true,
      city: true,
      rating: true,
    },
  });

  const enriched = centers
    .map((c) => ({
      ...c,
      distanceKm: haversineKm(lat, lng, c.lat, c.lng),
      partnerDiscountPct: 10, // optional marketing display
      platformFeePct: 5, // optional platform fee
    }))
    .filter((c) => (typeof maxKm === 'number' ? c.distanceKm <= maxKm : true))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Math.max(1, Math.min(limit, 50)));

  return enriched;
}
