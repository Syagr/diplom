import { PrismaClient } from '@prisma/client';
import { createCheckout } from '@/libs/liqpay.js';
// import { escrow } from '../libs/ethers';
const prisma = new PrismaClient();

export async function createInvoice(orderId: number, amount: number, method: 'CARD'|'BANK_TRANSFER'|'CRYPTO' = 'CARD') {
  const { url } = await createCheckout(amount, orderId);
  const p = await prisma.payment.create({ data: { orderId, amount, method, status: 'PENDING', invoiceUrl: url } });
  return p;
}

// вызови это в webhook после "paid"
export async function onPaid(orderId: number, paymentId: number) {
  const p = await prisma.payment.update({ where: { id: paymentId }, data: { status: 'COMPLETED' } });
  // escrow (опционально, обернуть try/catch)
  // try { await escrow.lockPayment(orderId, BigInt(Number(p.amount)*1_000_000_000_000_000_000n)); } catch {}
  return p;
}