import { z } from 'zod';

export const CreateEstimateBody = z.object({
  orderId: z.coerce.number().int().positive(),
  providerId: z.coerce.number().int().positive(),
  lines: z.array(z.object({ description: z.string().min(1), amount: z.number().nonnegative() })),
  total: z.number().nonnegative(),
});

export const EstimateIdParam = z.object({ id: z.coerce.number().int().positive() });

export type CreateEstimateBody = z.infer<typeof CreateEstimateBody>;
