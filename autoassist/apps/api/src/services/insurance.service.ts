import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { formatCurrency } from '@autoassist/shared';
import { logger } from '../libs/logger';

const prisma = new PrismaClient();

// Insurance business rules and rates
const INSURANCE_RULES = {
  BASE_RATES: {
    LIABILITY: 2000, // UAH/year
    COMPREHENSIVE: 8000,
    COLLISION: 5000,
    FULL_COVERAGE: 12000
  },
  
  // Risk multipliers
  AGE_MULTIPLIERS: {
    NEW: 1.0,        // 0-2 years
    RECENT: 1.1,     // 3-5 years
    MATURE: 1.25,    // 6-10 years
    OLD: 1.5,        // 11-15 years
    VINTAGE: 2.0     // 15+ years
  },
  
  CLIENT_DISCOUNTS: {
    LOYAL_BRONZE: 0.95,  // 500+ points
    LOYAL_SILVER: 0.90,  // 1000+ points
    LOYAL_GOLD: 0.85,    // 2000+ points
    SAFE_DRIVER: 0.88,   // No claims last 2 years
    MULTI_VEHICLE: 0.92  // Multiple vehicles insured
  },
  
  // Default coverage limits
  COVERAGE_LIMITS: {
    LIABILITY: {
      liability: 500000,
      personalInjury: 100000,
      propertyDamage: 50000,
      uninsuredMotorist: 0
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
      comprehensive: 0,
      personalInjury: 100000,
      uninsuredMotorist: 50000
    },
    FULL_COVERAGE: {
      liability: 2000000,
      collision: 500000,
      comprehensive: 400000,
      personalInjury: 300000,
      uninsuredMotorist: 200000
    }
  }
};

export class InsuranceService {
  /**
   * Generate insurance offers for an order
   */
  async generateOffers(req: Request, res: Response): Promise<void> {
    const { orderId } = req.body;

    try {
      if (!orderId) {
        res.status(400).json({
          error: 'MISSING_ORDER_ID',
          message: 'Order ID is required'
        });
        return;
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          client: true,
          vehicle: {
            include: {
              insurancePolicies: {
                where: {
                  status: 'ACTIVE'
                }
              }
            }
          }
        }
      });

      if (!order) {
        res.status(404).json({
          error: 'ORDER_NOT_FOUND',
          message: 'Order not found'
        });
        return;
      }

      if (!order.vehicle) {
        res.status(400).json({
          error: 'NO_VEHICLE',
          message: 'Vehicle information required for insurance offers'
        });
        return;
      }

      const offers = await this.calculateInsuranceOffers(order);
      
      logger.info('Insurance offers generated', {
        orderId,
        vehicleId: order.vehicle.id,
        offerCount: offers.length
      });

