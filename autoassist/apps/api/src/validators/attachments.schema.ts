// validators/attachments.schema.ts
import { z } from 'zod';

/** Максимальный размер файла (байты) — берём из ENV, по умолчанию 25 МБ */
const MAX_SIZE_MB = Number(process.env.ATTACH_MAX_SIZE_MB ?? 25);
export const MAX_SIZE_BYTES = Math.max(1, MAX_SIZE_MB) * 1024 * 1024;

/** Строгий список допустимых MIME */
export const AllowedContentTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic', // iOS иногда так
  'image/heif', // а иногда так
  'video/mp4',
  'application/pdf',
] as const;

/** Хелпер для z.enum по readonly tuple */
type TupleToUnion<T extends readonly string[]> = T[number];
type AllowedContentType = TupleToUnion<typeof AllowedContentTypes>;

export const FileKind = ['photo', 'video', 'doc', 'audio'] as const;
export type FileKind = typeof FileKind[number];

/** Валидируем имя файла (без путей и управляющих, разумная длина) */
const fileNameSchema = z
  .string()
  .min(1, 'File name is required')
  .max(255, 'File name is too long')
  .refine((s) => !/[\\\/]/.test(s), 'File name must not contain slashes')
  .refine((s) => !/[\u0000-\u001F\u007F]/.test(s), 'File name contains invalid characters');

/** Тело для presign upload */
export const PresignUploadBody = z.object({
  orderId: z.coerce.number().int().positive(),
  fileName: fileNameSchema,
  contentType: z.enum(AllowedContentTypes as unknown as [AllowedContentType, ...AllowedContentType[]]),
  size: z.coerce.number().int().positive().max(MAX_SIZE_BYTES), // ≤ ENV MB
  kind: z.enum(FileKind as unknown as [FileKind, ...FileKind[]]).default('photo'),
  /** свободные метаданные — чистим undefined, оставляем только JSON-сериализуемое */
  meta: z
    .record(z.any())
    .optional()
    .transform((m) => {
      if (!m || typeof m !== 'object') return undefined;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m)) if (v !== undefined) out[k] = v;
      return Object.keys(out).length ? out : undefined;
    }),
});

export type PresignUploadBody = z.infer<typeof PresignUploadBody>;

/** Параметр id вложения (для download/remove и т.п.) */
export const AttachmentIdParam = z.object({
  id: z.coerce.number().int().positive(),
});
export type AttachmentIdParam = z.infer<typeof AttachmentIdParam>;
