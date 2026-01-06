// src/services/receipts.service.ts
import prisma from '@/utils/prisma.js';
import { minio, ATTACH_BUCKET, ensureBucket, buildObjectKey } from '@/libs/minio.js';
import { canonicalJson, sha256Hex } from '@/utils/hash.js';
import fs from 'node:fs/promises';
import path from 'node:path';
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
  const { PDFDocument, rgb } = pdfLib;
  const QRCode: any = (await import('qrcode')).default ?? (await import('qrcode'));
  const payment = await prisma.payment.findUnique({
    where: { id: Number(paymentId) },
    include: {
      order: {
        include: {
          client: true,
          vehicle: true,
          estimate: true,
          serviceCenter: true,
          locations: true,
        },
      },
    },
  });
  if (!payment || !payment.order) throw Object.assign(new Error('PAYMENT_NOT_FOUND'), { status: 404 });

  const order = payment.order;
  const client = order.client || null;
  const vehicle = order.vehicle || null;
  const estimate: any = (order as any).estimate || null;
  const estimateMeta = (estimate?.itemsJson as any)?.meta || (estimate?.laborJson as any)?.meta || {};
  const pickup = Array.isArray(order.locations)
    ? order.locations.find((loc: any) => loc.kind === 'pickup')
    : null;
  const estimateTotal = estimate?.total != null ? Number(estimate.total) : null;
  const estimateCurrency = estimate?.currency ?? (payment as any).currency ?? 'UAH';
  const estimateProfile = estimateMeta?.profile ?? null;

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
  const fontDir = process.env.RECEIPT_FONT_DIR || path.resolve(process.cwd(), 'assets');
  const fontPath = process.env.RECEIPT_FONT_PATH || path.join(fontDir, 'NotoSans-Regular.ttf');
  const fontBoldPath =
    process.env.RECEIPT_FONT_BOLD_PATH || path.join(fontDir, 'NotoSans-Bold.ttf');
  const [fontBytes, fontBoldBytes] = await Promise.all([
    fs.readFile(fontPath),
    fs.readFile(fontBoldPath),
  ]);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const fontBold = await pdf.embedFont(fontBoldBytes, { subset: true });

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

  const labelSize = 10;
  const valueSize = 11;
  const sectionSize = 12;
  const lineGap = 14;
  let y = height - margin - 70;

  const drawSection = (titleText: string) => {
    page.drawText(titleText, { x: margin, y, size: sectionSize, font: fontBold });
    y -= lineGap;
  };
  const drawLabel = (label: string, value: string, x: number) => {
    page.drawText(label, { x, y, size: labelSize, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(value, { x: x + 90, y, size: valueSize, font });
    y -= lineGap;
  };

  drawSection('Payment');
  drawLabel('Receipt', `PAY-${payment.id}`, margin);
  drawLabel('Date', new Date(payment.completedAt ?? payment.createdAt).toLocaleString(), margin);
  drawLabel('Amount', `${Number(payment.amount).toFixed(2)} ${((payment as any).currency ?? 'UAH')}`, margin);
  drawLabel('Method', String(payment.method || 'n/a'), margin);
  drawLabel('Provider', String(payment.provider || 'n/a'), margin);
  if (payment.providerId) drawLabel('Provider ID', String(payment.providerId), margin);
  drawLabel('Tx Hash', String(payment.txHash || 'n/a'), margin);
  y -= 6;

  drawSection('Order');
  drawLabel('Order ID', String(order.id), margin);
  drawLabel('Status', String(order.status || 'n/a'), margin);
  drawLabel('Category', String(order.category || 'n/a'), margin);
  drawLabel('Priority', String(order.priority || 'n/a'), margin);
  if (order.description) drawLabel('Issue', String(order.description), margin);
  if (pickup) drawLabel('Pickup', String(pickup.address ?? `${pickup.lat}, ${pickup.lng}`), margin);
  if (order.serviceCenter?.name) {
    drawLabel('Service', String(order.serviceCenter.name), margin);
  }
  y -= 6;

  drawSection('Client & Vehicle');
  drawLabel('Client', client ? `${client.name} (${client.email ?? client.phone ?? 'n/a'})` : 'n/a', margin);
  drawLabel('Vehicle', vehicle ? `${vehicle.plate} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim() : 'n/a', margin);
  if (vehicle?.vin) drawLabel('VIN', String(vehicle.vin), margin);
  y -= 6;

  drawSection('Estimate');
  if (estimate) {
    drawLabel('Approved', estimate.approved ? 'Yes' : 'Pending', margin);
    drawLabel('Total', `${estimateTotal != null ? estimateTotal.toFixed(2) : 'n/a'} ${estimateCurrency}`, margin);
    if (estimateProfile) drawLabel('Profile', String(estimateProfile), margin);
    if (estimateMeta?.summary) drawLabel('Summary', String(estimateMeta.summary), margin);
    if (estimateMeta?.coeffParts) drawLabel('Parts coeff', Number(estimateMeta.coeffParts).toFixed(2), margin);
    if (estimateMeta?.coeffLabor) drawLabel('Labor coeff', Number(estimateMeta.coeffLabor).toFixed(2), margin);
  } else {
    drawLabel('Status', 'No estimate', margin);
  }

  const items = Array.isArray(estimate?.itemsJson?.items)
    ? estimate.itemsJson.items
    : Array.isArray(estimate?.itemsJson?.parts)
      ? estimate.itemsJson.parts
      : [];
  const laborLines = Array.isArray(estimate?.laborJson?.lines)
    ? estimate.laborJson.lines
    : Array.isArray(estimate?.laborJson?.tasks)
      ? estimate.laborJson.tasks
      : [];

  if (items.length || laborLines.length) {
    y -= 4;
    page.drawText('Breakdown:', { x: margin, y, size: labelSize, font: fontBold });
    y -= lineGap;
    const maxLines = 6;
    const itemLines = items.slice(0, maxLines).map((it: any) => {
      const name = it.name || it.title || it.partNo || 'Item';
      const qty = it.qty ?? it.quantity ?? 1;
      const price = it.total ?? it.amount ?? it.price ?? it.unitPrice ?? 0;
      return `- ${name} x${qty} = ${Number(price).toFixed(2)}`;
    });
    for (const line of itemLines) {
      page.drawText(line, { x: margin + 10, y, size: labelSize, font });
      y -= lineGap;
    }
    const laborLinesOut = laborLines.slice(0, maxLines).map((it: any) => {
      const name = it.name || 'Labor';
      const hours = it.hours ?? 0;
      const rate = it.rate ?? 0;
      const totalVal = it.total ?? Number(hours) * Number(rate);
      return `- ${name}: ${hours}h x ${rate} = ${Number(totalVal).toFixed(2)}`;
    });
    for (const line of laborLinesOut) {
      page.drawText(line, { x: margin + 10, y, size: labelSize, font });
      y -= lineGap;
    }
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
  try {
    await prisma.auditEvent.create({
      data: {
        type: 'receipt:generated',
        payload: {
          paymentId: payment.id,
          orderId: order.id,
          attachmentId: attachment.id,
          amount: Number(payment.amount),
          currency: (payment as any).currency ?? 'UAH',
        },
      },
    });
  } catch (_e) {
    // Avoid failing receipt flow if audit table is missing or unavailable.
    void 0;
  }

  return { attachmentId: attachment.id, urlPath, receiptHash };
}
