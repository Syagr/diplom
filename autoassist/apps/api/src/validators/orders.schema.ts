// validators/orders.schema.ts
import { z } from 'zod';

/** Разрешённые статусы (синхронно с @prisma/client OrderStatus) */
export const ORDER_STATUSES = [
  'NEW',
  'TRIAGE',
  'QUOTE',
  'APPROVED',
  'SCHEDULED',
  'INSERVICE',
  'READY',
  'DELIVERED',
  'CLOSED',
  'CANCELLED',
] as const;
export type OrderStatusEnum = typeof ORDER_STATUSES[number];

/** Безопасные дефолты и капы для пагинации */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** Тримим строки, пустые -> undefined */
const optionalTrimmed = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string())
  .refine((s) => s.length > 0, { message: 'Empty string' })
  .optional()
  .transform((v) => (v === undefined ? undefined : v));

export const GetOrdersQuery = z
  .object({
    /** Статус можно не передавать; если передан — строго из списка */
    status: z.enum(ORDER_STATUSES).optional(),
    page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
    limit: z
      .coerce.number()
      .int()
      .positive()
      .max(MAX_LIMIT, { message: `Limit must be ≤ ${MAX_LIMIT}` })
      .default(DEFAULT_LIMIT),
    /** Категория у тебя строкой — нормализуем и разрешаем пустоту как undefined */
    category: optionalTrimmed,
    /** Дополнительно: сортировка (опционально) */
    sortBy: z.enum(['createdAt', 'updatedAt']).optional().default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .transform((q) => q); // сохраняем типы как есть

export const OrderIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const UpdateOrderStatusBody = z.object({
  status: z.enum(ORDER_STATUSES, {
    errorMap: () => ({ message: 'Invalid status' }),
  }),
});

export type GetOrdersQuery = z.infer<typeof GetOrdersQuery>;
export type OrderIdParam = z.infer<typeof OrderIdParam>;
export type UpdateOrderStatusBody = z.infer<typeof UpdateOrderStatusBody>;
