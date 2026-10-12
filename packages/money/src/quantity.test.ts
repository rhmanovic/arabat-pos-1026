import { describe, expect, it } from 'vitest';
import {
  QuantityError,
  formatQuantity,
  parseQuantity,
  quantityValue,
  weightedAverageCost,
} from './quantity.js';

describe('quantity', () => {
  it('parses and formats exactly', () => {
    expect(parseQuantity('12')).toBe(12000n);
    expect(parseQuantity('1.5')).toBe(1500n);
    expect(parseQuantity('0.001')).toBe(1n);
    expect(parseQuantity('-0.250')).toBe(-250n);
    expect(formatQuantity(1500n)).toBe('1.500');
    expect(formatQuantity(-250n)).toBe('-0.250');
    expect(formatQuantity(0n)).toBe('0.000');
  });

  it('rejects more than 3 decimals, garbage and floats-in-disguise', () => {
    for (const bad of ['1.0001', 'abc', '', '1e3', '1,5', '.5', '1.']) {
      expect(() => parseQuantity(bad)).toThrow(QuantityError);
    }
  });

  it('values stock at cost with half-up rounding', () => {
    // 1.5 units × 0.333 KWD = 0.4995 → 0.500
    expect(quantityValue(1500n, 333n)).toBe(500n);
    expect(quantityValue(3000n, 1250n)).toBe(3750n);
  });

  it('computes the moving weighted average cost', () => {
    // 10 @ 1.000 + 10 @ 2.000 → 1.500
    expect(weightedAverageCost(10000n, 1000n, 10000n, 2000n)).toBe(1500n);
    // 3 @ 1.000 + 1 @ 1.001 → 4.001 / 4 = 1.00025 → 1.000
    expect(weightedAverageCost(3000n, 1000n, 1000n, 1001n)).toBe(1000n);
    // 1 @ 1.000 + 1 @ 1.001 → 1.0005 → 1.001 (half-up)
    expect(weightedAverageCost(1000n, 1000n, 1000n, 1001n)).toBe(1001n);
    // empty or negative stock: the new cost replaces the average
    expect(weightedAverageCost(0n, 900n, 5000n, 1200n)).toBe(1200n);
    expect(weightedAverageCost(-2000n, 900n, 5000n, 1200n)).toBe(1200n);
    expect(weightedAverageCost(2000n, null, 5000n, 1200n)).toBe(1200n);
    expect(() => weightedAverageCost(0n, null, 0n, 1n)).toThrow(QuantityError);
  });
});
