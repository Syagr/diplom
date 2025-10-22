// src/services/receipts.service.ts
import prisma from '@/utils/prisma.js';
import { minio, ATTACH_BUCKET, ensureBucket, buildObjectKey } from '@/libs/minio.js';
import { canonicalJson, sha256Hex } from '@/utils/hash.js';
// Use dynamic imports to avoid compile-time requirement of type declarations

type GenerateOptions = {
  explorerTxBaseUrl?: string; // e.g. https://amoy.polygonscan.com/tx/
  issuerName?: string; // company name
};

function getExplorerTxBaseUrl(): string {
  return (
    process.env.CHAIN_EXPLORER_TX ||
    process.env.POLYGONSCAN_TX_BASE ||
    'https://amoy.polygonscan.com/tx/'
  );
}

export async function generateReceiptForPayment(paymentId: number, opts: GenerateOptions = {}) {
  // lazy-load heavy libs
  const pdfLib: any = await import('pdf-lib');
  const { PDFDocument, StandardFonts, rgb } = pdfLib;
  const QRCode: any = (await import('qrcode')).default ?? (await import('qrcode'));
  const payment = await prisma.payment.findUnique({
    where: { id: Number(paymentId) },
    include: {
      order: {
        include: {
          client: true,
          vehicle: true,
        },
      },
    },
  });
  if (!payment || !payment.order) throw Object.assign(new Error('PAYMENT_NOT_FOUND'), { status: 404 });

  const order = payment.order;
  const client = order.client || null;
  const vehicle = order.vehicle || null;

  // Prepare QR (tx or fallback)
  const explorerBase = opts.explorerTxBaseUrl || getExplorerTxBaseUrl();
  const publicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const qrTarget = payment.txHash
    ? `${explorerBase}${payment.txHash}`
    : `${publicBase}/orders/${order.id}/payments/${payment.id}`;
  const qrPngBuffer = await QRCode.toBuffer(qrTarget, { width: 256 });

  // Build PDF
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();
  const margin = 40;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Header
  const title = 'Payment Receipt';
  page.drawText(title, {
    x: margin,
    y: height - margin - 10,
    size: 20,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  const issuer = opts.issuerName || process.env.RECEIPT_ISSUER || 'AutoAssist Web3';
  page.drawText(issuer, { x: margin, y: height - margin - 36, size: 12, font });

  // Details
  const lines: string[] = [
    `Receipt ID: PAY-${payment.id}`,
    `Order ID: ${order.id}`,
    `Date: ${new Date(payment.completedAt ?? payment.createdAt).toLocaleString()}`,
    `Amount: ${Number(payment.amount).toFixed(2)} ${((payment as any).currency ?? 'UAH')}`,
    `Method: ${payment.method}`,
    `Provider: ${payment.provider ?? 'n/a'}`,
    `Provider ID: ${payment.providerId ?? 'n/a'}`,
    `Tx Hash: ${payment.txHash ?? 'n/a'}`,
    client ? `Client: ${client.name} (${client.email ?? client.phone ?? 'n/a'})` : 'Client: n/a',
    vehicle ? `Vehicle: ${vehicle.plate} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim() : 'Vehicle: n/a',
  ];

  let y = height - margin - 70;
  for (const line of lines) {
    page.drawText(line, { x: margin, y, size: 12, font });
    y -= 18;
  }

  // QR in the corner
  const qrImage = await pdf.embedPng(qrPngBuffer);
  const qrDim = 140;
  page.drawImage(qrImage, {
    x: width - margin - qrDim,
    y: height - margin - qrDim,
    width: qrDim,
    height: qrDim,
  });

  const note = 'Scan QR to verify on blockchain or view payment page';
  page.drawText(note, { x: width - margin - qrDim, y: height - margin - qrDim - 14, size: 9, font });

  // Compute a canonical hash of key receipt attributes and embed into metadata
  const receiptPayload = {
    paymentId: payment.id,
    orderId: order.id,
    amount: Number(payment.amount),
    currency: (payment as any).currency ?? 'UAH',
    txHash: payment.txHash ?? null,
    completedAt: (payment.completedAt ?? payment.createdAt).toISOString?.() || new Date(payment.completedAt ?? payment.createdAt).toISOString(),
  };
  const receiptHash = sha256Hex(canonicalJson(receiptPayload));
  try {
    pdf.setTitle(`Receipt PAY-${payment.id}`);
    pdf.setSubject(`ReceiptHash:${receiptHash}`);
    pdf.setProducer('AutoAssist Web3');
    pdf.setCreator('AutoAssist Web3');
  } catch (_e) {
    // non-critical: metadata embedding failed
    void 0;
  }

  // Add tiny hash note on page (bottom margin) for transparency
  try {
    page.drawText(`ReceiptHash: ${receiptHash}`, { x: 40, y: 24, size: 8, font });
  } catch (_e) {
    // non-critical: footer annotation failed
    void 0;
  }

  const pdfBytes = await pdf.save();

  // Upload to MinIO (or skip in test mode)
  const filename = `receipt_order-${order.id}_payment-${payment.id}.pdf`;
  const disableUpload = process.env.DISABLE_RECEIPT_UPLOAD === '1' || process.env.NODE_ENV === 'test';
  let objectKey: string;
  if (disableUpload) {
    // In tests, avoid external MinIO dependency; just mark a pseudo objectKey
    objectKey = `test/${filename}`;
  } else {
    await ensureBucket(ATTACH_BUCKET);
    objectKey = buildObjectKey(order.id, filename);
    await minio.putObject(ATTACH_BUCKET, objectKey, Buffer.from(pdfBytes), pdfBytes.length, {
      'Content-Type': 'application/pdf',
    });
  }

  // Create Attachment & set Payment.receiptUrl
  const attachment = await prisma.attachment.create({
    data: {
      orderId: order.id,
      type: 'DOCUMENT',
      url: '', // deprecated direct URL; use presigned via endpoint
      filename,
      size: pdfBytes.length,
      meta: { kind: 'receipt', paymentId: payment.id },
      objectKey,
      contentType: 'application/pdf',
      status: 'ready',
    },
  });

  const urlPath = `/api/attachments/${attachment.id}/url`;
  await prisma.payment.update({ where: { id: payment.id }, data: { receiptUrl: urlPath } });
  await prisma.orderTimeline.create({
    data: {
      orderId: order.id,
      event: 'Receipt generated',
      details: { paymentId: payment.id, attachmentId: attachment.id },
    },
  });

  return { attachmentId: attachment.id, urlPath, receiptHash };
}
