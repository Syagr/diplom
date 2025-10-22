// validators/estimates.schema.ts
import { z } from 'zod';

/** Коэрсия и нормализация валютного числа до двух знаков. */
const money = z.preprocess((v) => {
  if (typeof v === 'string') {
    // поддержим "123,45" из форм
    const s = v.replace(',', '.').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().finite().nonnegative())
.transform((n) => Math.round(n * 100) / 100);

const nonEmptyTrimmed = z.string().transform((s) => s.trim());

/** ----- Schemas ----- */

export const CreateEstimateBody = z.object({
  orderId: z.coerce.number().int().positive(),
  providerId: z.coerce.number().int().positive(),
  lines: z.array(
    z.object({
      description: nonEmptyTrimmed.min(1, 'Description is required').max(200, 'Description too long'),
      amount: money,
    })
  ).min(1, 'At least one line is required'),
  total: money,
})
.superRefine((val, ctx) => {
  const sum = val.lines.reduce((acc, l) => acc + l.amount, 0);
  const rounded = Math.round(sum * 100) / 100;
  const diff = Math.abs(rounded - val.total);
  if (diff > 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Total must equal sum of lines (${rounded.toFixed(2)})`,
      path: ['total'],
    });
  }
});

export const EstimateIdParam = z.object({
  id: z.coerce.number().int().positive(),
});

/** ----- Types ----- */
export type CreateEstimateBody = z.infer<typeof CreateEstimateBody>;
export type EstimateIdParam = z.infer<typeof EstimateIdParam>;
