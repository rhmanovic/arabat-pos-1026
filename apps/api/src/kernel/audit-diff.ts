/**
 * Field-level before/after values for audit entries (BR-191, FND-105 / FND-208 / FND-620):
 * only the fields that changed, each as `{ from, to }`. Values are compared after a
 * normalisation that treats `undefined`, `null` and `''` alike and dates by their ISO text.
 */
export type FieldDiff = Record<string, { from: unknown; to: unknown }>;

function normal(v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'bigint') return v.toString();
  return v;
}

export function diffFields<T extends object>(
  before: Partial<Record<keyof T, unknown>>,
  after: Partial<Record<keyof T, unknown>>,
  keys: readonly (keyof T)[],
): FieldDiff {
  const out: FieldDiff = {};
  for (const key of keys) {
    const from = normal(before[key]);
    const to = normal(after[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) out[String(key)] = { from, to };
  }
  return out;
}

export const hasChanges = (diff: FieldDiff): boolean => Object.keys(diff).length > 0;
