import { Client } from 'minio';

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