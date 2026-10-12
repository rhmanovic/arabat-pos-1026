import { describe, expect, it } from 'vitest';
import { PricingError, exceedsDiscountLimit, priceCart } from './pricing.js';

describe('priceCart', () => {
  it('prices quantities exactly, including fractions', () => {
    const cart = priceCart([
      { unitPriceMinor: 1250n, quantityMilli: 3000n },
      // 0.333 × 1.5 = 0.4995 → 0.500
      { unitPriceMinor: 333n, quantityMilli: 1500n },
    ]);
    expect(cart.lines.map((l) => l.grossMinor)).toEqual([3750n, 500n]);
    expect(cart.totalMinor).toBe(4250n);
  });

  it('applies line discounts (percent half-up, amount) then the order discount without losing a fils', () => {
    const cart = priceCart(
      [
        {
          unitPriceMinor: 1000n,
          quantityMilli: 1000n,
          discount: { type: 'percent', percent: '12.5' },
        },
        {
          unitPriceMinor: 1000n,
          quantityMilli: 1000n,
          discount: { type: 'amount', amountMinor: 100n },
        },
        { unitPriceMinor: 1000n, quantityMilli: 1000n },
      ],
      { type: 'amount', amountMinor: 100n },
    );
    // bases: 875, 900, 1000 = 2775 → 100 allocated 32/32/36 (largest remainder)
    expect(cart.lines.map((l) => l.lineDiscountMinor)).toEqual([125n, 100n, 0n]);
    expect(cart.lines.map((l) => l.orderDiscountMinor).reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(cart.totalMinor).toBe(2675n);
    expect(cart.subtotalMinor - cart.lineDiscountsMinor - cart.orderDiscountMinor).toBe(
      cart.totalMinor,
    );
  });

  it('allocates an order percentage discount exactly', () => {
    const cart = priceCart(
      [
        { unitPriceMinor: 333n, quantityMilli: 1000n },
        { unitPriceMinor: 333n, quantityMilli: 1000n },
        { unitPriceMinor: 334n, quantityMilli: 1000n },
      ],
      { type: 'percent', percent: '10' },
    );
    expect(cart.orderDiscountMinor).toBe(100n);
    expect(cart.lines.reduce((s, l) => s + l.netMinor, 0n)).toBe(900n);
  });

  it('rejects invalid discounts and quantities', () => {
    const line = { unitPriceMinor: 1000n, quantityMilli: 1000n };
    expect(() => priceCart([{ ...line, discount: { type: 'percent', percent: '101' } }])).toThrow(
      PricingError,
    );
    expect(() => priceCart([{ ...line, discount: { type: 'percent', percent: '1.234' } }])).toThrow(
      PricingError,
    );
    expect(() =>
      priceCart([{ ...line, discount: { type: 'amount', amountMinor: 1001n } }]),
    ).toThrow(PricingError);
    expect(() => priceCart([{ ...line, discount: { type: 'amount', amountMinor: -1n } }])).toThrow(
      PricingError,
    );
    expect(() => priceCart([line], { type: 'amount', amountMinor: 1001n })).toThrow(PricingError);
    expect(() => priceCart([{ ...line, quantityMilli: 0n }])).toThrow(PricingError);
    // A 100 % discount is valid (free item).
    expect(priceCart([{ ...line, discount: { type: 'percent', percent: '100' } }]).totalMinor).toBe(
      0n,
    );
  });

  it('compares discounts with the limit exactly', () => {
    expect(exceedsDiscountLimit(100n, 1000n, '10')).toBe(false);
    expect(exceedsDiscountLimit(101n, 1000n, '10')).toBe(true);
    expect(exceedsDiscountLimit(125n, 1000n, '12.5')).toBe(false);
    expect(exceedsDiscountLimit(1n, 0n, '100')).toBe(true);
  });
});
