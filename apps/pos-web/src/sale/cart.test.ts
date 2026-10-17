import type { PosCatalogItem } from '@arabat/contracts';
import { describe, expect, it } from 'vitest';
import { type CartLine, requiredRights } from './cart.js';

const item = {
  variantId: 'tea',
  price: { amount: '1.250', currency: 'KWD' },
} as unknown as PosCatalogItem;
const items = new Map([['tea', item]]);
const line = (extra: Partial<CartLine> = {}): CartLine => ({
  key: 'k',
  variantId: 'tea',
  quantity: '2',
  priceOverride: null,
  priceOverrideReason: null,
  discount: null,
  ...extra,
});
const cart = (lines: CartLine[], orderDiscount: CartLine['discount'] = null) => ({
  lines,
  orderDiscount,
  orderId: null,
  customer: null,
});

describe('requiredRights (shared with the server, pos-core)', () => {
  it('needs nothing for a plain cart', () => {
    expect(requiredRights(cart([line()]), items, '10')).toEqual([]);
  });

  it('needs the price-change right for any entered price, as the server does', () => {
    expect(requiredRights(cart([line({ priceOverride: '1.250' })]), items, '10')).toEqual([
      'sales.price_override',
    ]);
  });

  it('combines the order discount with the line discount for the limit (BR-183)', () => {
    const rights = requiredRights(
      cart([line({ discount: { type: 'percent', value: '6' } })], { type: 'percent', value: '6' }),
      items,
      '10',
    );
    expect(rights).toEqual(['sales.discount', 'sales.discount.override_limit']);
  });

  it('needs the zero-total right for a free sale and skips the limit until settings load', () => {
    expect(
      requiredRights(cart([line({ discount: { type: 'percent', value: '100' } })]), items, null),
    ).toEqual(['sales.discount', 'sales.zero_total']);
  });
});
