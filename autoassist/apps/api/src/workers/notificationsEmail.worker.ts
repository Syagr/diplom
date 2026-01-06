// workers/notifications.email.worker.ts
import { Worker, QueueEvents, MetricsTime } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../utils/prisma.js';
import nodemailer from 'nodemailer';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = Number(process.env.REDIS_PORT || 6379);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_TLS = process.env.REDIS_TLS === '1' || process.env.REDIS_TLS === 'true';

const connection = new (IORedis as any)({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  ...(REDIS_TLS ? { tls: { rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== '0' } } : {}),
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
// BullMQ requires maxRetriesPerRequest = null for blocking commands.
try { (connection as any).options.maxRetriesPerRequest = null; } catch {}

type NotificationJob = {
  type: 'payment_completed' | 'estimate_locked' | 'order_closed';
  orderId: number;
  paymentId?: number;
  estimateId?: number;
};

async function renderEmail(job: NotificationJob): Promise<{ subject: string; text: string; html?: string }> {
  switch (job.type) {
    case 'payment_completed': {
      const payment = await prisma.payment.findUnique({ where: { id: Number(job.paymentId) } });
      const url = payment?.receiptUrl ? `${process.env.PUBLIC_BASE_URL || ''}${payment.receiptUrl}` : undefined;
      const subject = `Payment confirmed for Order #${job.orderId}`;
      const text = `Your payment is confirmed.${url ? ` Receipt: ${url}` : ''}`;
      const html = `<p>Your payment is confirmed.</p>${url ? `<p>Receipt: <a href="${url}">${url}</a></p>` : ''}`;
      return { subject, text, html };
    }
    case 'estimate_locked': {
      const subject = `Estimate locked for Order #${job.orderId}`;
      const text = `Your estimate is locked and ready for payment.`;
      const html = `<p>Your estimate is locked and ready for payment.</p>`;
      return { subject, text, html };
    }
    case 'order_closed': {
      const subject = `Order #${job.orderId} completed`;
      const text = `Your order is marked as completed. Thank you!`;
      const html = `<p>Your order is marked as completed. Thank you!</p>`;
      return { subject, text, html };
    }
  }
}

// --- Mailer setup (Mailtrap/SMTP) ---
function createTransport() {
  try {
    const smtpUrl = process.env.SMTP_URL;
    if (smtpUrl) {
      return nodemailer.createTransport(smtpUrl);
    }
    const host = process.env.MAILTRAP_HOST || process.env.SMTP_HOST;
    const port = Number(process.env.MAILTRAP_PORT || process.env.SMTP_PORT || 587);
    const user = process.env.MAILTRAP_USER || process.env.SMTP_USER;
    const pass = process.env.MAILTRAP_PASS || process.env.SMTP_PASS;
    if (host && user && pass) {
      return nodemailer.createTransport({ host, port, auth: { user, pass } });
    }
  } catch {}
  return null;
}
const transport = createTransport();

const worker = new Worker<NotificationJob>(
  'notifications-email',
  async (job) => {
    const { orderId } = job.data;
    // Resolve recipient (client email)
    const order = await prisma.order.findUnique({
      where: { id: Number(orderId) },
      select: { client: { select: { email: true, name: true } } },
    });
    const toEmail = order?.client?.email || null;

  const { subject, text, html } = await renderEmail(job.data);

    if (!toEmail) {
      console.log(`[email:${job.name}] (no email on client) order=${orderId} -> SUBJECT: ${subject} | ${text}`);
      return { ok: false, reason: 'NO_EMAIL' };
    }

    if (!transport) {
      // DEV: console fallback
      console.log(`[email:${job.name}] (console) to=${toEmail} subject="${subject}" text="${text}"`);
      return { ok: true, to: toEmail, transport: 'console' };
    }

    try {
      const from = process.env.NOTIFY_FROM || 'no-reply@autoassist.test';
  const info = await transport.sendMail({ from, to: toEmail, subject, text, html });
      return { ok: true, to: toEmail, messageId: info.messageId, transport: 'smtp' };
    } catch (err: any) {
      console.error('[notify] smtp send error', err?.message || err);
      // Throw to trigger BullMQ retries per queue defaultJobOptions
      throw err;
    }
  },
  {
    connection,
    concurrency: Number(process.env.NOTIFY_CONCURRENCY || 4),
    metrics: { maxDataPoints: MetricsTime.ONE_HOUR },
    autorun: true,
  }
);

worker.on('ready', () => console.log(`[notify] worker ready on redis://${REDIS_HOST}:${REDIS_PORT}`));
worker.on('completed', (job, ret) => console.log(`[notify] completed job=${job.id} type=${job.name}`, ret));
worker.on('failed', (job, err) => console.error(`[notify] failed job=${job?.id} type=${job?.name}`, err?.message || err));
worker.on('error', (err) => console.error('[notify] worker error', err));

const qe = new QueueEvents('notifications-email', { connection });
qe.on('completed', ({ jobId }) => console.log('[notify] qe completed', jobId));
qe.on('failed', ({ jobId, failedReason }) => console.warn('[notify] qe failed', jobId, failedReason));

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[notify] shutting down...');
  try { await worker.close(); } catch {}
  try { await qe.close(); } catch {}
  try { await prisma.$disconnect(); } catch {}
  try { await connection.quit(); } catch {}
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('beforeExit', () => shutdown(0));

console.log('[notify] worker started');
