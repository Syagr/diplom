// Validation schemas and helpers

import { z } from 'zod';
import { 
  PHONE_REGEX, 
  VIN_REGEX, 
  LICENSE_PLATE_REGEX, 
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_DOCUMENT_TYPES,
  MAX_FILE_SIZE,
  PASSWORD_MIN_LENGTH
} from './constants';

// Common validation schemas
export const phoneSchema = z.string()
  .regex(PHONE_REGEX, 'Invalid phone number format')
  .min(10, 'Phone number must be at least 10 digits')
  .max(15, 'Phone number must be at most 15 digits');

export const emailSchema = z.string()
  .email('Invalid email format')
  .optional();

export const vinSchema = z.string()
  .regex(VIN_REGEX, 'VIN must be 17 characters with valid format')
  .length(17, 'VIN must be exactly 17 characters');

export const licensePlateSchema = z.string()
  .regex(LICENSE_PLATE_REGEX, 'Invalid license plate format')
  .min(2, 'License plate must be at least 2 characters')
  .max(8, 'License plate must be at most 8 characters');

export const passwordSchema = z.string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/\d/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

export const uuidSchema = z.string().uuid('Invalid UUID format');

export const positiveNumberSchema = z.number().positive('Must be a positive number');

export const dateStringSchema = z.string()
  .refine((date) => !isNaN(Date.parse(date)), 'Invalid date format');

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

export const locationSchema = coordinatesSchema.extend({
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional()
});

// Entity validation schemas
export const createClientSchema = z.object({
  telegramId: z.string().optional(),
  phone: phoneSchema,
  firstName: z.string().min(1, 'First name is required').max(50),
  lastName: z.string().min(1, 'Last name is required').max(50),
  email: emailSchema,
  dateOfBirth: dateStringSchema.optional(),
  driverLicense: z.string().max(50).optional(),
  insuranceNumber: z.string().max(50).optional()
});

export const updateClientSchema = createClientSchema.partial().extend({
  biometricDataHash: z.string().optional()
});

export const createVehicleSchema = z.object({
  make: z.string().min(1, 'Vehicle make is required').max(50),
  model: z.string().min(1, 'Vehicle model is required').max(50),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 1),
  vin: vinSchema,
  licensePlate: licensePlateSchema,
  color: z.string().max(30).optional(),
  engineType: z.string().max(50).optional(),
  mileage: z.number().int().min(0).optional(),
  insurancePolicyNumber: z.string().max(50).optional(),
  images: z.array(z.string().url()).max(10).optional()
});

export const updateVehicleSchema = createVehicleSchema.partial().extend({
  nftTokenId: z.string().optional()
});

export const createOrderSchema = z.object({
  vehicleId: uuidSchema,
  type: z.enum(['REPAIR', 'MAINTENANCE', 'INSPECTION', 'EMERGENCY', 'INSURANCE_CLAIM', 'CONSULTATION']),
  description: z.string().min(10, 'Description must be at least 10 characters').max(1000),
  estimatedCost: positiveNumberSchema.optional(),
  location: locationSchema,
  scheduledDate: dateStringSchema.optional(),
  attachments: z.array(z.string().url()).max(10).optional(),
  metadata: z.record(z.any()).optional()
});

export const updateOrderSchema = createOrderSchema.partial().extend({
  status: z.enum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED']).optional(),
  finalCost: positiveNumberSchema.optional()
});

export const createPaymentSchema = z.object({
  orderId: uuidSchema,
  amount: positiveNumberSchema,
  currency: z.string().length(3),
  method: z.enum(['CREDIT_CARD', 'BANK_TRANSFER', 'CRYPTOCURRENCY', 'ESCROW', 'INSURANCE']),
  returnUrl: z.string().url().optional(),
  metadata: z.record(z.any()).optional()
});

// File validation
export const fileValidationSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.enum([...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES] as const),
  size: z.number().max(MAX_FILE_SIZE, 'File size too large')
});

// Pagination validation
export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

// Query parameter validation
export const orderListQuerySchema = paginationSchema.extend({
  clientId: uuidSchema.optional(),
  vehicleId: uuidSchema.optional(),
  type: z.enum(['REPAIR', 'MAINTENANCE', 'INSPECTION', 'EMERGENCY', 'INSURANCE_CLAIM', 'CONSULTATION']).optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DISPUTED']).optional(),
  dateFrom: dateStringSchema.optional(),
  dateTo: dateStringSchema.optional()
});

// Authentication validation
export const loginSchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6).optional(),
  biometricHash: z.string().optional()
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1)
});

// Telegram-specific validation
export const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  is_bot: z.boolean(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().length(2).optional()
});

export const telegramWebAppDataSchema = z.object({
  data: z.string(),
  button_text: z.string()
});

// Blockchain validation
export const ethereumAddressSchema = z.string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format');

export const transactionHashSchema = z.string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash format');

export const createEscrowSchema = z.object({
  orderId: uuidSchema,
  amount: z.string().regex(/^\d+$/, 'Amount must be a valid number string'),
  buyer: ethereumAddressSchema,
  seller: ethereumAddressSchema,
  arbiter: ethereumAddressSchema
});

export const mintNFTSchema = z.object({
  vehicleId: uuidSchema,
  owner: ethereumAddressSchema,
  metadata: z.object({
    name: z.string(),
    description: z.string(),
    image: z.string().url(),
    external_url: z.string().url().optional(),
    attributes: z.array(z.object({
      trait_type: z.string(),
      value: z.union([z.string(), z.number()]),
      display_type: z.enum(['boost_number', 'boost_percentage', 'number', 'date']).optional()
    }))
  })
});

// Validation helper functions
export function validateRequired<T>(value: T, fieldName: string): T {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

export function validateEnum<T extends string>(value: string, enumValues: readonly T[], fieldName: string): T {
  if (!enumValues.includes(value as T)) {
    throw new Error(`${fieldName} must be one of: ${enumValues.join(', ')}`);
  }
  return value as T;
}

export function validateLength(value: string, min: number, max: number, fieldName: string): string {
  if (value.length < min || value.length > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max} characters`);
  }
  return value;
}

export function validateNumber(value: unknown, fieldName: string): number {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  return num;
}

export function validatePositiveNumber(value: unknown, fieldName: string): number {
  const num = validateNumber(value, fieldName);
  if (num <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return num;
}