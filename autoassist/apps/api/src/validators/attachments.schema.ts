import { z } from 'zod';

export const AllowedContentTypes = [
  'image/jpeg','image/png','image/webp','image/heic',
  'video/mp4','application/pdf'
] as const;

export const PresignUploadBody = z.object({
  orderId: z.number().int().positive(),
  fileName: z.string().min(1),
  contentType: z.enum(AllowedContentTypes),
  size: z.number().int().positive().max(25 * 1024 * 1024), // ≤ 25MB
  kind: z.enum(['photo','video','doc']).default('photo'),
  meta: z.record(z.any()).optional(),
});

export type PresignUploadBody = z.infer<typeof PresignUploadBody>;

export const PresignDownloadParams = z.object({
  id: z.string(), // using string coercion; current model uses Int — we coerce in routes
});

export const AttachmentIdParam = z.object({ id: z.coerce.number().int().positive() });

export type AttachmentIdParam = z.infer<typeof AttachmentIdParam>;
