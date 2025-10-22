// utils/zod-ua.ts
import type { ZodIssue } from 'zod';
import { ZodError } from 'zod';

export type UaErrorDetail = { field: string; message: string };

type LabelMap = Record<string, string | undefined>;

/** Преобразует zod path в "a.b[0].c" */
function pathToString(path: (string | number)[]): string {
  if (!path || path.length === 0) return '';
  return path
    .map((seg, i) => (typeof seg === 'number' ? `[${seg}]` : (i > 0 && typeof path[i - 1] !== 'number' ? `.${seg}` : String(seg))))
    .join('')
    .replace(/^\./, '');
}

function labelOf(pathStr: string, labels?: LabelMap): string {
  return (labels && labels[pathStr]) || pathStr;
}

function issueToUa(i: ZodIssue, labels?: LabelMap): UaErrorDetail {
  const fieldPath = pathToString(i.path || []);
  const field = labelOf(fieldPath, labels);
  const code = i.code as string;

  // Частые свойства
  const min = (i as any).minimum ?? (i as any).inclusive === false ? ((i as any).minimum + 1) : (i as any).minimum;
  const max = (i as any).maximum ?? (i as any).inclusive === false ? ((i as any).maximum - 1) : (i as any).maximum;
  const exact = (i as any).exact;
  const keys = (i as any).keys as string[] | undefined;
  const received = (i as any).received;

  switch (code) {
    case 'invalid_type':
      if (received === 'undefined') return { field, message: 'Обовʼязкове поле' };
      return { field, message: 'Невірний тип даних' };

    case 'invalid_string': {
      const v = (i as any).validation as string | undefined;
      if (v === 'email') return { field, message: 'Невірна електронна адреса' };
      if (v === 'url') return { field, message: 'Невірна URL-адреса' };
      if (v === 'uuid') return { field, message: 'Невірний UUID' };
      if (v === 'regex') return { field, message: 'Рядок не відповідає формату' };
      if (v === 'datetime') return { field, message: 'Невірний формат дати/часу' };
      return { field, message: 'Невірний рядок' };
    }

    case 'too_small': {
      const type = (i as any).type as 'string' | 'array' | 'number' | 'date';
      const incl = (i as any).inclusive as boolean;
      if (type === 'string') {
        if ((i as any).exact) return { field, message: `Рівно ${exact} символів` };
        return { field, message: `Мінімальна довжина ${min} символів` };
      }
      if (type === 'array') {
        if ((i as any).exact) return { field, message: `Потрібно рівно ${exact} елементів` };
        return { field, message: `Мінімум ${min} елементів` };
      }
      if (type === 'number') {
        return { field, message: `Число має бути ${incl ? 'не менше' : 'більше'} ${min}` };
      }
      if (type === 'date') {
        return { field, message: 'Дата завелика у минулому' };
      }
      return { field, message: 'Занадто мале значення' };
    }

    case 'too_big': {
      const type = (i as any).type as 'string' | 'array' | 'number' | 'date';
      const incl = (i as any).inclusive as boolean;
      if (type === 'string') {
        if ((i as any).exact) return { field, message: `Рівно ${exact} символів` };
        return { field, message: `Максимальна довжина ${max} символів` };
      }
      if (type === 'array') {
        if ((i as any).exact) return { field, message: `Потрібно рівно ${exact} елементів` };
        return { field, message: `Не більше ${max} елементів` };
      }
      if (type === 'number') {
        return { field, message: `Число має бути ${incl ? 'не більше' : 'менше'} ${max}` };
      }
      if (type === 'date') {
        return { field, message: 'Дата занадто пізня' };
      }
      return { field, message: 'Занадто велике значення' };
    }

    case 'invalid_enum_value':
      return { field, message: 'Невірне значення' };

    case 'invalid_literal':
      return { field, message: 'Невірне фіксоване значення' };

    case 'unrecognized_keys':
      return { field, message: keys && keys.length ? `Невідомі поля: ${keys.join(', ')}` : 'Невідомі поля' };

    case 'custom':
      return { field, message: i.message || 'Некоректні дані' };

    case 'invalid_union':
      return { field, message: 'Дані не відповідають жодному з допустимих варіантів' };

    case 'invalid_union_discriminator':
      return { field, message: 'Невірний тип варіанту' };

    case 'invalid_date':
      return { field, message: 'Невірна дата' };

    case 'invalid_number':
      return { field, message: 'Потрібно число' };

    case 'not_multiple_of':
      return { field, message: `Число має бути кратним ${ (i as any).multipleOf }` };

    case 'invalid_boolean':
      return { field, message: 'Потрібно булеве значення' };

    case 'invalid_array':
      return { field, message: 'Потрібен масив' };

    default:
      // fallback — берём message от Zod, если есть
      return { field, message: i.message || 'Некоректні дані' };
  }
}

/** Основная функция: конвертировать ZodError в укр. форму */
export function zodToUa(e: ZodError, labels?: LabelMap) {
  return {
    message: 'Помилка валідації',
    details: e.issues.map((iss) => issueToUa(iss, labels)),
  };
}

/** Вернуть первое сообщение (удобно для тостів) */
export function firstError(e: ZodError, labels?: LabelMap): UaErrorDetail | null {
  const d = zodToUa(e, labels).details;
  return d.length ? d[0] : null;
}

/** Сгруппировать по полям: { field: [messages...] } */
export function byField(e: ZodError, labels?: LabelMap): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of zodToUa(e, labels).details) {
    if (!out[d.field]) out[d.field] = [];
    out[d.field].push(d.message);
  }
  return out;
}

/** Уникальный список ошибок (по field+message) */
export function flattenUnique(e: ZodError, labels?: LabelMap): UaErrorDetail[] {
  const seen = new Set<string>();
  const out: UaErrorDetail[] = [];
  for (const d of zodToUa(e, labels).details) {
    const k = `${d.field}::${d.message}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(d);
    }
  }
  return out;
}
