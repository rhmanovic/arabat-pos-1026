import { divideHalfUp } from './decimal.js';

/**
 * Stock quantities are exact decimals with 3 fraction digits (e.g. "1.250" kg), handled as
 * bigint thousandths ("milli-units"). PostgreSQL stores them as numeric(14,3).
 */
export const QUANTITY_SCALE = 3;
const QUANTITY_PATTERN = /^(-)?(\d{1,11})(?:\.(\d{1,3}))?$/;

export class QuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuantityError';
  }
}

/** Parses "12", "1.5", "-0.250" into milli-units. Rejects more than 3 decimals (never rounds). */
export function parseQuantity(value: string): bigint {
  const match = QUANTITY_PATTERN.exec(value.trim());
  if (!match) throw new QuantityError(`Invalid quantity: "${value}"`);
  const [, sign, intPart = '0', frac = ''] = match;
  const milli = BigInt(intPart) * 1000n + BigInt(frac.padEnd(3, '0'));
  return sign ? -milli : milli;
}

/** Formats milli-units as a decimal string with exactly 3 fraction digits ("1.250"). */
export function formatQuantity(milli: bigint): string {
  const negative = milli < 0n;
  const abs = negative ? -milli : milli;
  const body = `${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
  return negative && abs !== 0n ? `-${body}` : body;
}

/** Value of a quantity at a unit cost (minor units), rounded half-up to the minor unit. */
export function quantityValue(milli: bigint, unitCostMinor: bigint): bigint {
  return divideHalfUp(milli * unitCostMinor, 1000n);
}

/**
 * Moving weighted-average unit cost after receiving `inMilli` at `inCostMinor`
 * (BR-061). When the current balance is zero or negative, or has no known cost, the
 * new cost replaces it. Rounded half-up to the minor unit.
 */
export function weightedAverageCost(
  onHandMilli: bigint,
  currentAvgMinor: bigint | null,
  inMilli: bigint,
  inCostMinor: bigint,
): bigint {
  if (inMilli <= 0n) throw new QuantityError('Received quantity must be positive');
  if (onHandMilli <= 0n || currentAvgMinor === null) return inCostMinor;
  const total = onHandMilli * currentAvgMinor + inMilli * inCostMinor;
  return divideHalfUp(total, onHandMilli + inMilli);
}

/**
 * Average cost at micro precision (10⁻⁶ KWD per unit, i.e. thousandths of a fils; BR-174).
 * The moving average is carried this way so low-value units (grams, millilitres) keep their
 * cost; it is rounded to the fils only for display (`microToMinor`).
 */
export const MICRO_PER_MINOR = 1000n;

export function microToMinor(micro: bigint): bigint {
  return divideHalfUp(micro, MICRO_PER_MINOR);
}

/** Value of a quantity at a micro unit cost, rounded half-up to the minor unit. */
export function quantityValueMicro(milli: bigint, unitCostMicro: bigint): bigint {
  return divideHalfUp(milli * unitCostMicro, 1000n * MICRO_PER_MINOR);
}

/**
 * Moving weighted-average cost at micro precision after receiving `inMilli` at `inCostMicro`
 * (BR-061, BR-174). A negative balance keeps its cost basis: the receipt first absorbs the
 * negative units at their recorded average, so value stays equal to the sum of movement values
 * (FND-204). While the balance would stay negative the previous average is kept; with no
 * known cost the incoming cost is adopted.
 */
export function weightedAverageCostMicro(
  onHandMilli: bigint,
  currentAvgMicro: bigint | null,
  inMilli: bigint,
  inCostMicro: bigint,
): bigint {
  if (inMilli <= 0n) throw new QuantityError('Received quantity must be positive');
  if (currentAvgMicro === null || onHandMilli === 0n) return inCostMicro;
  const after = onHandMilli + inMilli;
  if (after <= 0n) return currentAvgMicro;
  const total = onHandMilli * currentAvgMicro + inMilli * inCostMicro;
  const avg = divideHalfUp(total, after);
  return avg < 0n ? inCostMicro : avg;
}
