import { describe, expect, it } from 'vitest';
import { Money, MoneyError, divideHalfUp, sumMoney } from './index.js';

const kwd = (amount: string) => Money.parse(amount, 'KWD');

describe('Money parsing and formatting (KWD, 3 decimals)', () => {
  it('stores KWD in fils', () => {
    expect(kwd('1.250').minor).toBe(1250n);
    expect(kwd('1.25').minor).toBe(1250n);
    expect(kwd('7').minor).toBe(7000n);
    expect(kwd('-0.005').minor).toBe(-5n);
  });

  it('always formats with exactly three decimals', () => {
    expect(kwd('1.25').toDecimalString()).toBe('1.250');
    expect(Money.ofMinor(5n, 'KWD').toDecimalString()).toBe('0.005');
    expect(Money.ofMinor(-5n, 'KWD').toDecimalString()).toBe('-0.005');
    expect(Money.zero('KWD').toDecimalString()).toBe('0.000');
  });

  it('uses the currency exponent instead of assuming two decimals', () => {
    expect(Money.parse('1.25', 'USD').minor).toBe(125n);
    expect(Money.parse('1.25', 'USD').toDecimalString()).toBe('1.25');
  });

  it('rejects more decimals than the currency allows (no silent rounding of input)', () => {
    expect(() => kwd('1.2345')).toThrow(MoneyError);
    expect(() => Money.parse('1.005', 'USD')).toThrow(MoneyError);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', 'abc', '1.2.3', '1e3', '0x10', '1,000', 'NaN', '.5']) {
      expect(() => kwd(bad), bad).toThrow();
    }
  });

  it('rejects unsupported currencies', () => {
    expect(() => Money.parse('1', 'XXX' as never)).toThrow(MoneyError);
  });

  it('round-trips through JSON as a decimal string', () => {
    const json = JSON.stringify(kwd('12.345'));
    expect(json).toBe('{"amount":"12.345","currency":"KWD"}');
    expect(Money.fromJSON(JSON.parse(json)).equals(kwd('12.345'))).toBe(true);
  });

  it('handles amounts far beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    const big = kwd('9007199254740993.123');
    expect(big.minor).toBe(9007199254740993123n);
    expect(big.add(kwd('0.001')).toDecimalString()).toBe('9007199254740993.124');
  });
});

describe('Money arithmetic', () => {
  it('adds and subtracts exactly where floats would fail', () => {
    // 0.1 + 0.2 !== 0.3 in floating point.
    expect(kwd('0.100').add(kwd('0.200')).equals(kwd('0.300'))).toBe(true);
    expect(kwd('1.000').subtract(kwd('0.999')).toDecimalString()).toBe('0.001');
  });

  it('refuses to mix currencies', () => {
    expect(() => kwd('1').add(Money.parse('1', 'USD'))).toThrow(MoneyError);
  });

  it('multiplies by decimal quantities with half-up rounding to the fils', () => {
    expect(kwd('1.250').multiply('3').toDecimalString()).toBe('3.750');
    // 0.333 * 1.5 = 0.4995 → 0.500
    expect(kwd('0.333').multiply('1.5').toDecimalString()).toBe('0.500');
    // 0.333 * 1.4 = 0.4662 → 0.466
    expect(kwd('0.333').multiply('1.4').toDecimalString()).toBe('0.466');
    // negative amounts round half away from zero
    expect(kwd('-0.333').multiply('1.5').toDecimalString()).toBe('-0.500');
  });

  it('computes percentages with half-up rounding', () => {
    expect(kwd('10.000').percentage('5').toDecimalString()).toBe('0.500');
    // 1.235 * 10% = 0.1235 → 0.124
    expect(kwd('1.235').percentage('10').toDecimalString()).toBe('0.124');
    // 1.234 * 12.5% = 0.15425 → 0.154
    expect(kwd('1.234').percentage('12.5').toDecimalString()).toBe('0.154');
  });

  it('sums lists and compares', () => {
    const total = sumMoney([kwd('1.100'), kwd('2.200'), kwd('3.300')], 'KWD');
    expect(total.toDecimalString()).toBe('6.600');
    expect(kwd('1').compare(kwd('2'))).toBe(-1);
    expect(kwd('2').compare(kwd('2'))).toBe(0);
    expect(kwd('-1').isNegative()).toBe(true);
  });
});

describe('Money allocation', () => {
  it('never loses or creates a fils', () => {
    const parts = kwd('10.000').allocate([1n, 1n, 1n]);
    expect(parts.map((p) => p.toDecimalString())).toEqual(['3.334', '3.333', '3.333']);
    expect(sumMoney(parts, 'KWD').equals(kwd('10.000'))).toBe(true);
  });

  it('allocates proportionally to weights', () => {
    const parts = kwd('1.000').allocate([1n, 3n]);
    expect(parts.map((p) => p.toDecimalString())).toEqual(['0.250', '0.750']);
  });

  it('preserves the total for random inputs', () => {
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let i = 0; i < 500; i++) {
      const amount = Money.ofMinor(BigInt(next() % 10_000_000) - 5_000_000n, 'KWD');
      const weights: bigint[] = Array.from({ length: 1 + (next() % 7) }, () =>
        BigInt(next() % 100),
      );
      if (weights.reduce((sum, w) => sum + w, 0n) === 0n) weights[0] = 1n;
      expect(sumMoney(amount.allocate(weights), 'KWD').equals(amount)).toBe(true);
    }
  });

  it('rejects invalid weights', () => {
    expect(() => kwd('1').allocate([])).toThrow(MoneyError);
    expect(() => kwd('1').allocate([0n, 0n])).toThrow(MoneyError);
    expect(() => kwd('1').allocate([-1n, 2n])).toThrow(MoneyError);
  });
});

describe('divideHalfUp', () => {
  it('rounds half away from zero', () => {
    expect(divideHalfUp(5n, 2n)).toBe(3n);
    expect(divideHalfUp(-5n, 2n)).toBe(-3n);
    expect(divideHalfUp(4n, 3n)).toBe(1n);
    expect(divideHalfUp(5n, -2n)).toBe(-3n);
    expect(() => divideHalfUp(1n, 0n)).toThrow(RangeError);
  });
});
