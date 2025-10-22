import prisma from '@/utils/prisma.js';
import { ethers } from 'ethers';
import { generateReceiptForPayment } from '@/services/receipts.service.js';
import { enqueueEmailNotification } from '@/queues/index.js';

type VerifyInput = {
  orderId: number;
  paymentId: number;
  txHash: string;
};

function getProvider() {
  const url = process.env.WEB3_PROVIDER_URL || process.env.WEB3_RPC_URL;
  if (!url) throw Object.assign(new Error('WEB3_PROVIDER_URL is required'), { status: 500 });
  return new ethers.JsonRpcProvider(url);
}

function getExpectedChainId(): bigint | null {
  const v = process.env.WEB3_CHAIN_ID || process.env.CHAIN_ID;
  if (!v) return 80002n; // default to Polygon Amoy (testnet) unless explicitly disabled
  try { return BigInt(v); } catch { return null; }
}

function getConfirmations(): number {
  const v = process.env.WEB3_CONFIRMATIONS || '2';
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

function getTxTimeoutMs(): number {
  const v = process.env.WEB3_TX_TIMEOUT_MS || '60000';
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // keccak256("Transfer(address,address,uint256)")

function toChecksum(addr?: string | null): string | null {
  try { return addr ? ethers.getAddress(addr) : null; } catch { return addr ?? null; }
}

function parseErc20TransferToPlatform(receipt: any, tokenAddress: string, platformAddr?: string | null) {
  const token = toChecksum(tokenAddress);
  const platform = toChecksum(platformAddr || undefined);
  if (!receipt?.logs || !Array.isArray(receipt.logs)) return null;
  for (const log of receipt.logs) {
    if (toChecksum(log.address) !== token) continue;
    const topics: string[] = log.topics || [];
    if (!topics.length || topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    // topics[1]=from, topics[2]=to (indexed, padded to 32 bytes)
    const toTopic = topics[2];
    if (platform && (!toTopic || !toTopic.toLowerCase().endsWith(platform.toLowerCase().slice(2)))) continue;
    // data is amount (uint256) hex
    const amountHex = log.data; // e.g. 0x...32 bytes
    try {
      const amount = BigInt(amountHex);
      return { to: platform ?? null, amount };
    } catch { /* ignore */ }
  }
  return null;
}

async function enforceAmountIfRequired(payment: any, amountWei: bigint | null, isNative: boolean) {
  const enforce = process.env.WEB3_ENFORCE_AMOUNT === '1' || process.env.WEB3_ENFORCE_AMOUNT === 'true';
  if (!enforce) return;
  if (amountWei == null) return; // nothing to check
  const decimals = isNative ? 18 : Number(process.env.USDC_DECIMALS || 6);
  const scale = BigInt(10) ** BigInt(decimals);
  // Better: treat payment.amount as major with 2 decimals => convert to smallest for given token
  // Convert Decimal(12,2) to integer smallest units for token decimals
  const majorStr = String(payment.amount);
  const [intPart, fracPartRaw = ''] = majorStr.split('.');
  const fracPart = (fracPartRaw + '00').slice(0, 2); // two decimals from DB
  const valueCents = BigInt(intPart) * 100n + BigInt(fracPart);
  // Map cents to token decimals
  const tokenUnits = (valueCents * (scale)) / 100n;
  if (amountWei !== tokenUnits) {
    const err: any = new Error('AMOUNT_MISMATCH');
    err.status = 400; err.code = 'AMOUNT_MISMATCH';
    err.expected = tokenUnits.toString();
    err.got = amountWei.toString();
    throw err;
  }
}

export async function verifyAndCompleteWeb3Payment({ orderId, paymentId, txHash }: VerifyInput) {
  if (!/^0x([A-Fa-f0-9]{64})$/.test(txHash)) {
    throw Object.assign(new Error('INVALID_TX_HASH'), { status: 400, code: 'INVALID_TX_HASH' });
  }

  const payment = await prisma.payment.findUnique({ where: { id: Number(paymentId) } });
  if (!payment) throw Object.assign(new Error('PAYMENT_NOT_FOUND'), { status: 404 });
  if (payment.orderId !== Number(orderId)) throw Object.assign(new Error('ORDER_MISMATCH'), { status: 400 });
  if (payment.status === 'COMPLETED') return payment; // идемпотентно

  const provider = getProvider();
  // Chain check (defense-in-depth)
  const expectedChainId = getExpectedChainId();
  try {
    const net = await provider.getNetwork();
    if (expectedChainId && net.chainId !== expectedChainId) {
      const err: any = new Error('CHAIN_MISMATCH');
      err.status = 400; err.code = 'CHAIN_MISMATCH';
      err.expected = expectedChainId.toString();
      err.got = net.chainId.toString();
      throw err;
    }
  } catch (e) {
    // Network unreachable or malformed; treat as 502
    if (!(e as any)?.code || (e as any).code === 'NETWORK_ERROR') {
      const err: any = new Error('RPC_UNAVAILABLE');
      err.status = 502; err.code = 'RPC_UNAVAILABLE';
      throw err;
    }
    throw e;
  }

  // Wait for the transaction to reach the required confirmations
  const confirmations = getConfirmations();
  const timeoutMs = getTxTimeoutMs();
  const receipt = await provider.waitForTransaction(txHash, confirmations, timeoutMs).catch(() => null);
  if (!receipt) {
    const err: any = new Error('TX_TIMEOUT');
    err.status = 504; err.code = 'TX_TIMEOUT';
    throw err;
  }

  if (receipt.status !== 1) {
    // Неуспешная транзакция
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', txHash } });
    throw Object.assign(new Error('TX_FAILED'), { status: 400, code: 'TX_FAILED' });
  }

  // Optional amount and destination enforcement
  const usdcAddr = process.env.USDC_TOKEN_ADDRESS || process.env.USDC_ADDRESS;
  const platformAddr = process.env.PLATFORM_RECEIVE_ADDRESS || process.env.PLATFORM_ADDRESS;
  let transferAmount: bigint | null = null;
  let isNative = false;
  if (usdcAddr) {
    const parsed = parseErc20TransferToPlatform(receipt, usdcAddr, platformAddr || undefined);
    if (parsed) {
      transferAmount = parsed.amount;
    }
  }
  if (transferAmount == null) {
    // fallback to native: fetch transaction for value
    const tx = await provider.getTransaction(txHash);
    if (tx) {
      isNative = true;
      transferAmount = tx.value ?? 0n;
      if (platformAddr && toChecksum(tx.to) !== toChecksum(platformAddr)) {
        const err: any = new Error('DEST_MISMATCH');
        err.status = 400; err.code = 'DEST_MISMATCH';
        err.expected = toChecksum(platformAddr);
        err.got = toChecksum(tx.to || '0x0000000000000000000000000000000000000000');
        throw err;
      }
    }
  }
  try {
    await enforceAmountIfRequired(payment, transferAmount, isNative);
  } catch (e) {
    // Mark as failed if amount mismatch when enforced
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', txHash } });
    throw e;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'COMPLETED', txHash, completedAt: new Date() },
    });
    await tx.orderTimeline.create({
      data: {
        orderId: p.orderId,
        event: 'Payment completed (web3)',
        details: { paymentId: p.id, txHash, network: 'evm', amount: Number(p.amount), token: usdcAddr ? 'USDC' : 'MATIC' },
      },
    });
    return p;
  });

  // fire-and-forget receipt generation + email notify
  generateReceiptForPayment(updated.id).catch(() => {/* noop */});
  enqueueEmailNotification({ type: 'payment_completed', orderId: updated.orderId, paymentId: updated.id }).catch(() => {/* noop */});
  return updated;
}

