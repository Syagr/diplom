// src/utils/prisma.ts
import { PrismaClient } from '@prisma/client';

type GlobalWithPrisma = typeof globalThis & { __prisma?: PrismaClient };

const makePrisma = () =>
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
  });

const g = globalThis as GlobalWithPrisma;

// В dev (HMR) кешируем в globalThis, чтобы не плодить соединения
export const prisma: PrismaClient = g.__prisma ?? makePrisma();
if (process.env.NODE_ENV !== 'production') g.__prisma = prisma;

// Аккуратное завершение при остановке процесса
let cleanedUp = false;
async function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    await prisma.$disconnect();
  } catch { /* noop */ }
}
process.once('beforeExit', cleanup);
process.once('SIGINT', async () => { await cleanup(); process.exit(0); });
process.once('SIGTERM', async () => { await cleanup(); process.exit(0); });

export default prisma;
