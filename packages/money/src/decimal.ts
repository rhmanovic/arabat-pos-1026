/**
 * Exact decimal helpers built on bigint. No floating-point arithmetic is used.
 */

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;

/** A decimal value represented as `units / 10^scale`. */
export interface ScaledDecimal {
  units: bigint;
  scale: number;
}

export class InvalidDecimalError extends Error {
  constructor(value: string) {
    super(`Invalid decimal value: "${value}"`);
    this.name = 'InvalidDecimalError';
  }
}

/** Parses a plain decimal string such as "1.250", "-3", "0.5" into an exact scaled integer. */
export function parseDecimal(value: string): ScaledDecimal {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) throw new InvalidDecimalError(value);
  const [, sign, intPart = '0', fracPart = ''] = match;
  const units = BigInt(intPart + fracPart);
  return { units: sign === '-' ? -units : units, scale: fracPart.length };
}

export function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0) {
    throw new RangeError(`Exponent must be a non-negative integer, got ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

/**
 * Integer division rounding half away from zero ("commercial" half-up, BR-033).
 * Examples: 5/2 → 3, -5/2 → -3, 4/3 → 1.
 */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Formats `units / 10^scale` as a plain decimal string with exactly `scale` fraction digits. */
export function formatScaled(units: bigint, scale: number): string {
  const negative = units < 0n;
  const abs = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const intPart = abs.slice(0, abs.length - scale);
  const fracPart = abs.slice(abs.length - scale);
  const body = scale > 0 ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${body}` : body;
}
