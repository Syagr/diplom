import { ZodError } from 'zod';
import type { ZodIssue } from 'zod';

export type UaErrorDetail = { field: string; message: string };

function issueToUa(i: ZodIssue): UaErrorDetail {
  const path = i.path?.join('.') || '';
  const code = i.code;
  // Базовое покрытие распространённых случаев
  if (code === 'invalid_type') {
    return { field: path, message: 'Невірний тип даних' };
  }
  if (code === 'invalid_string') {
    if ((i as any).validation === 'email') {
      return { field: path, message: 'Невірна електронна адреса' };
    }
    return { field: path, message: 'Невірний рядок' };
  }
  if (code === 'too_small') {
    const m = (i as any).minimum;
    return { field: path, message: `Мінімальна довжина ${m} символів` };
  }
  if (code === 'too_big') {
    const m = (i as any).maximum;
    return { field: path, message: `Максимальна довжина ${m} символів` };
  }
  if (code === 'invalid_enum_value') {
    return { field: path, message: 'Невірне значення' };
  }
  return { field: path, message: i.message || 'Некоректні дані' };
}

export function zodToUa(e: ZodError) {
  return {
    message: 'Помилка валідації',
    details: e.issues.map(issueToUa),
  };
}
