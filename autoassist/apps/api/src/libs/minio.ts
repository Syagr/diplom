import { Client } from 'minio';
import { randomUUID } from 'node:crypto';

export const minio = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
});

export const ATTACH_BUCKET = process.env.MINIO_BUCKET || 'attachments';

export async function ensureBucket() {
  const exists = await minio.bucketExists(ATTACH_BUCKET).catch(() => false);
  if (!exists) await minio.makeBucket(ATTACH_BUCKET, '');
}

export const buildObjectKey = (orderId: number, fileName: string) => {
  const ext = fileName.includes('.') ? fileName.split('.').pop() : 'bin';
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `orders/${orderId}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
};