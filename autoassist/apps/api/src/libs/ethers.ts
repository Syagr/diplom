// src/libs/ethers.ts
import { JsonRpcProvider, Wallet, Contract, formatEther, parseEther } from 'ethers';

const RPC_URL = process.env.CHAIN_RPC_URL || 'http://127.0.0.1:8545';
const PRIVATE_KEY = process.env.CHAIN_PRIVATE_KEY || '';
const ESCROW_ADDRESS = process.env.ESCROW_ADDRESS || ''; // опционально

// Минимальный ABI, если есть метод lockPayment(uint256 orderId, uint256 amountWei)
const ESCROW_ABI = [
  'function lockPayment(uint256 orderId, uint256 amountWei) public returns (bool)',
  'function locked(uint256 orderId) public view returns (uint256)',
];

export const provider = new JsonRpcProvider(RPC_URL);

// кошелёк доступен только если есть приватный ключ
export const wallet = PRIVATE_KEY ? new Wallet(PRIVATE_KEY, provider) : null;

// контракт опционален
export const escrow = ESCROW_ADDRESS && wallet
  ? new Contract(ESCROW_ADDRESS, ESCROW_ABI, wallet)
  : null;

export function toWei(amountEth: number | string | bigint) {
  return parseEther(amountEth.toString());
}

export function fromWei(amountWei: bigint) {
  return formatEther(amountWei);
}

/**
 * Заблокировать платёж в escrow (если контракт и кошелёк доступны).
 */
export async function lockPayment(
  orderId: number,
  amountWei: bigint
): Promise<{ txHash: string } | null> {
  if (!escrow) return null;
  const tx = await escrow.lockPayment(BigInt(orderId), amountWei);
  const receipt = await tx.wait();
  return { txHash: receipt?.hash ?? tx.hash };
}