      res.json({
        success: true,
        data: offers,
        message: `Generated ${offers.length} insurance offers`
      });

    } catch (error) {
      logger.error('Failed to generate insurance offers', {
        orderId: req.body.orderId,
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to generate insurance offers'
      });
    }
  }

  /**
   * Accept an insurance offer
   */
  async acceptOffer(req: Request, res: Response): Promise<void> {
    const { offerId } = req.params;

    try {
      const offer = await prisma.insuranceOffer.findUnique({
        where: { id: offerId },
        include: {
          order: true,
          client: true,
          vehicle: true
        }
      });

      if (!offer) {
        res.status(404).json({
          error: 'OFFER_NOT_FOUND',
          message: 'Insurance offer not found'
        });
        return;
      }

      if (offer.status !== 'OFFERED') {
        res.status(400).json({
          error: 'OFFER_NOT_AVAILABLE',
          message: 'Offer is no longer available'
        });
        return;
      }

      if (new Date() > offer.validUntil) {
        res.status(400).json({
          error: 'OFFER_EXPIRED',
          message: 'Offer has expired'
        });
        return;
      }

      // Create insurance policy
      const policy = await this.createInsurancePolicy(offer);

      // Update offer status
      await prisma.insuranceOffer.update({
        where: { id: offerId },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date()
        }
      });

      logger.info('Insurance offer accepted', {
        offerId,
        policyId: policy.id,
        clientId: offer.clientId,
        vehicleId: offer.vehicleId
      });

      res.json({
        success: true,
        data: {
          policy: {
            id: policy.id,
            policyNumber: policy.policyNumber,
            type: policy.type,
            provider: policy.provider,
            premium: policy.premium,
            startDate: policy.startDate,
            endDate: policy.endDate,
            status: policy.status
          }
        },
        message: 'Insurance policy created successfully'
      });

    } catch (error) {
      logger.error('Failed to accept insurance offer', {
        offerId,
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to accept insurance offer'
      });
    }
  }

  /**
   * Get client's insurance policies
   */
  async getClientPolicies(req: Request, res: Response): Promise<void> {
    const { clientId } = req.params;

    try {
      const policies = await prisma.insurancePolicy.findMany({
        where: { clientId },
        include: {
          vehicle: {
            select: {
              make: true,
              model: true,
              year: true,
              licensePlate: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      const formattedPolicies = policies.map(policy => ({
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
        daysUntilExpiry: Math.ceil((policy.endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      }));

      res.json({
        success: true,
        data: formattedPolicies
      });

    } catch (error) {
      logger.error('Failed to get client policies', {
        clientId,
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to get insurance policies'
      });
    }
  }

  /**
   * Calculate insurance offers based on business rules
   */
  private async calculateInsuranceOffers(order: any): Promise<any[]> {
    const { client, vehicle } = order;
    const currentYear = new Date().getFullYear();
    const vehicleAge = currentYear - vehicle.year;
    
    // Get existing active policies to avoid duplicates
    const activePolicies = vehicle.insurancePolicies || [];
    const activePolicyTypes = new Set(activePolicies.map((p: any) => p.type));

    const offers = [];
    const baseRates = INSURANCE_RULES.BASE_RATES;

    // Calculate multipliers
    const ageMultiplier = this.getAgeMultiplier(vehicleAge);
    const clientDiscount = this.getClientDiscount(client, vehicle);

    // Generate offers for each policy type not currently active
    for (const [policyType, baseRate] of Object.entries(baseRates)) {
      if (activePolicyTypes.has(policyType)) {
        continue; // Skip if already has active policy of this type
      }

      const premium = Math.round(baseRate * ageMultiplier * clientDiscount);
      const deductible = Math.round(premium * 0.1); // 10% of premium
      const coverage = INSURANCE_RULES.COVERAGE_LIMITS[policyType as keyof typeof INSURANCE_RULES.COVERAGE_LIMITS];

      // Create offer record
      const offer = await prisma.insuranceOffer.create({
        data: {
          orderId: order.id,
          clientId: client.id,
          vehicleId: vehicle.id,
          type: policyType,
          provider: 'AutoAssist Insurance',
          premium,
          deductible,
          coverage,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days validity
          status: 'OFFERED'
        }
      });

      offers.push({
        id: offer.id,
        type: policyType,
        provider: offer.provider,
        premium,
        premiumFormatted: formatCurrency(premium, 'UAH'),
        deductible,
        deductibleFormatted: formatCurrency(deductible, 'UAH'),
        coverage,
        validUntil: offer.validUntil,
        discountApplied: Math.round((1 - (ageMultiplier * clientDiscount)) * 100),
        recommended: this.isRecommended(policyType, vehicleAge, activePolicyTypes),
        benefits: this.getPolicyBenefits(policyType),
        terms: this.getPolicyTerms(policyType)
      });
    }

    return offers.sort((a, b) => {
      // Sort by recommendation, then by price
      if (a.recommended && !b.recommended) return -1;
      if (!a.recommended && b.recommended) return 1;
      return a.premium - b.premium;
    });
  }

  /**
   * Create insurance policy from accepted offer
   */
  private async createInsurancePolicy(offer: any): Promise<any> {
    const policyNumber = this.generatePolicyNumber();
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year

    return await prisma.insurancePolicy.create({
      data: {
        clientId: offer.clientId,
        vehicleId: offer.vehicleId,
        policyNumber,
        provider: offer.provider,
        type: offer.type,
        status: 'ACTIVE',
        startDate,
        endDate,
        premium: offer.premium,
        deductible: offer.deductible,
        coverage: offer.coverage
      }
    });
  }

  /**
   * Get age-based pricing multiplier
   */
  private getAgeMultiplier(vehicleAge: number): number {
    if (vehicleAge <= 2) return INSURANCE_RULES.AGE_MULTIPLIERS.NEW;
    if (vehicleAge <= 5) return INSURANCE_RULES.AGE_MULTIPLIERS.RECENT;
    if (vehicleAge <= 10) return INSURANCE_RULES.AGE_MULTIPLIERS.MATURE;
    if (vehicleAge <= 15) return INSURANCE_RULES.AGE_MULTIPLIERS.OLD;
    return INSURANCE_RULES.AGE_MULTIPLIERS.VINTAGE;
  }

  /**
   * Calculate client-based discount
   */
  private getClientDiscount(client: any, vehicle: any): number {
    let discount = 1.0;

    // Loyalty points discount
    if (client.achievementPoints >= 2000) {
      discount *= INSURANCE_RULES.CLIENT_DISCOUNTS.LOYAL_GOLD;
    } else if (client.achievementPoints >= 1000) {
      discount *= INSURANCE_RULES.CLIENT_DISCOUNTS.LOYAL_SILVER;
    } else if (client.achievementPoints >= 500) {
      discount *= INSURANCE_RULES.CLIENT_DISCOUNTS.LOYAL_BRONZE;
    }

    // TODO: Add safe driver discount based on claims history
    // TODO: Add multi-vehicle discount

    return discount;
  }

  /**
   * Check if policy type is recommended
   */
  private isRecommended(policyType: string, vehicleAge: number, activePolicies: Set<string>): boolean {
    // Liability is always recommended if not active
    if (policyType === 'LIABILITY' && !activePolicies.has('LIABILITY')) {
      return true;
    }

    // Comprehensive for newer vehicles
    if (policyType === 'COMPREHENSIVE' && vehicleAge <= 5) {
      return true;
    }

    // Full coverage for valuable vehicles
    if (policyType === 'FULL_COVERAGE' && vehicleAge <= 3) {
      return true;
    }

    return false;
  }

  /**
   * Get policy benefits description
   */
  private getPolicyBenefits(policyType: string): string[] {
    const benefits = {
      LIABILITY: [
        'Covers damage to other vehicles and property',
        'Personal injury protection',
        'Legal defense coverage',
        'Required by law'
      ],
      COMPREHENSIVE: [
        'Theft and vandalism protection',
        'Weather damage coverage',
        'Glass breakage protection',
        'Roadside assistance included'
      ],
      COLLISION: [
        'Covers damage from accidents',
        'No-fault coverage',
        'Rental car assistance',
        'Towing services'
      ],
      FULL_COVERAGE: [
        'Complete protection package',
        'Highest coverage limits',
        'Premium roadside assistance',
        'Accident forgiveness program',
        'New car replacement'
      ]
    };

    return benefits[policyType as keyof typeof benefits] || [];
  }

  /**
   * Get policy terms and conditions
   */
  private getPolicyTerms(policyType: string): string[] {
    return [
      'Policy valid for 12 months',
      'Monthly payment options available',
      '30-day money-back guarantee',
      'Claims can be filed 24/7',
      'Coverage effective immediately upon payment'
    ];
  }

  /**
   * Generate unique policy number
   */
  private generatePolicyNumber(): string {
    const prefix = 'AA';
    const year = new Date().getFullYear().toString().slice(-2);
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    return `${prefix}${year}${month}${random}`;
  }
}