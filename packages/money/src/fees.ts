import { divideHalfUp, parseDecimal, pow10 } from './decimal.js';

export type FeeType = 'none' | 'fixed' | 'percentage' | 'fixed_plus_percentage';

export interface FeeRule {
  type: FeeType;
  /** Fixed fee per payment in minor units (fils). */
  fixedMinor: bigint;
  /** Percentage as an exact decimal string, e.g. "2.5" = 2.5 % (max 3 decimals). */
  percent: string;
}

export const MAX_FEE_PERCENT_DECIMALS = 3;

/**
 * Processing fee for one payment (BR-071): fixed part + percentage of the amount rounded
 * half-up to the minor unit. Never negative and never more than the amount itself; a zero
 * or negative amount has no fee. Exact bigint arithmetic only.
 */
export function processingFee(amountMinor: bigint, rule: FeeRule): bigint {
  if (amountMinor <= 0n || rule.type === 'none') return 0n;
  let fee = 0n;
  if (rule.type === 'fixed' || rule.type === 'fixed_plus_percentage') fee += rule.fixedMinor;
  if (rule.type === 'percentage' || rule.type === 'fixed_plus_percentage') {
    const { units, scale } = parseDecimal(rule.percent);
    if (units < 0n || scale > MAX_FEE_PERCENT_DECIMALS) throw new RangeError('Invalid fee percent');
    fee += divideHalfUp(amountMinor * units, pow10(scale) * 100n);
  }
  if (fee < 0n) return 0n;
  return fee > amountMinor ? amountMinor : fee;
}
