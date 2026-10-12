import { describe, expect, it } from 'vitest';
import { processingFee } from './fees.js';

describe('processingFee', () => {
  const rule = (
    type: 'none' | 'fixed' | 'percentage' | 'fixed_plus_percentage',
    fixedMinor = 0n,
    percent = '0',
  ) => ({
    type,
    fixedMinor,
    percent,
  });

  it('charges nothing without a fee or for non-positive amounts', () => {
    expect(processingFee(10_000n, rule('none', 500n, '5'))).toBe(0n);
    expect(processingFee(0n, rule('fixed', 100n))).toBe(0n);
    expect(processingFee(-5_000n, rule('percentage', 0n, '2'))).toBe(0n);
  });

  it('applies fixed fees exactly', () => {
    expect(processingFee(12_345n, rule('fixed', 150n))).toBe(150n);
  });

  it('rounds percentage fees half-up to the fils', () => {
    // 2.5 % of 1.000 KWD = 0.025
    expect(processingFee(1_000n, rule('percentage', 0n, '2.5'))).toBe(25n);
    // 1.75 % of 0.100 KWD = 0.00175 → 0.002
    expect(processingFee(100n, rule('percentage', 0n, '1.75'))).toBe(2n);
    // 1.25 % of 0.100 KWD = 0.00125 → 0.001
    expect(processingFee(100n, rule('percentage', 0n, '1.25'))).toBe(1n);
    // 0.333 % of 12.345 KWD = 0.0411088… → 0.041
    expect(processingFee(12_345n, rule('percentage', 0n, '0.333'))).toBe(41n);
  });

  it('combines fixed and percentage parts and caps at the amount', () => {
    // 0.100 + 2 % of 5.000 = 0.200
    expect(processingFee(5_000n, rule('fixed_plus_percentage', 100n, '2'))).toBe(200n);
    expect(processingFee(50n, rule('fixed', 100n))).toBe(50n);
  });

  it('rejects invalid percentages', () => {
    expect(() => processingFee(1_000n, rule('percentage', 0n, '1.2345'))).toThrow();
    expect(() => processingFee(1_000n, rule('percentage', 0n, '-1'))).toThrow();
  });
});
