import type { PosCatalogItem } from '@arabat/contracts';
import { describe, expect, it } from 'vitest';
import { type CartLine, itemsInForce, requiredRights } from './cart.js';

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

describe('itemsInForce (product discounts, ADR-0133)', () => {
  const offered = {
    ...item,
    offers: [
      {
        discountId: 'week',
        price: { amount: '1.000', currency: 'KWD' },
        startsAt: null,
        endsAt: '2026-11-01T00:00:00.000Z',
      },
      {
        discountId: 'friday',
        price: { amount: '0.800', currency: 'KWD' },
        startsAt: '2026-10-30T00:00:00.000Z',
        endsAt: '2026-10-31T00:00:00.000Z',
      },
    ],
  } as unknown as PosCatalogItem;

  it('sells at the largest discount in force and keeps the regular price', () => {
    const [now] = itemsInForce([offered], new Date('2026-10-22T12:00:00Z'));
    expect(now).toMatchObject({ price: { amount: '1.000' }, regularPrice: { amount: '1.250' } });
    const [friday] = itemsInForce([offered], new Date('2026-10-30T12:00:00Z'));
    expect(friday!.price).toMatchObject({ amount: '0.800' });
    const [after] = itemsInForce([offered], new Date('2026-11-01T00:00:00Z'));
    expect(after).toMatchObject({ price: { amount: '1.250' }, regularPrice: null });
    // An item without offers is unchanged.
    expect(itemsInForce([item], new Date())[0]).toMatchObject({ regularPrice: null });
  });
});
