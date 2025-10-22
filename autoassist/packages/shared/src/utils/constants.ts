// Platform-wide constants and configuration

export const API_VERSION = 'v1';

export const PHONE_REGEX = /^(\+\d{1,3}[- ]?)?\d{10,}$/;
export const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;
export const LICENSE_PLATE_REGEX = /^[A-Z0-9]{2,8}$/;

export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg', 
  'image/png',
  'image/webp'
] as const;

export const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
] as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_IMAGES_PER_ORDER = 10;

export const PAGINATION_DEFAULTS = {
  page: 1,
  limit: 20,
  maxLimit: 100
} as const;

export const PASSWORD_MIN_LENGTH = 8;
export const JWT_EXPIRES_IN = '24h';
export const REFRESH_TOKEN_EXPIRES_IN = '7d';

export const ACHIEVEMENT_POINTS = {
  FIRST_ORDER: 100,
  ORDER_COMPLETED: 50,
  QUICK_PAYMENT: 25,
  REFERRAL: 200,
  LOYALTY_BRONZE: 500,
  LOYALTY_SILVER: 1000,
  LOYALTY_GOLD: 2000,
  SAFE_DRIVER_BONUS: 300,
  ECO_FRIENDLY_BONUS: 150
} as const;

export const ORDER_TYPES = {
  REPAIR: {
    name: 'Repair',
    icon: '🔧',
    estimatedTimeHours: 4,
    category: 'maintenance'
  },
  MAINTENANCE: {
    name: 'Maintenance',
    icon: '🔍',
    estimatedTimeHours: 2,
    category: 'maintenance'
  },
  INSPECTION: {
    name: 'Inspection',
    icon: '📋',
    estimatedTimeHours: 1,
    category: 'inspection'
  },
  EMERGENCY: {
    name: 'Emergency',
    icon: '🚨',
    estimatedTimeHours: 0.5,
    category: 'emergency',
    priority: 'high'
  },
  INSURANCE_CLAIM: {
    name: 'Insurance Claim',
    icon: '📄',
    estimatedTimeHours: 24,
    category: 'insurance'
  },
  CONSULTATION: {
    name: 'Consultation',
    icon: '💬',
    estimatedTimeHours: 1,
    category: 'consultation'
  }
} as const;

export const PAYMENT_METHODS = {
  CREDIT_CARD: {
    name: 'Credit Card',
    icon: '💳',
    processingFee: 0.029,
    instantProcessing: true
  },
  BANK_TRANSFER: {
    name: 'Bank Transfer',
    icon: '🏦',
    processingFee: 0.01,
    instantProcessing: false
  },
  CRYPTOCURRENCY: {
    name: 'Cryptocurrency',
    icon: '₿',
    processingFee: 0.005,
    instantProcessing: true
  },
  ESCROW: {
    name: 'Smart Contract Escrow',
    icon: '🔒',
    processingFee: 0.01,
    instantProcessing: false
  },
  INSURANCE: {
    name: 'Insurance Coverage',
    icon: '🛡️',
    processingFee: 0,
    instantProcessing: false
  }
} as const;

export const CURRENCY_CODES = [
  'USD', 'EUR', 'UAH', 'PLN', 'CZK', 'BGN', 'RON'
] as const;

export const BLOCKCHAIN_NETWORKS = {
  POLYGON_TESTNET: {
    chainId: 80001,
    name: 'Polygon Mumbai Testnet',
    rpcUrl: 'https://rpc-mumbai.maticvigil.com',
    explorerUrl: 'https://mumbai.polygonscan.com',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    }
  },
  POLYGON_MAINNET: {
    chainId: 137,
    name: 'Polygon Mainnet',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    nativeCurrency: {
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    }
  }
} as const;

// Telegram commands removed in web/web3-only scope

export const ERROR_CODES = {
  // Authentication
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_PHONE: 'INVALID_PHONE',
  INVALID_VIN: 'INVALID_VIN',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  
  // Business Logic
  CLIENT_NOT_FOUND: 'CLIENT_NOT_FOUND',
  VEHICLE_NOT_FOUND: 'VEHICLE_NOT_FOUND',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  
  // System
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED'
} as const;

export const HTTP_STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503
} as const;