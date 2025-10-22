// API request/response types and interfaces

import { IOrder, IClient, IVehicle, IPayment, OrderType, OrderStatus } from './entities';

// Generic API response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Authentication
export interface LoginRequest {
  phone: string;
  code?: string;
  biometricHash?: string;
}

export interface LoginResponse extends ApiResponse {
  data: {
    token: string;
    refreshToken: string;
    client: IClient;
    expiresIn: number;
  };
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

// Client management
export interface CreateClientRequest {
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  dateOfBirth?: string;
  driverLicense?: string;
  insuranceNumber?: string;
}

export interface UpdateClientRequest extends Partial<CreateClientRequest> {
  biometricDataHash?: string;
}

// Vehicle management
export interface CreateVehicleRequest {
  make: string;
  model: string;
  year: number;
  vin: string;
  licensePlate: string;
  color?: string;
  engineType?: string;
  mileage?: number;
  insurancePolicyNumber?: string;
  images?: string[];
}

export interface UpdateVehicleRequest extends Partial<CreateVehicleRequest> {
  nftTokenId?: string;
}

// Order management
export interface CreateOrderRequest {
  vehicleId: string;
  type: OrderType;
  description: string;
  estimatedCost?: number;
  location: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  scheduledDate?: string;
  attachments?: string[];
  metadata?: Record<string, any>;
}

export interface UpdateOrderRequest extends Partial<CreateOrderRequest> {
  status?: OrderStatus;
  finalCost?: number;
}

export interface OrderListQuery extends PaginationParams {
  clientId?: string;
  vehicleId?: string;
  type?: OrderType;
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
}

// Payment management
export interface CreatePaymentRequest {
  orderId: string;
  amount: number;
  currency: string;
  method: string;
  returnUrl?: string;
  metadata?: Record<string, any>;
}

export interface PaymentStatusUpdate {
  status: string;
  providerTransactionId?: string;
  blockchainTxHash?: string;
  metadata?: Record<string, any>;
}

// File upload
export interface FileUploadResponse extends ApiResponse {
  data: {
    url: string;
    filename: string;
    size: number;
    mimeType: string;
  };
}

// Real-time events via WebSocket
export interface SocketEvent<T = any> {
  type: string;
  data: T;
  timestamp: string;
  clientId?: string;
}

export interface OrderUpdateEvent extends SocketEvent {
  type: 'order_update';
  data: {
    orderId: string;
    status: OrderStatus;
    message?: string;
  };
}

export interface PaymentUpdateEvent extends SocketEvent {
  type: 'payment_update';
  data: {
    paymentId: string;
    orderId: string;
    status: string;
  };
}

export interface NotificationEvent extends SocketEvent {
  type: 'notification';
  data: {
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    actionUrl?: string;
  };
}

// Error handling
export interface ApiError {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, any>;
}

export interface ValidationError extends ApiError {
  code: 'VALIDATION_ERROR';
  field: string;
  value?: any;
}

export interface AuthenticationError extends ApiError {
  code: 'AUTHENTICATION_ERROR' | 'TOKEN_EXPIRED' | 'UNAUTHORIZED';
}

export interface BusinessLogicError extends ApiError {
  code: 'BUSINESS_LOGIC_ERROR';
  businessCode: string;
}