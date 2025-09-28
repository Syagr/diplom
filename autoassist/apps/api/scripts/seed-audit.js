#!/usr/bin/env node
// Simple seed script to insert demo AuditEvent rows for local development.
// Run with: node ./apps/api/scripts/seed-audit.js

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

console.log('Seeding demo audit events...');

const now = new Date();
const demo = [
  { type: 'estimate:created', payload: { estimateId: 1, orderId: 101, total: 1234.5 }, userId: 1, createdAt: new Date(now.getTime() - 1000 * 60 * 60) },
  { type: 'order:created', payload: { orderId: 101, clientId: 10 }, userId: 1, createdAt: new Date(now.getTime() - 1000 * 60 * 50) },
  { type: 'attachment:uploaded', payload: { attachmentId: 5, orderId: 101 }, userId: 1, createdAt: new Date(now.getTime() - 1000 * 60 * 40) },
  { type: 'estimate:approved', payload: { estimateId: 1, approvedBy: 1 }, userId: 1, createdAt: new Date(now.getTime() - 1000 * 60 * 10) },
  { type: 'wallet:link', payload: { address: '0xDEADBEEF' }, userId: 1, createdAt: now }
];

try {
  for (const e of demo) {
    try {
      await prisma.auditEvent.create({ data: e });
      console.log('Inserted', e.type);
    } catch (err) {
      console.error('Failed to insert', e.type, err?.message || err);
    }
  }
} catch (err) {
  console.error('Seeding failed:', err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  console.log('Seeding complete.');
}
