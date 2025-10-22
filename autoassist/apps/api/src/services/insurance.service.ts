// services/insurance.service.ts
import type { Request, Response } from 'express';
import prisma from '@/utils/prisma.js';
import { formatCurrency } from '../../../../packages/shared/dist/utils/helpers.js';
import { logger } from '../libs/logger.js';

// ---- business rules & constants ----
const DAY_MS = 86_400_000;

const INSURANCE_RULES = {
  BASE_RATES: {
    LIABILITY: 2000,       // UAH/year
    COMPREHENSIVE: 8000,
    COLLISION: 5000,
    FULL_COVERAGE: 12000,
  },
  AGE_MULTIPLIERS: {
    NEW: 1.0,       // 0–2 years
    RECENT: 1.1,    // 3–5
    MATURE: 1.25,   // 6–10
    OLD: 1.5,       // 11–15
    VINTAGE: 2.0,   // 15+
  },
  CLIENT_DISCOUNTS: {
    LOYAL_BRONZE: 0.95,   // 500+ points
    LOYAL_SILVER: 0.90,   // 1000+ points
    LOYAL_GOLD: 0.85,     // 2000+ points
    SAFE_DRIVER: 0.88,    // (placeholder)
    MULTI_VEHICLE: 0.92,  // (placeholder)
  },
  COVERAGE_LIMITS: {
    LIABILITY: {
      liability: 500_000,
      personalInjury: 100_000,
      propertyDamage: 50_000,
      uninsuredMotorist: 0,
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
      comprehensive: 0,
      personalInjury: 100_000,
      uninsuredMotorist: 50_000,
    },
    FULL_COVERAGE: {
      liability: 2_000_000,
      collision: 500_000,
      comprehensive: 400_000,
      personalInjury: 300_000,
      uninsuredMotorist: 200_000,
    },
  },
} as const;

// ---- service ----
export class InsuranceService {
  /**
   * POST /api/insurance/offers
   * Generate insurance offers for an order (idempotent per policy type).
   */
  async generateOffers(req: Request, res: Response): Promise<void> {
    const { orderId } = req.body ?? {};

    try {
      if (!orderId || !Number.isFinite(Number(orderId))) {
        res.status(400).json({ error: 'MISSING_ORDER_ID', message: 'Order ID is required' });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: Number(orderId) },
        include: { client: true },
      });

      if (!order) {
        res.status(404).json({ error: 'ORDER_NOT_FOUND', message: 'Order not found' });
        return;
      }

      // get vehicle & active policies
      const vehicle = await prisma.vehicle.findUnique({ where: { id: order.vehicleId } });
      const activePolicies = vehicle
        ? await prisma.insurancePolicy.findMany({
            where: { vehicleId: vehicle.id, status: 'ACTIVE' },
            select: { type: true },
          })
        : [];

      if (!vehicle) {
        res.status(400).json({ error: 'NO_VEHICLE', message: 'Vehicle information required for insurance offers' });
        return;
      }

      const offers = await this.calculateInsuranceOffers({
        orderId: order.id,
        client: order.client,
        vehicle,
        activePolicyTypes: new Set(activePolicies.map((p) => String(p.type))),
      });

      logger.info('Insurance offers generated', {
        orderId: order.id,
        vehicleId: vehicle.id,
        offerCount: offers.length,
      });

