import type { DiscountInput } from '@arabat/contracts';
import { type Discount, Money, MoneyError } from '@arabat/money';
import { PosRuleError } from './errors.js';

/** The currency of every sale (KWD, 3 decimals). */
export const POS_CURRENCY = 'KWD' as const;

/** "1.250" → 1250n fils; an invalid amount is `INVALID_PRICE` at `path`. */
export function parseAmount(value: string, path: string): bigint {
  try {
    return Money.parse(value, POS_CURRENCY).minor;
  } catch (error) {
    if (error instanceof MoneyError)
      throw new PosRuleError(400, 'INVALID_PRICE', 'Invalid amount.', [
        { path, code: 'invalid', message: 'Use up to 3 decimal places.' },
      ]);
    throw error;
  }
}

/** A discount as entered (contracts) → the pricing form (money). */
export function toDiscount(d: DiscountInput | null, path: string): Discount | null {
  if (!d) return null;
  return d.type === 'percent'
    ? { type: 'percent', percent: d.value }
    : { type: 'amount', amountMinor: parseAmount(d.value, path) };
}

export const abs = (v: bigint) => (v < 0n ? -v : v);
