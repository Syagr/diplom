import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { calculateDistance, formatCurrency } from '@autoassist/shared';
import { logger } from '../libs/logger';

const prisma = new PrismaClient();

// Business rules for triage
const TRIAGE_RULES = {
  // Distance thresholds (km)
  TOW_DISTANCE_THRESHOLD: 50,
  EMERGENCY_DISTANCE_THRESHOLD: 100,
  
  // Base rates
  TOW_BASE_RATE: 200, // UAH
  TOW_PER_KM_RATE: 15, // UAH per km
  TOW_NIGHT_MULTIPLIER: 1.5, // 18:00-06:00
  TOW_EMERGENCY_MULTIPLIER: 2.0,
  
  // ETA calculation
  AVERAGE_SPEED_CITY: 30, // km/h
  AVERAGE_SPEED_HIGHWAY: 60, // km/h
  ETA_BUFFER_MINUTES: 15,
  
  // Insurance offer rules
  INSURANCE_BASE_RATES: {
    LIABILITY: 2000, // UAH/year
    COMPREHENSIVE: 8000,
    COLLISION: 5000,
    FULL_COVERAGE: 12000
  }
};

export class TriageService {
  /**
   * Perform automatic triage when order is created
   * Calculates tow requirements, generates insurance offers
   */
  async performTriage(orderId: string): Promise<{
    towQuote?: any;
    insuranceOffers: any[];
    recommendations: string[];
  }> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          client: true,
          vehicle: true,
          locations: true
        }
      });

      if (!order) {
        throw new Error('Order not found');
      }

      const results = {
        towQuote: null as any,
        insuranceOffers: [] as any[],
        recommendations: [] as string[]
      };

      // Check if tow is needed based on order type and location
      if (this.shouldCalculateTow(order)) {
        results.towQuote = await this.calculateTowQuote(order);
      }

      // Generate insurance offers if vehicle is eligible
      if (order.vehicle) {
        results.insuranceOffers = await this.generateInsuranceOffers(order);
      }

      // Add recommendations
      results.recommendations = this.generateRecommendations(order, results);

      // Log triage results
      logger.info('Triage completed', {
        orderId,
        towRequired: !!results.towQuote,
        insuranceOffers: results.insuranceOffers.length,
        recommendations: results.recommendations.length
      });

      return results;

    } catch (error) {
      logger.error('Triage failed', { orderId, error: error.message });
      throw error;
    }
  }

  /**
   * Calculate tow quote based on distance, time, and urgency
   */
  async calculateTowQuote(order: any): Promise<any> {
    const pickup = order.locations.find((l: any) => l.type === 'PICKUP');
    if (!pickup) {
      throw new Error('Pickup location required for tow quote');
    }

    // For demo, use a fixed destination (service center)
    // In production, select nearest available service center
    const destination = {
      latitude: pickup.latitude + 0.1, // ~10km offset
      longitude: pickup.longitude + 0.05
    };

    const distance = calculateDistance(
      pickup.latitude,
      pickup.longitude,
      destination.latitude,
      destination.longitude
    );

    // Calculate price
    let price = TRIAGE_RULES.TOW_BASE_RATE + (distance * TRIAGE_RULES.TOW_PER_KM_RATE);

    // Apply multipliers
    const currentHour = new Date().getHours();
    const isNight = currentHour >= 18 || currentHour <= 6;
    const isEmergency = order.type === 'EMERGENCY';

    if (isNight) {
      price *= TRIAGE_RULES.TOW_NIGHT_MULTIPLIER;
    }

    if (isEmergency) {
      price *= TRIAGE_RULES.TOW_EMERGENCY_MULTIPLIER;
    }

    // Calculate ETA
    const avgSpeed = distance > 50 ? TRIAGE_RULES.AVERAGE_SPEED_HIGHWAY : TRIAGE_RULES.AVERAGE_SPEED_CITY;
    const etaMinutes = Math.round((distance / avgSpeed) * 60) + TRIAGE_RULES.ETA_BUFFER_MINUTES;

    // Create or update TowRequest
    const towRequest = await prisma.towRequest.upsert({
      where: { orderId: order.id },
      update: {
        distanceKm: distance,
        etaMinutes,
        price: Math.round(price),
        status: 'QUOTED'
      },
      create: {
        orderId: order.id,
        distanceKm: distance,
        etaMinutes,
        price: Math.round(price),
        status: 'QUOTED'
      }
    });

    return {
      id: towRequest.id,
      distance: Math.round(distance * 10) / 10, // Round to 1 decimal
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
   * Generate rule-based insurance offers
   */
  async generateInsuranceOffers(order: any): Promise<any[]> {
    const { vehicle, client } = order;
    const currentYear = new Date().getFullYear();
    const vehicleAge = currentYear - vehicle.year;

    // Check existing active policies
    const existingPolicies = await prisma.insurancePolicy.findMany({
      where: {
        vehicleId: vehicle.id,
        status: 'ACTIVE'
      }
    });

    const offers = [];
    const baseRates = TRIAGE_RULES.INSURANCE_BASE_RATES;

    // Age-based pricing multiplier
    let ageMultiplier = 1.0;
    if (vehicleAge > 10) ageMultiplier = 1.3;
    else if (vehicleAge > 5) ageMultiplier = 1.15;

    // Client history bonus (mock)
    const clientBonus = client.achievementPoints > 1000 ? 0.9 : 1.0;

    // Generate offers for policies not currently active
    const policyTypes = ['LIABILITY', 'COMPREHENSIVE', 'COLLISION', 'FULL_COVERAGE'];
    
    for (const policyType of policyTypes) {
      const hasActive = existingPolicies.some(p => p.type === policyType);
      if (hasActive) continue;

      const basePrice = baseRates[policyType as keyof typeof baseRates];
      const finalPrice = Math.round(basePrice * ageMultiplier * clientBonus);

      const offer = await prisma.insuranceOffer.create({
        data: {
          orderId: order.id,
          clientId: client.id,
          vehicleId: vehicle.id,
          type: policyType,
          provider: 'AutoAssist Insurance',
          premium: finalPrice,
          deductible: Math.round(finalPrice * 0.1), // 10% deductible
          coverage: this.getDefaultCoverage(policyType),
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
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
   * Generate actionable recommendations
   */
  private generateRecommendations(order: any, results: any): string[] {
    const recommendations = [];

    if (results.towQuote) {
      if (results.towQuote.price > 1000) {
        recommendations.push('Consider comprehensive insurance to cover towing costs');
      }
      if (results.towQuote.etaMinutes > 60) {
        recommendations.push('Long wait time - recommend mobile service if available');
      }
    }

    if (results.insuranceOffers.length > 0) {
      const hasLiability = results.insuranceOffers.some((o: any) => o.type === 'LIABILITY');
      if (!hasLiability) {
        recommendations.push('Liability insurance is required by law');
      }
    }

    if (order.type === 'EMERGENCY') {
      recommendations.push('Emergency service - priority dispatch activated');
    }

    return recommendations;
  }

  /**
   * Check if tow calculation is needed
   */
  private shouldCalculateTow(order: any): boolean {
    const towTypes = ['EMERGENCY', 'REPAIR', 'INSPECTION'];
    return towTypes.includes(order.type);
  }

  /**
   * Format ETA for display
   */
  private formatETA(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  /**
   * Get default coverage for insurance type
   */
  private getDefaultCoverage(type: string): any {
    const coverages = {
      LIABILITY: {
        liability: 500000,
        personalInjury: 100000,
        propertyDamage: 50000
      },
      COMPREHENSIVE: {
        liability: 1000000,
        collision: 200000,
        comprehensive: 150000,
        personalInjury: 200000,
        uninsuredMotorist: 100000
      },
      COLLISION: {
        liability: 500000,
        collision: 200000,
        personalInjury: 100000
      },
      FULL_COVERAGE: {
        liability: 2000000,
        collision: 500000,
        comprehensive: 400000,
        personalInjury: 300000,
        uninsuredMotorist: 200000
      }
    };

    return coverages[type as keyof typeof coverages] || {};
  }
}