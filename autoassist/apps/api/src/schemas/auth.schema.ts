import { z } from 'zod';

// helpers
const email = z.string()
  .trim()
  .toLowerCase()
  .email('Невірний email')
  .max(254, 'Занадто довгий email');

const name = z.string()
  .trim()
  .min(1, 'Імʼя не може бути порожнім')
  .max(80, 'Занадто довге імʼя')
  .optional();

const password = z.string()
  .min(8, 'Мінімум 8 символів')
  .max(128, 'Занадто довгий пароль')
  .refine((v) => /\d/.test(v), 'Пароль має містити цифру')
  .refine((v) => /[A-Z]/.test(v), 'Пароль має містити велику літеру')
  .refine((v) => /[a-z]/.test(v), 'Пароль має містити малу літеру')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Додайте спецсимвол');

export const registerSchema = z.object({
  email,
  password,
  name,
  // опційно:
  // passwordConfirm: z.string(),
  // termsAccepted: z.literal(true, { errorMap: () => ({ message: 'Потрібна згода з умовами' }) }),
})
// якщо додасте passwordConfirm — розкоментуйте це:
// .refine((data) => data.password === data.passwordConfirm, {
//   message: 'Паролі не співпадають',
//   path: ['passwordConfirm'],
// });

export type RegisterInput = z.infer<typeof registerSchema>;
