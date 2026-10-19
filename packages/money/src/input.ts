/**
 * Amounts as people type them (ADR-0112 amendment 3, the till's "Invalid amount" on `0.250`):
 * Arabic-Indic digits, a comma or the Arabic decimal separator instead of the point, thousands
 * marks, spaces, bidi marks and a currency word before or after the number. `normalizeAmountInput`
 * turns them into the plain decimal `Money.parse` and `parseQuantity` accept, and leaves anything
 * it cannot read for those to refuse.
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/** `"٠٫٢٥٠"` → `"0.250"`, `"0,250"` → `"0.250"`, `"1,250.500 KWD"` → `"1250.500"`. */
export function normalizeAmountInput(raw: string): string {
  let s = '';
  for (const ch of raw) {
    const a = ARABIC_INDIC.indexOf(ch);
    const e = EXTENDED_ARABIC_INDIC.indexOf(ch);
    s += a >= 0 ? String(a) : e >= 0 ? String(e) : ch;
  }
  s = s
    // Bidi marks and every kind of space.
    .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\s\u00a0\u202f]+/g, '')
    // Arabic decimal and thousands separators.
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, ',')
    // Letters and currency symbols around the number ("KWD", "د.ك", "فلس").
    .replace(/[\p{L}\p{Sc}]+/gu, '')
    // Points left behind by "د.ك" before or after the number.
    .replace(/\.+$/g, '')
    .replace(/^\.+(?=.*\.)/, '');
  // A comma is the decimal separator when it is the only one ("0,250"); next to a point it is a
  // thousands mark ("1,250.500").
  if (s.includes(',') && !s.includes('.')) {
    const last = s.lastIndexOf(',');
    s = `${s.slice(0, last).replace(/,/g, '')}.${s.slice(last + 1)}`;
  } else s = s.replace(/,/g, '');
  if (s.startsWith('.')) s = `0${s}`;
  if (s.startsWith('-.')) s = `-0${s.slice(1)}`;
  if (s.startsWith('+')) s = s.slice(1);
  return s;
}