      res.json({
        success: true,
        data: offers,
        message: `Generated ${offers.length} insurance offers`,
      });
    } catch (error) {
      logger.error('Failed to generate insurance offers', {
        orderId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to generate insurance offers' });
    }
  }

  /**
   * POST /api/insurance/offers/:offerId/accept
   * Accept an insurance offer → create policy (atomic).
   */
  async acceptOffer(req: Request, res: Response): Promise<void> {
    const { offerId } = req.params ?? {};

    try {
      if (!offerId || !Number.isFinite(Number(offerId))) {
        res.status(400).json({ error: 'MISSING_OFFER_ID', message: 'Offer ID is required' });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const offer = await tx.insuranceOffer.findUnique({
          where: { id: Number(offerId) },
        });

        if (!offer) {
          return { code: 'OFFER_NOT_FOUND' as const };
        }
        if (offer.status !== 'OFFERED') {
          return { code: 'OFFER_NOT_AVAILABLE' as const };
        }
        if (offer.validUntil && new Date() > offer.validUntil) {
          return { code: 'OFFER_EXPIRED' as const };
        }

        // Create policy
        const policy = await this.createInsurancePolicyTx(tx, offer);

        // Update offer
        await tx.insuranceOffer.update({
          where: { id: Number(offerId) },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });

        return { code: 'OK' as const, policy };
      });

      if (result.code !== 'OK') {
        const map = {
          OFFER_NOT_FOUND: { status: 404, message: 'Insurance offer not found' },
          OFFER_NOT_AVAILABLE: { status: 400, message: 'Offer is no longer available' },
          OFFER_EXPIRED: { status: 400, message: 'Offer has expired' },
        } as const;
        const m = map[result.code];
        res.status(m.status).json({ error: result.code, message: m.message });
        return;
      }

      logger.info('Insurance offer accepted', {
        offerId,
        policyId: result.policy.id,
        clientId: result.policy.clientId,
        vehicleId: result.policy.vehicleId,
      });

      res.json({
        success: true,
        data: {
          policy: {
            id: result.policy.id,
            policyNumber: result.policy.policyNumber,
            type: result.policy.type,
            provider: result.policy.provider,
            premium: result.policy.premium,
            startDate: result.policy.startDate,
            endDate: result.policy.endDate,
            status: result.policy.status,
          },
        },
        message: 'Insurance policy created successfully',
      });
    } catch (error) {
      logger.error('Failed to accept insurance offer', {
        offerId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to accept insurance offer' });
    }
  }

  /**
   * GET /api/insurance/clients/:clientId/policies
   */
  async getClientPolicies(req: Request, res: Response): Promise<void> {
    const { clientId } = req.params ?? {};

    try {
      if (!clientId || !Number.isFinite(Number(clientId))) {
        res.status(400).json({ error: 'MISSING_CLIENT_ID', message: 'Client ID is required' });
        return;
      }

      const policies = await prisma.insurancePolicy.findMany({
        where: { clientId: Number(clientId) },
        include: {
          vehicle: {
            select: { make: true, model: true, year: true, licensePlate: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const data = policies.map((policy) => ({
        id: policy.id,
        policyNumber: policy.policyNumber,
        type: policy.type,
        provider: policy.provider,
        status: policy.status,
        premium: policy.premium,
        premiumFormatted: formatCurrency(policy.premium, 'UAH'),
        deductible: policy.deductible,
        startDate: policy.startDate,
        endDate: policy.endDate,
        coverage: policy.coverage,
        vehicle: policy.vehicle,
        daysUntilExpiry: Math.ceil((policy.endDate.getTime() - Date.now()) / DAY_MS),
      }));

      res.json({ success: true, data });
    } catch (error) {
      logger.error('Failed to get client policies', {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to get insurance policies' });
    }
  }

  // ---- internal calc & helpers ----

  private async calculateInsuranceOffers(args: {
    orderId: number;
    client: any;
    vehicle: any;
    activePolicyTypes: Set<string>;
  }) {
    const { orderId, client, vehicle, activePolicyTypes } = args;
    const currentYear = new Date().getFullYear();
    const vehicleAge = Math.max(0, currentYear - Number(vehicle.year ?? currentYear));

    const ageMultiplier = this.getAgeMultiplier(vehicleAge);
    const clientDiscount = this.getClientDiscount(client, vehicle);
    const baseRates = INSURANCE_RULES.BASE_RATES;

    // For idempotency: don’t create duplicate offers for same order + policyType
    const existingOffers = await prisma.insuranceOffer.findMany({
      where: { orderId },
      select: { type: true },
    });
    const alreadyOffered = new Set(existingOffers.map((o) => String(o.type)));

    const offersOut: any[] = [];

    // make candidates for each policy type
    for (const [policyType, baseRate] of Object.entries(baseRates) as Array<[keyof typeof baseRates, number]>) {
      if (activePolicyTypes.has(policyType)) continue;       // active policy exists
      if (alreadyOffered.has(policyType)) continue;          // offer already exists for this order

      const premium = Math.round(baseRate * ageMultiplier * clientDiscount);
      const deductible = Math.round(premium * 0.1);
      const coverage = INSURANCE_RULES.COVERAGE_LIMITS[policyType];

      const offer = await prisma.insuranceOffer.create({
        data: {
          orderId,
          clientId: client.id,
          vehicleId: vehicle.id,
          type: policyType,
          provider: 'AutoAssist Insurance',
          premium,
          deductible,
          coverage,
          validUntil: new Date(Date.now() + 7 * DAY_MS),
          status: 'OFFERED',
        },
      });

      offersOut.push({
        id: offer.id,
        type: policyType,
        provider: offer.provider,
        premium,
        premiumFormatted: formatCurrency(premium, 'UAH'),
        deductible,
        deductibleFormatted: formatCurrency(deductible, 'UAH'),
        coverage,
        validUntil: offer.validUntil,
        discountApplied: Math.max(0, Math.round((1 - ageMultiplier * clientDiscount) * 100)),
        recommended: this.isRecommended(policyType, vehicleAge, activePolicyTypes),
        benefits: this.getPolicyBenefits(policyType),
        terms: this.getPolicyTerms(policyType),
      });
    }

    // sort: recommended first, then cheaper
    offersOut.sort((a, b) => (a.recommended === b.recommended ? a.premium - b.premium : a.recommended ? -1 : 1));
    return offersOut;
  }

  private getAgeMultiplier(vehicleAge: number): number {
    if (vehicleAge <= 2) return INSURANCE_RULES.AGE_MULTIPLIERS.NEW;
    if (vehicleAge <= 5) return INSURANCE_RULES.AGE_MULTIPLIERS.RECENT;
    if (vehicleAge <= 10) return INSURANCE_RULES.AGE_MULTIPLIERS.MATURE;
    if (vehicleAge <= 15) return INSURANCE_RULES.AGE_MULTIPLIERS.OLD;
    return INSURANCE_RULES.AGE_MULTIPLIERS.VINTAGE;
  }

  private getClientDiscount(client: any, _vehicle: any): number {
    let d = 1.0;
    if (Number(client?.achievementPoints ?? 0) >= 2000) d *= INSURANCE_RULES.CLIENT_DISCOUNTS.LOYAL_GOLD;
    else if (Number(client?.achievementPoints ?? 0) >= 1000) d *= INSURANCE_RULES.CLIENT_DISCOUNTS.LOYAL_SILVER;
    else if (Number(client?.achievementPoints ?? 0) >= 500) d *= INSURANCE_RULES.CLIENT_DISCOUNTS.LOYAL_BRONZE;

    // TODO: add SAFE_DRIVER / MULTI_VEHICLE adjustments once available
    return d;
  }

  private isRecommended(policyType: string, vehicleAge: number, active: Set<string>): boolean {
    if (policyType === 'LIABILITY' && !active.has('LIABILITY')) return true;
    if (policyType === 'COMPREHENSIVE' && vehicleAge <= 5) return true;
    if (policyType === 'FULL_COVERAGE' && vehicleAge <= 3) return true;
    return false;
  }

  private getPolicyBenefits(policyType: string): string[] {
    const benefits = {
      LIABILITY: [
        'Covers damage to other vehicles and property',
        'Personal injury protection',
        'Legal defense coverage',
        'Required by law',
      ],
      COMPREHENSIVE: [
        'Theft and vandalism protection',
        'Weather damage coverage',
        'Glass breakage protection',
        'Roadside assistance included',
      ],
      COLLISION: [
        'Covers damage from accidents',
        'No-fault coverage',
        'Rental car assistance',
        'Towing services',
      ],
      FULL_COVERAGE: [
        'Complete protection package',
        'Highest coverage limits',
        'Premium roadside assistance',
        'Accident forgiveness program',
        'New car replacement',
      ],
    } as const;
    return benefits[policyType as keyof typeof benefits] ?? [];
  }

  private getPolicyTerms(_policyType: string): string[] {
    return [
      'Policy valid for 12 months',
      'Monthly payment options available',
      '30-day money-back guarantee',
      'Claims can be filed 24/7',
      'Coverage effective immediately upon payment',
    ];
  }

  private generatePolicyNumber(): string {
    const prefix = 'AA';
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const rnd = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
    return `${prefix}${year}${month}${rnd}`;
  }

  private async createInsurancePolicyTx(
    tx: typeof prisma,
    offer: { clientId: number; vehicleId: number; provider: string; type: string; premium: number; deductible: number; coverage: any }
  ) {
    const policyNumber = this.generatePolicyNumber();
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 365 * DAY_MS);

    return tx.insurancePolicy.create({
      data: {
        clientId: offer.clientId,
        vehicleId: offer.vehicleId,
        policyNumber,
        provider: offer.provider,
        type: offer.type as any,
        status: 'ACTIVE',
        startDate,
        endDate,
        premium: offer.premium,
        deductible: offer.deductible,
        coverage: offer.coverage,
      },
    });
  }
}

export default InsuranceService;
