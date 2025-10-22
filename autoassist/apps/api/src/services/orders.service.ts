// src/services/orders.service.ts
import prisma from '@/utils/prisma.js';
import { enqueueEmailNotification } from '@/queues/index.js';
import { canonicalJson, sha256Hex } from '@/utils/hash.js';

export type CompletionEvidence = {
  photos?: number[]; // attachment IDs (already uploaded separately)
  coords?: { lat: number; lng: number };
  completedAt?: string; // ISO
  notes?: string;
};

export async function completeOrder(orderId: number, actorId: number | null, evidence: CompletionEvidence) {
  const o = await prisma.order.findUnique({ where: { id: Number(orderId) } });
  if (!o) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });

  // Canonical JSON + hash
  const payload = {
    orderId: o.id,
    completedAt: evidence.completedAt || new Date().toISOString(),
    coords: evidence.coords || null,
    photos: Array.isArray(evidence.photos) ? evidence.photos.slice().sort((a, b) => a - b) : [],
    notes: evidence.notes || null,
  };
  const json = canonicalJson(payload);
  const hash = sha256Hex(json);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.order.update({ where: { id: o.id }, data: { status: 'CLOSED' } });
    await tx.orderTimeline.create({
      data: {
        orderId: o.id,
        event: 'Order completed',
        details: { proofHash: hash, evidence: payload },
      },
    });
    return u;
  });

  // Notify via email
  enqueueEmailNotification({ type: 'order_closed', orderId: o.id }).catch(() => {/* noop */});

  return { order: updated, proofHash: hash };
}

export async function getOrderProof(orderId: number, requesterId: number) {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) {
    throw Object.assign(new Error('INVALID_ID'), { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, clientId: true },
  });
  if (!order) throw Object.assign(new Error('ORDER_NOT_FOUND'), { status: 404 });

  const user = await prisma.user.findUnique({
    where: { id: Number(requesterId) },
    select: { id: true, role: true, clientId: true },
  });
  if (!user) throw Object.assign(new Error('UNAUTHORIZED'), { status: 401 });

  const isStaff = user.role && user.role !== 'customer';
  const isOwner = user.clientId != null && user.clientId === order.clientId;
  if (!isStaff && !isOwner) {
    throw Object.assign(new Error('FORBIDDEN'), { status: 403 });
  }

  const tl = await prisma.orderTimeline.findFirst({
    where: { orderId: id, event: 'Order completed' },
    orderBy: { createdAt: 'desc' },
    select: { details: true, createdAt: true },
  });
  if (!tl || !tl.details) {
    throw Object.assign(new Error('PROOF_NOT_FOUND'), { status: 404 });
  }

  const details: any = tl.details as any;
  const proofHash: string | undefined = details.proofHash;
  const evidence = details.evidence ?? null;
  if (!proofHash) {
    throw Object.assign(new Error('PROOF_NOT_FOUND'), { status: 404 });
  }

  return {
    orderId: id,
    proofHash,
    evidence,
    createdAt: tl.createdAt,
  };
}
