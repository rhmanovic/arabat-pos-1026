import { type CurrencyCode, currencyExponent, isCurrencyCode } from './currency.js';
import {
  InvalidDecimalError,
  type ScaledDecimal,
  divideHalfUp,
  formatScaled,
  parseDecimal,
  pow10,
} from './decimal.js';

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** JSON wire format for money (ADR-0005, ADR-0012): never a JSON number. */
export interface MoneyJson {
  amount: string;
  currency: CurrencyCode;
}

/**
 * Immutable monetary amount stored as an integer number of minor units (e.g. fils).
 * All arithmetic is exact; rounding happens only where explicitly requested and
 * always uses half-away-from-zero (BR-033).
 */
export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static ofMinor(minor: bigint, currency: CurrencyCode): Money {
    if (typeof minor !== 'bigint') throw new MoneyError('Minor units must be a bigint');
    if (!isCurrencyCode(currency))
      throw new MoneyError(`Unsupported currency: ${String(currency)}`);
    return new Money(minor, currency);
  }

  static zero(currency: CurrencyCode): Money {
    return Money.ofMinor(0n, currency);
  }

  /**
   * Parses a decimal string ("1.250"). Rejects values with more fraction digits than the
   * currency allows instead of silently rounding user input.
   */
  static parse(amount: string, currency: CurrencyCode): Money {
    if (!isCurrencyCode(currency))
      throw new MoneyError(`Unsupported currency: ${String(currency)}`);
    const exponent = currencyExponent(currency);
    let parsed: ScaledDecimal;
    try {
      parsed = parseDecimal(amount);
    } catch (error) {
      if (error instanceof InvalidDecimalError) throw new MoneyError(`Invalid amount: "${amount}"`);
      throw error;
    }
    const { units, scale } = parsed;
    if (scale > exponent) {
      throw new MoneyError(
        `Amount "${amount}" has more than ${exponent} decimal places for ${currency}`,
      );
    }
    return new Money(units * pow10(exponent - scale), currency);
  }

  static fromJSON(json: MoneyJson): Money {
    return Money.parse(json.amount, json.currency);
  }

  get exponent(): number {
    return currencyExponent(this.currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  /** Multiplies by an exact decimal quantity (e.g. "1.500" kg), rounding to the minor unit. */
  multiply(quantity: string): Money {
    const { units, scale } = parseDecimal(quantity);
    return new Money(divideHalfUp(this.minor * units, pow10(scale)), this.currency);
  }

  /** Percentage of this amount, e.g. percentage("12.5") → 12.5 %, rounded to the minor unit. */
  percentage(percent: string): Money {
    const { units, scale } = parseDecimal(percent);
    return new Money(divideHalfUp(this.minor * units, pow10(scale) * 100n), this.currency);
  }

  /**
   * Splits the amount proportionally to integer weights without losing or creating a
   * single minor unit (largest-remainder method; ties go to the earliest share).
   */
  allocate(weights: readonly bigint[]): Money[] {
    if (weights.length === 0) throw new MoneyError('Allocation requires at least one weight');
    if (weights.some((w) => w < 0n)) throw new MoneyError('Allocation weights must be >= 0');
    const total = weights.reduce((sum, w) => sum + w, 0n);
    if (total === 0n) throw new MoneyError('Allocation weights must not all be zero');

    const negative = this.minor < 0n;
    const amount = negative ? -this.minor : this.minor;
    const shares = weights.map((w) => (amount * w) / total);
    const remainders = weights.map((w, index) => ({ index, rest: (amount * w) % total }));
    let leftover = amount - shares.reduce((sum, s) => sum + s, 0n);
    remainders.sort((a, b) => (b.rest > a.rest ? 1 : b.rest < a.rest ? -1 : a.index - b.index));
    for (const { index } of remainders) {
      if (leftover === 0n) break;
      shares[index] = (shares[index] ?? 0n) + 1n;
      leftover -= 1n;
    }
    return shares.map((s) => new Money(negative ? -s : s, this.currency));
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.minor < other.minor ? -1 : this.minor > other.minor ? 1 : 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  /** Plain decimal string with exactly the currency's fraction digits, e.g. "1.250". */
  toDecimalString(): string {
    return formatScaled(this.minor, this.exponent);
  }

  toJSON(): MoneyJson {
    return { amount: this.toDecimalString(), currency: this.currency };
  }

  toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}

/** Sums a list of amounts of the same currency. */
export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((total, item) => total.add(item), Money.zero(currency));
}
