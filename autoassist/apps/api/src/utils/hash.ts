// src/utils/hash.ts
import crypto from 'node:crypto';

export function canonicalJson(value: unknown): string {
  // Stable stringify: sort keys recursively
  const seen = new WeakSet();
  const normalize = (v: any): any => {
    if (v && typeof v === 'object') {
      if (seen.has(v)) return null; // avoid cycles
      seen.add(v);
      if (Array.isArray(v)) return v.map(normalize);
      const keys = Object.keys(v).sort();
      const out: Record<string, any> = {};
      for (const k of keys) out[k] = normalize(v[k]);
      return out;
    }
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null;
    }
    return v ?? null;
  };
  return JSON.stringify(normalize(value));
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
