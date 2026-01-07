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
  skipUpload?: boolean; // when true, do not touch storage/attachments; return pdfBytes instead
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
  const fontkitModule: any = await import('@pdf-lib/fontkit').catch(() => null);
  const fontkit: any = fontkitModule?.default ?? fontkitModule ?? null;
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
  if (fontkit) {
    pdf.registerFontkit(fontkit);
  }
  const page = pdf.addPage([595.28, 841.89]); // A4 portrait
  const { width, height } = page.getSize();
  const margin = 26;
  if (!fontkit) {
    throw new Error('Fontkit is required to embed Unicode fonts for receipts');
  }

  const fontDir = process.env.RECEIPT_FONT_DIR || path.resolve(process.cwd(), 'assets');
  const fontPath = process.env.RECEIPT_FONT_PATH || path.resolve(fontDir, 'NotoSans-Regular.ttf');
  const fontBoldPath = process.env.RECEIPT_FONT_BOLD_PATH || path.resolve(fontDir, 'NotoSans-Bold.ttf');
  let font: any;
  let fontBold: any;
  const [fontBytes, fontBoldBytes] = await Promise.all([
    fs.readFile(fontPath),
    fs.readFile(fontBoldPath),
  ]).catch((err) => {
    throw new Error(`Receipt fonts not found. Expected at ${fontPath} and ${fontBoldPath}. Original: ${err?.message || err}`);
  });

  pdf.registerFontkit(fontkit);
  font = await pdf.embedFont(fontBytes, { subset: true });
  fontBold = await pdf.embedFont(fontBoldBytes, { subset: true });

  const issuer = opts.issuerName || process.env.RECEIPT_ISSUER || 'AutoAssist Web3';
  const title = 'Payment Receipt';
  const colors = {
    ink: rgb(0.07, 0.09, 0.13),
    sub: rgb(0.38, 0.42, 0.47),
    border: rgb(0.86, 0.89, 0.93),
    soft: rgb(0.97, 0.99, 1),
    accent: rgb(0.18, 0.46, 0.96),
    accentSoft: rgb(0.9, 0.95, 1),
    page: rgb(0.985, 0.99, 0.995),
  };
  const stroke = 0.8;

  // Background wash
  page.drawRectangle({ x: 0, y: 0, width, height, color: colors.page });

  const labelSize = 8.25;
  const valueSize = 9.5;
  const lineGap = 10;
  const cardGap = 8;

  const wrapText = (text: string, maxWidth: number, size: number) => {
    const spaceSplit = String(text || '').split(' ');
    const lines: string[] = [];
    let current = '';

    const pushLine = () => {
      if (current) {
        lines.push(current);
        current = '';
      }
    };

    const breakLongWord = (word: string) => {
      const maxChars = Math.max(1, Math.floor(maxWidth / (size * 0.52)));
      for (let i = 0; i < word.length; i += maxChars) {
        const chunk = word.slice(i, i + maxChars);
        if (!current) {
          current = chunk;
        } else if ((current.length + 1 + chunk.length) * size * 0.52 > maxWidth) {
          pushLine();
          current = chunk;
        } else {
          current = `${current} ${chunk}`;
        }
      }
    };

    for (const word of spaceSplit) {
      // If a single word is too long to fit, break it into chunks
      const estimated = word.length * size * 0.52;
      if (estimated > maxWidth) {
        breakLongWord(word);
        continue;
      }

      const next = current ? `${current} ${word}` : word;
      const widthGuess = next.length * size * 0.52;
      if (widthGuess > maxWidth && current) {
        pushLine();
        current = word;
      } else {
        current = next;
      }
    }

    pushLine();
    return lines;
  };

  const measureRowHeight = (value: string, maxWidth: number) => {
    const lines = wrapText(value, maxWidth, valueSize);
    return Math.max(lineGap, lines.length * lineGap);
  };

  const drawRow = (label: string, value: string, x: number, yPos: number, maxWidth: number) => {
    page.drawText(label, { x, y: yPos, size: labelSize, font, color: colors.sub });
    const lines = wrapText(value, maxWidth, valueSize);
    let cursor = yPos;
    if (!lines.length) return lineGap;
    page.drawText(lines[0], { x: x + 82, y: cursor, size: valueSize, font, color: colors.ink });
    cursor -= lineGap;
    for (const line of lines.slice(1)) {
      page.drawText(line, { x: x + 82, y: cursor, size: valueSize, font, color: colors.ink });
      cursor -= lineGap;
    }
    return yPos - cursor;
  };

  const drawCard = (titleText: string, rows: Array<{ label: string; value: string }>, minHeight = 110) => {
    const cardPadding = 9;
    const innerWidth = width - margin * 2 - cardPadding * 2;
    const contentHeight = rows.reduce((acc, row) => acc + measureRowHeight(row.value, innerWidth - 120), 0);
    const cardHeight = Math.max(minHeight, cardPadding * 2 + 18 + contentHeight);
    const cardY = currentY - cardHeight;
    page.drawRectangle({
      x: margin,
      y: cardY,
      width: width - margin * 2,
      height: cardHeight,
      color: colors.soft,
      borderColor: colors.border,
      borderWidth: stroke,
      opacity: 0.98,
    });
    page.drawText(titleText, { x: margin + cardPadding, y: currentY - cardPadding - 6, size: 13, font: fontBold, color: colors.ink });
    let cursorY = currentY - cardPadding - 24;
    for (const row of rows) {
      const consumed = drawRow(row.label, row.value, margin + cardPadding, cursorY, innerWidth - 120);
      cursorY -= consumed;
    }
    currentY = cardY - cardGap;
  };

  const drawCardColumns = (
    titleText: string,
    left: Array<{ label: string; value: string }>,
    right: Array<{ label: string; value: string }>,
    minHeight = 110,
  ) => {
    const cardPadding = 9;
    const innerWidth = width - margin * 2 - cardPadding * 2;
    const colWidth = (innerWidth - 18) / 2;
    const leftHeight = left.reduce((acc, row) => acc + measureRowHeight(row.value, colWidth - 90), 0);
    const rightHeight = right.reduce((acc, row) => acc + measureRowHeight(row.value, colWidth - 90), 0);
    const contentHeight = Math.max(leftHeight, rightHeight);
    const cardHeight = Math.max(minHeight, cardPadding * 2 + 18 + contentHeight);
    const cardY = currentY - cardHeight;
    page.drawRectangle({
      x: margin,
      y: cardY,
      width: width - margin * 2,
      height: cardHeight,
      color: colors.soft,
      borderColor: colors.border,
      borderWidth: stroke,
      opacity: 0.98,
    });
    page.drawText(titleText, { x: margin + cardPadding, y: currentY - cardPadding - 6, size: 13, font: fontBold, color: colors.ink });
    let leftY = currentY - cardPadding - 24;
    for (const row of left) {
      const consumed = drawRow(row.label, row.value, margin + cardPadding, leftY, colWidth - 90);
      leftY -= consumed;
    }
    let rightY = currentY - cardPadding - 24;
    for (const row of right) {
      const consumed = drawRow(row.label, row.value, margin + cardPadding + colWidth + 18, rightY, colWidth - 90);
      rightY -= consumed;
    }
    currentY = cardY - cardGap;
  };

  // Hero
  const heroHeight = 130;
  const heroY = height - margin - heroHeight;
  page.drawRectangle({
    x: margin,
    y: heroY,
    width: width - margin * 2,
    height: heroHeight,
    color: colors.soft,
    borderColor: colors.border,
    borderWidth: stroke,
  });
  // QR side rail
  const railWidth = 160;
  page.drawRectangle({
    x: width - margin - railWidth,
    y: heroY,
    width: railWidth,
    height: heroHeight,
    color: colors.accent,
    opacity: 0.06,
  });
  page.drawText(issuer, { x: margin + 18, y: heroY + heroHeight - 28, size: 11, font, color: colors.sub });
  page.drawText(title, { x: margin + 18, y: heroY + heroHeight - 56, size: 22, font: fontBold, color: colors.ink });

  // QR and badge
  const qrImage = await pdf.embedPng(qrPngBuffer);
  const qrDim = 120;
  const qrPad = 14;
  const qrBoxX = width - margin - railWidth + 16;
  const qrBoxY = heroY + heroHeight - qrDim - qrPad - 8;

  // QR container
  page.drawRectangle({
    x: qrBoxX,
    y: qrBoxY,
    width: qrDim + qrPad * 2,
    height: qrDim + qrPad * 2,
    color: colors.soft,
    borderColor: colors.border,
    borderWidth: stroke,
  });

  // QR image centered in the container
  page.drawImage(qrImage, {
    x: qrBoxX + qrPad,
    y: qrBoxY + qrPad,
    width: qrDim,
    height: qrDim,
  });

  // Note under QR
  const note = 'Scan to verify on blockchain or view payment page';
  const noteLines = wrapText(note, railWidth - 28, 9);
  let noteY = qrBoxY - 14;
  for (const line of noteLines) {
    page.drawText(line, { x: qrBoxX, y: noteY, size: 9, font, color: colors.sub });
    noteY -= 11;
  }

  const badge = `${payment.status || 'pending'}`.toUpperCase();
  page.drawRectangle({
    x: margin + 16,
    y: heroY + heroHeight - 84,
    width: 102,
    height: 18,
    color: colors.accentSoft,
    borderColor: colors.border,
    borderWidth: stroke,
  });
  page.drawText(badge, { x: margin + 24, y: heroY + heroHeight - 78, size: 9.5, font: fontBold, color: colors.accent });

  page.drawText(`Receipt PAY-${payment.id} • Order #${order.id}`, {
    x: margin + 18,
    y: heroY + heroHeight - 108,
    size: 13.5,
    font: fontBold,
    color: colors.ink,
  });
  page.drawText(
    `Amount ${Number(payment.amount).toFixed(2)} ${(payment as any).currency ?? 'UAH'} • Method ${String(payment.method || 'n/a')} • ${String(payment.provider || 'n/a')}`,
    {
      x: margin + 18,
      y: heroY + heroHeight - 126,
      size: 11,
      font,
      color: colors.sub,
    },
  );

  let currentY = heroY - 20;

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

  // Payment details card (two columns)
  drawCardColumns(
    'Payment summary',
    [
      { label: 'Receipt', value: `PAY-${payment.id}` },
      { label: 'Date', value: new Date(payment.completedAt ?? payment.createdAt).toLocaleString() },
      { label: 'Status', value: String(payment.status || 'n/a') },
      { label: 'Tx hash', value: payment.txHash || 'n/a' },
    ],
    [
      { label: 'Amount', value: `${Number(payment.amount).toFixed(2)} ${(payment as any).currency ?? 'UAH'}` },
      { label: 'Method', value: String(payment.method || 'n/a') },
      { label: 'Provider', value: String(payment.provider || 'n/a') },
      { label: 'Provider ID', value: payment.providerId ? String(payment.providerId) : 'n/a' },
    ],
    130,
  );

  // Order & service card
  const issueText = order.description ? String(order.description) : 'n/a';
  const pickupText = pickup ? String(pickup.address ?? `${pickup.lat}, ${pickup.lng}`) : 'n/a';
  const serviceText = order.serviceCenter?.name ? String(order.serviceCenter.name) : 'n/a';
  drawCardColumns(
    'Order & service',
    [
      { label: 'Status', value: String(order.status || 'n/a') },
      { label: 'Category', value: String(order.category || 'n/a') },
      { label: 'Priority', value: String(order.priority || 'n/a') },
      { label: 'Issue', value: issueText },
    ],
    [
      { label: 'Service center', value: serviceText },
      { label: 'Pickup', value: pickupText },
      { label: 'Order ID', value: String(order.id) },
    ],
    130,
  );

  // Client & vehicle card
  drawCardColumns(
    'Client & vehicle',
    [
      { label: 'Client', value: client ? `${client.name} (${client.email ?? client.phone ?? 'n/a'})` : 'n/a' },
      { label: 'Phone', value: client?.phone ?? 'n/a' },
      { label: 'Email', value: client?.email ?? 'n/a' },
    ],
    [
      { label: 'Vehicle', value: vehicle ? `${vehicle.plate} ${vehicle.make ?? ''} ${vehicle.model ?? ''}`.trim() : 'n/a' },
      { label: 'VIN', value: vehicle?.vin ? String(vehicle.vin) : 'n/a' },
    ],
    120,
  );

  // Estimate card + breakdown
  const estimateRows: Array<{ label: string; value: string }> = [];
  if (estimate) {
    estimateRows.push({ label: 'Approved', value: estimate.approved ? 'Yes' : 'Pending' });
    estimateRows.push({ label: 'Total', value: `${estimateTotal != null ? estimateTotal.toFixed(2) : 'n/a'} ${estimateCurrency}` });
    if (estimateProfile) estimateRows.push({ label: 'Profile', value: String(estimateProfile) });
    if (estimateMeta?.summary) estimateRows.push({ label: 'Summary', value: String(estimateMeta.summary) });
    if (estimateMeta?.baseParts != null) estimateRows.push({ label: 'Base parts', value: Number(estimateMeta.baseParts).toFixed(2) });
    if (estimateMeta?.laborRate != null) estimateRows.push({ label: 'Labor rate', value: Number(estimateMeta.laborRate).toFixed(2) });
    if (estimateMeta?.coeffParts) estimateRows.push({ label: 'Parts coeff', value: Number(estimateMeta.coeffParts).toFixed(2) });
    if (estimateMeta?.coeffLabor) estimateRows.push({ label: 'Labor coeff', value: Number(estimateMeta.coeffLabor).toFixed(2) });
  } else {
    estimateRows.push({ label: 'Status', value: 'No estimate' });
  }
  drawCard('Estimate', estimateRows, 108);

  if (items.length || laborLines.length) {
    const rows = [...items, ...laborLines].slice(0, 6);
    const cardPadding = 8;
    const tableWidth = width - margin * 2 - cardPadding * 2;
    const rowHeight = 11;
    const tableHeight = rowHeight * (rows.length + 1) + 10;
    const cardHeight = tableHeight + cardPadding * 2 + 16;
    const cardY = currentY - cardHeight;
    page.drawRectangle({
      x: margin,
      y: cardY,
      width: width - margin * 2,
      height: cardHeight,
      color: colors.soft,
      borderColor: colors.border,
      borderWidth: stroke,
    });
    page.drawText('Breakdown', { x: margin + cardPadding, y: currentY - cardPadding - 6, size: 13, font: fontBold, color: colors.ink });
    let tableY = currentY - cardPadding - 26;
    page.drawRectangle({
      x: margin + cardPadding,
      y: tableY - tableHeight + 6,
      width: tableWidth,
      height: tableHeight,
      borderColor: colors.border,
      borderWidth: stroke,
    });
    const headerY = tableY - 2;
    page.drawText('Item', { x: margin + cardPadding + 10, y: headerY, size: 9.5, font: fontBold, color: colors.sub });
    page.drawText('Amount', { x: margin + cardPadding + tableWidth - 90, y: headerY, size: 9.5, font: fontBold, color: colors.sub });
    tableY = headerY - rowHeight;
    for (const it of rows) {
      const name = (it as any).name || (it as any).title || (it as any).partNo || 'Item';
      const qty = (it as any).qty ?? (it as any).quantity ?? (it as any).hours ?? 1;
      const price =
        (it as any).total ??
        (it as any).amount ??
        (it as any).price ??
        (it as any).unitPrice ??
        ((it as any).rate ? Number(qty) * Number((it as any).rate) : 0);
      page.drawText(`${name} x${qty}`, { x: margin + cardPadding + 10, y: tableY, size: 9.5, font, color: colors.ink });
      page.drawText(`${Number(price).toFixed(2)}`, { x: margin + cardPadding + tableWidth - 90, y: tableY, size: 9.5, font: fontBold, color: colors.ink });
      tableY -= rowHeight;
    }
    currentY = cardY - cardGap;
  }

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

  // Footer at bottom of first page
  try {
    const footerLines = wrapText(`ReceiptHash: ${receiptHash}`, width - margin * 2 - 4, 9);
    let fy = margin; // small offset from bottom
    for (const line of footerLines) {
      page.drawText(line, { x: margin, y: fy, size: 9, font, color: colors.sub });
      fy += 11;
    }
    page.drawText(`Generated: ${new Date().toISOString()}`, { x: margin, y: fy, size: 9, font, color: colors.sub });
  } catch (_e) {
    // non-critical: footer annotation failed
    void 0;
  }

  const pdfBytes = await pdf.save();

  // Upload to MinIO (or skip in test mode)
  if (opts.skipUpload) {
    return { pdfBytes, receiptHash };
  }

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