// Test-only helper: verify using a provided receipt (no RPC). Not exported in production docs.
export async function verifyAndCompleteWeb3PaymentFromReceipt({ orderId, paymentId, txHash, receipt }: { orderId: number; paymentId: number; txHash: string; receipt: any; }) {
  if (process.env.NODE_ENV !== 'test') {
    const err: any = new Error('FORBIDDEN'); err.status = 403; throw err;
  }
  if (!/^0x([A-Fa-f0-9]{64})$/.test(txHash)) {
    throw Object.assign(new Error('INVALID_TX_HASH'), { status: 400, code: 'INVALID_TX_HASH' });
  }
  const payment = await prisma.payment.findUnique({ where: { id: Number(paymentId) } });
  if (!payment) throw Object.assign(new Error('PAYMENT_NOT_FOUND'), { status: 404 });
  if (payment.orderId !== Number(orderId)) throw Object.assign(new Error('ORDER_MISMATCH'), { status: 400 });
  if (payment.status === 'COMPLETED') return payment;
  if (!receipt || receipt.status !== 1) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', txHash } });
    throw Object.assign(new Error('TX_FAILED'), { status: 400, code: 'TX_FAILED' });
  }
  const usdcAddr = process.env.USDC_TOKEN_ADDRESS || process.env.USDC_ADDRESS;
  const platformAddr = process.env.PLATFORM_RECEIVE_ADDRESS || process.env.PLATFORM_ADDRESS;
  let transferAmount: bigint | null = null;
  const isNative = false;
  if (usdcAddr) {
    const parsed = parseErc20TransferToPlatform(receipt, usdcAddr, platformAddr || undefined);
    if (parsed) transferAmount = parsed.amount;
  }
  // For test helper we don't attempt native (no tx.value available)
  await enforceAmountIfRequired(payment, transferAmount, isNative);

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'COMPLETED', txHash, completedAt: new Date() },
    });
    await tx.orderTimeline.create({
      data: {
        orderId: p.orderId,
        event: 'Payment completed (web3)',
        details: { paymentId: p.id, txHash, network: 'evm', amount: Number(p.amount), token: usdcAddr ? 'USDC' : 'MATIC' },
      },
    });
    return p;
  });
  generateReceiptForPayment(updated.id).catch(() => {/* noop */});
  enqueueEmailNotification({ type: 'payment_completed', orderId: updated.orderId, paymentId: updated.id }).catch(() => {/* noop */});
  return updated;
}
