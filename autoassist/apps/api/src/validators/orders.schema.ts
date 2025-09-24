import { z } from 'zod';

export const GetOrdersQuery = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().default(10),
  category: z.string().optional(),
});

export const OrderIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

export const UpdateOrderStatusBody = z.object({
  status: z.string().min(1),
});

export type UpdateOrderStatusBody = z.infer<typeof UpdateOrderStatusBody>;
