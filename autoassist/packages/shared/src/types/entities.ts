// Core business entities shared across platform

export interface IClient {
  id: string;
  telegramId?: string;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  dateOfBirth?: Date;
  driverLicense?: string;
  insuranceNumber?: string;
  biometricDataHash?: string;
  achievementPoints: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IVehicle {
  id: string;
  clientId: string;
  make: string;
  model: string;
  year: number;
  vin: string;
  licensePlate: string;
  color?: string;
  engineType?: string;
  mileage?: number;
  insurancePolicyNumber?: string;
  nftTokenId?: string;
  images: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IOrder {
  id: string;
  clientId: string;
  vehicleId: string;
  type: OrderType;
  status: OrderStatus;
  description: string;
  estimatedCost?: number;
  finalCost?: number;
  location: ILocation;
  scheduledDate?: Date;
  completedAt?: Date;
  attachments: string[];
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IInsurancePolicy {
  id: string;
  clientId: string;
  vehicleId: string;
  policyNumber: string;
  provider: string;
  type: InsurancePolicyType;
  status: InsurancePolicyStatus;
  startDate: Date;
  endDate: Date;
  premium: number;
  deductible: number;
  coverage: InsuranceCoverage;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPayment {
  id: string;
  orderId: string;
  clientId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  providerTransactionId?: string;
  escrowAddress?: string;
  blockchainTxHash?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAchievement {
  id: string;
  clientId: string;
  type: AchievementType;
  level: number;
  points: number;
  description: string;
  imageUrl?: string;
  unlockedAt: Date;
  createdAt: Date;
}

export interface ILocation {
  latitude: number;
  longitude: number;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
}

export interface InsuranceCoverage {
  liability: number;
  collision: number;
  comprehensive: number;
  personalInjury: number;
  uninsuredMotorist: number;
}

// Enums
export enum OrderType {
  REPAIR = 'REPAIR',
  MAINTENANCE = 'MAINTENANCE',
  INSPECTION = 'INSPECTION',
  EMERGENCY = 'EMERGENCY',
  INSURANCE_CLAIM = 'INSURANCE_CLAIM',
  CONSULTATION = 'CONSULTATION'
}

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DISPUTED = 'DISPUTED'
}

export enum InsurancePolicyType {
  LIABILITY = 'LIABILITY',
  COMPREHENSIVE = 'COMPREHENSIVE',
  COLLISION = 'COLLISION',
  FULL_COVERAGE = 'FULL_COVERAGE'
}

export enum InsurancePolicyStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
  PENDING = 'PENDING'
}

export enum PaymentMethod {
  CREDIT_CARD = 'CREDIT_CARD',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CRYPTOCURRENCY = 'CRYPTOCURRENCY',
  ESCROW = 'ESCROW',
  INSURANCE = 'INSURANCE'
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED'
}

export enum AchievementType {
  FIRST_ORDER = 'FIRST_ORDER',
  LOYALTY_BRONZE = 'LOYALTY_BRONZE',
  LOYALTY_SILVER = 'LOYALTY_SILVER',
  LOYALTY_GOLD = 'LOYALTY_GOLD',
  SAFE_DRIVER = 'SAFE_DRIVER',
  ECO_FRIENDLY = 'ECO_FRIENDLY',
  QUICK_PAYER = 'QUICK_PAYER',
  REFERRAL = 'REFERRAL'
}