// services/triage.service.ts
import prisma from '@/utils/prisma.js';
import type { Order, Vehicle, Client } from '@prisma/client';
import { calculateDistance, formatCurrency } from '../../../../packages/shared/dist/utils/helpers.js';
import { logger } from '../libs/logger.js';

type TriageResult = {
  towQuote?: TowQuoteResult | null;
  insuranceOffers: InsuranceOfferDTO[];
  recommendations: string[];
};

type TowQuoteResult = {
  id: number;
  distance: number;          // km (1 decimal)
  price: number;             // UAH (rounded)
  priceFormatted: string;
  etaMinutes: number;
  etaFormatted: string;
  isNight: boolean;
  isEmergency: boolean;
  pickupAddress: string;
};

type InsuranceOfferDTO = {
  id: number;
  type: 'LIABILITY' | 'COMPREHENSIVE' | 'COLLISION' | 'FULL_COVERAGE';
  provider: string;
  premium: number;
  premiumFormatted: string;
  deductible: number;
  coverage: any;
  validUntil: Date;
  discount: number;      // %
  recommended: boolean;
};

const TRIAGE_RULES = {
  // Distance thresholds (km) — сейчас информационные
  TOW_DISTANCE_THRESHOLD: 50,
  EMERGENCY_DISTANCE_THRESHOLD: 100,

  // Base rates
  TOW_BASE_RATE: 200,                 // UAH
  TOW_PER_KM_RATE: 15,                // UAH per km
  TOW_NIGHT_MULTIPLIER: 1.5,          // 18:00-06:00
  TOW_EMERGENCY_MULTIPLIER: 2.0,

  // ETA
  AVERAGE_SPEED_CITY: 30,             // km/h
  AVERAGE_SPEED_HIGHWAY: 60,          // km/h
  ETA_BUFFER_MINUTES: 15,

  // Insurance base
  INSURANCE_BASE_RATES: {
    LIABILITY: 2000,                  // UAH/year
    COMPREHENSIVE: 8000,
    COLLISION: 5000,
    FULL_COVERAGE: 12000
  } as const,

  NIGHT_FROM: 18,
  NIGHT_TO: 6,
} as const;

function round1(n: number) { return Math.round(n * 10) / 10; }
function isNightHour(h: number) { return h >= TRIAGE_RULES.NIGHT_FROM || h <= TRIAGE_RULES.NIGHT_TO; }

export class TriageService {
  /**
   * Выполнить авто-триаж заказа:
   * - расчёт эвакуации (если релевантно)
   * - генерация страховых офферов
   * - рекомендации
   */
  async performTriage(orderId: string | number): Promise<TriageResult> {
    const id = Number(orderId);
    if (!Number.isFinite(id) || id <= 0) {
      throw Object.assign(new Error('INVALID_ORDER_ID'), { status: 400 });
    }

    const order = await prisma.order.findUnique({
      where: { id },
      include: { client: true, vehicle: true, locations: true }
    });

    if (!order) {
      const err: any = new Error('Order not found');
      err.status = 404;
      throw err;
    }

    const result: TriageResult = {
      towQuote: null,
      insuranceOffers: [],
      recommendations: []
    };

    // Tow
    if (this.shouldCalculateTow(order)) {
      result.towQuote = await this.calculateTowQuote(order);
    }

    // Insurance
    if (order.vehicle) {
      result.insuranceOffers = await this.generateInsuranceOffers(order);
    }

    // Recos
    result.recommendations = this.generateRecommendations(order, result);

    logger.info('triage:completed', {
      orderId: id,
      towRequired: !!result.towQuote,
      offerCount: result.insuranceOffers.length,
      recCount: result.recommendations.length
    });

    return result;
  }

  /**
   * Расчёт эвакуации + сохранение/обновление TowRequest (idempotent via upsert)
   */
  async calculateTowQuote(order: Order & { locations: any[] }): Promise<TowQuoteResult> {
    const pickup = order.locations.find((l: any) => l.type === 'PICKUP' || l.kind === 'pickup');
    if (!pickup) {
      throw Object.assign(new Error('Pickup location required for tow quote'), { status: 400 });
    }

    // Пока берём псевдо-центр обслуживания рядом (демо). В проде — поиск ближайшего сервиса.
    const destination = {
      latitude: Number(pickup.latitude) + 0.1,
      longitude: Number(pickup.longitude) + 0.05
    };

    const distance = calculateDistance(
      Number(pickup.latitude),
      Number(pickup.longitude),
      Number(destination.latitude),
      Number(destination.longitude)
    );

    // Цена
    let price = TRIAGE_RULES.TOW_BASE_RATE + (distance * TRIAGE_RULES.TOW_PER_KM_RATE);

    // Мультипликаторы
    const currentHour = new Date().getHours();
    const isNight = isNightHour(currentHour);
    const isEmergency = (order as any).type === 'EMERGENCY';

    if (isNight) price *= TRIAGE_RULES.TOW_NIGHT_MULTIPLIER;
    if (isEmergency) price *= TRIAGE_RULES.TOW_EMERGENCY_MULTIPLIER;

    // ETA
    const avgSpeed = distance > 50 ? TRIAGE_RULES.AVERAGE_SPEED_HIGHWAY : TRIAGE_RULES.AVERAGE_SPEED_CITY;
    const etaMinutes = Math.round((distance / avgSpeed) * 60) + TRIAGE_RULES.ETA_BUFFER_MINUTES;

    // Сохраняем котировку
    const towRequest = await prisma.towRequest.upsert({
      where: { orderId: Number(order.id) },
      update: {
        distanceKm: distance,
        etaMinutes,
        price: Math.round(price),
        status: 'REQUESTED'
      },
      create: {
        orderId: Number(order.id),
        distanceKm: distance,
        etaMinutes,
        price: Math.round(price),
        status: 'REQUESTED'
      }
    });

    return {
      id: towRequest.id,
      distance: round1(distance),
      price: Math.round(price),
      priceFormatted: formatCurrency(price, 'UAH'),
      etaMinutes,
      etaFormatted: this.formatETA(etaMinutes),
      isNight,
      isEmergency,
      pickupAddress: pickup.address || `${pickup.latitude}, ${pickup.longitude}`
    };
  }

