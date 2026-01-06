// src/libs/minio.ts
import { Client } from 'minio';
import { randomUUID } from 'node:crypto';

function bool(v: string | undefined, def = false) {
  if (v == null) return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '127.0.0.1';
const MINIO_PORT = Number(process.env.MINIO_PORT || 9000);
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'minioadmin';
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'minioadmin';
const MINIO_USE_SSL = bool(process.env.MINIO_USE_SSL, false);
const MINIO_PUBLIC_ENDPOINT = process.env.MINIO_PUBLIC_ENDPOINT;
export const ATTACH_BUCKET =
  process.env.MINIO_ATTACH_BUCKET || 'attachments';

export const minio = new Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY,
});

function buildPublicClient(): Client | null {
  if (!MINIO_PUBLIC_ENDPOINT) return null;
  try {
    const url = MINIO_PUBLIC_ENDPOINT.includes('://')
      ? new URL(MINIO_PUBLIC_ENDPOINT)
      : new URL(`http://${MINIO_PUBLIC_ENDPOINT}`);
    const useSSL = url.protocol === 'https:';
    const port = url.port ? Number(url.port) : useSSL ? 443 : 80;
    return new Client({
      endPoint: url.hostname,
      port,
      useSSL,
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    });
  } catch {
    return null;
  }
}

const publicMinio = buildPublicClient();

export async function ensureBucket(bucket = ATTACH_BUCKET): Promise<void> {
  const exists = await minio.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await minio.makeBucket(bucket, '');
  }
}

export function buildObjectKey(orderId: number, fileName?: string): string {
  const safe = (fileName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  const id = randomUUID();
  return `orders/${orderId}/${Date.now()}_${id}_${safe}`;
}

// presign helpers
export async function presignPut(
  bucket: string,
  objectKey: string,
  expiresSec = 300 // 5 min
): Promise<string> {
  const client = publicMinio ?? minio;
  return client.presignedPutObject(bucket, objectKey, expiresSec);
}

export async function presignGet(
  bucket: string,
  objectKey: string,
  expiresSec = 600 // 10 min
): Promise<string> {
  const client = publicMinio ?? minio;
  return client.presignedGetObject(bucket, objectKey, expiresSec);
}
