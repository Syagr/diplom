// Blockchain and Web3 related types

export interface ContractAddress {
  address: string;
  network: string;
  deployedAt: string;
  verified: boolean;
}

export interface NFTPassport {
  tokenId: string;
  vehicleId: string;
  owner: string;
  metadata: VehicleNFTMetadata;
  mintedAt: string;
  lastTransfer: string;
}

export interface VehicleNFTMetadata {
  name: string;
  description: string;
  image: string;
  external_url?: string;
  attributes: NFTAttribute[];
  vehicle: {
    vin: string;
    make: string;
    model: string;
    year: number;
    color?: string;
    licensePlate: string;
  };
  owner: {
    name: string;
    verified: boolean;
  };
  history: VehicleHistoryEntry[];
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
  display_type?: 'boost_number' | 'boost_percentage' | 'number' | 'date';
}

export interface VehicleHistoryEntry {
  date: string;
  type: 'purchase' | 'service' | 'accident' | 'insurance_claim' | 'transfer';
  description: string;
  cost?: number;
  verified: boolean;
  txHash?: string;
}

export interface EscrowPayment {
  id: string;
  orderId: string;
  amount: string; // BigNumber as string
  currency: string;
  buyer: string;
  seller: string;
  arbiter: string;
  status: EscrowStatus;
  createdAt: string;
  releasedAt?: string;
  refundedAt?: string;
  txHash: string;
}

export enum EscrowStatus {
  CREATED = 'CREATED',
  FUNDED = 'FUNDED',
  RELEASED = 'RELEASED',
  REFUNDED = 'REFUNDED',
  DISPUTED = 'DISPUTED'
}

export interface BlockchainTransaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  blockNumber: number;
  timestamp: string;
  status: 'success' | 'failed' | 'pending';
  contractAddress?: string;
  logs: TransactionLog[];
}

export interface TransactionLog {
  address: string;
  topics: string[];
  data: string;
  decoded?: {
    name: string;
    signature: string;
    params: Record<string, any>;
  };
}

export interface Web3Config {
  rpcUrl: string;
  chainId: number;
  chainName: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorerUrl: string;
  contracts: {
    autoPassport: ContractAddress;
    paymentEscrow: ContractAddress;
  };
}

export interface WalletConnection {
  address: string;
  chainId: number;
  provider: 'metamask' | 'walletconnect' | 'coinbase' | 'injected';
  connected: boolean;
  balance?: string;
}

// Smart contract interaction types
export interface MintNFTRequest {
  vehicleId: string;
  owner: string;
  metadata: VehicleNFTMetadata;
}

export interface CreateEscrowRequest {
  orderId: string;
  amount: string;
  buyer: string;
  seller: string;
  arbiter: string;
}

export interface ReleaseEscrowRequest {
  escrowId: string;
  signature?: string;
}

export interface RefundEscrowRequest {
  escrowId: string;
  reason: string;
  signature?: string;
}

export interface ContractCallResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  txHash?: string;
  gasUsed?: string;
  blockNumber?: number;
}