  /**
   * Генерация страховых офферов по правилам (пропускаем уже активные типы)
   */
  async generateInsuranceOffers(order: Order & { vehicle: Vehicle; client: Client }): Promise<InsuranceOfferDTO[]> {
    const { vehicle, client } = order;
    const currentYear = new Date().getFullYear();
    const vehicleAge = vehicle?.year ? currentYear - Number(vehicle.year) : 0;

    // Активные полисы, чтобы не дублировать тип
    const existing = await prisma.insurancePolicy.findMany({
      where: { vehicleId: vehicle.id, status: 'ACTIVE' }
    });
    const activeTypes = new Set(existing.map(p => p.type));

    const baseRates = TRIAGE_RULES.INSURANCE_BASE_RATES;
    const offers: InsuranceOfferDTO[] = [];

    // Возрастной множитель
    let ageMultiplier = 1.0;
    if (vehicleAge > 10) ageMultiplier = 1.3;
    else if (vehicleAge > 5) ageMultiplier = 1.15;

    // «Бонус» клиента (заглушка)
    const clientBonus = (client as any).achievementPoints > 1000 ? 0.9 : 1.0;

    const policyTypes = ['LIABILITY', 'COMPREHENSIVE', 'COLLISION', 'FULL_COVERAGE'] as const;

    for (const policyType of policyTypes) {
      if (activeTypes.has(policyType)) continue;

      const basePrice = baseRates[policyType];
      const finalPrice = Math.round(basePrice * ageMultiplier * clientBonus);

      const offer = await prisma.insuranceOffer.create({
        data: {
          orderId: order.id,
          clientId: client.id,
          vehicleId: vehicle.id,
          type: policyType,
          provider: 'AutoAssist Insurance',
          premium: finalPrice,
          deductible: Math.round(finalPrice * 0.1),
          coverage: this.getDefaultCoverage(policyType),
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          status: 'OFFERED'
        }
      });

      offers.push({
        id: offer.id,
        type: policyType,
        provider: offer.provider,
        premium: finalPrice,
        premiumFormatted: formatCurrency(finalPrice, 'UAH'),
        deductible: offer.deductible,
        coverage: offer.coverage,
        validUntil: offer.validUntil,
        discount: Math.round((1 - (ageMultiplier * clientBonus)) * 100),
        recommended: policyType === 'COMPREHENSIVE' && vehicleAge <= 5
      });
    }

    return offers;
  }

  /**
   * Рекомендации по результатам триажа
   */
  private generateRecommendations(order: any, results: { towQuote?: TowQuoteResult | null; insuranceOffers: InsuranceOfferDTO[] }): string[] {
    const recs: string[] = [];

    if (results.towQuote) {
      if (results.towQuote.price > 1000) {
        recs.push('Рекомендуем КАСКО/расширенную страховку для покрытия стоимости эвакуации');
      }
      if (results.towQuote.etaMinutes > 60) {
        recs.push('Длительное ожидание — предложите мобильный выездной сервис, если доступен');
      }
    }

    if (results.insuranceOffers.length > 0) {
      const hasLiability = results.insuranceOffers.some(o => o.type === 'LIABILITY');
      if (!hasLiability) {
        recs.push('ОСЦПВ (Liability) обязателен по закону');
      }
    }

    if (order.type === 'EMERGENCY') {
      recs.push('Аварийный случай — активировано приоритетное направление эвакуатора');
    }

    return recs;
  }

  private shouldCalculateTow(order: any): boolean {
    const towTypes = ['EMERGENCY', 'REPAIR', 'INSPECTION'];
    return towTypes.includes(order.type);
  }

  private formatETA(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  private getDefaultCoverage(type: 'LIABILITY' | 'COMPREHENSIVE' | 'COLLISION' | 'FULL_COVERAGE') {
    const coverages = {
      LIABILITY: {
        liability: 500_000,
        personalInjury: 100_000,
        propertyDamage: 50_000,
      },
      COMPREHENSIVE: {
        liability: 1_000_000,
        collision: 200_000,
        comprehensive: 150_000,
        personalInjury: 200_000,
        uninsuredMotorist: 100_000,
      },
      COLLISION: {
        liability: 500_000,
        collision: 200_000,
        personalInjury: 100_000,
      },
      FULL_COVERAGE: {
        liability: 2_000_000,
        collision: 500_000,
        comprehensive: 400_000,
        personalInjury: 300_000,
        uninsuredMotorist: 200_000,
      },
    } as const;

    return coverages[type];
  }
}

export default TriageService;
