import { divideHalfUp, parseDecimal, pow10 } from './decimal.js';
import { Money } from './money.js';

/**
 * Cart pricing (Prompt 10), shared by the POS (display) and the API (authoritative): the
 * same exact bigint arithmetic on both sides, so the total a cashier sees is the total the
 * server records. No tax yet (OQ-002); no cash rounding (OQ-003).
 *
 * Order of calculation (BR-080):
 *  1. line gross    = round_half_up(unit price × quantity)
 *  2. line discount = percentage of gross (half-up) or a fixed amount ≤ gross
 *  3. order discount on Σ(gross − line discount): percentage (half-up) or amount ≤ base,
 *     allocated to lines by the largest-remainder method (no fils lost or created)
 *  4. line net = gross − line discount − allocated order discount; total = Σ line net
 */
export type Discount =
  { type: 'percent'; percent: string } | { type: 'amount'; amountMinor: bigint };

export interface PricingLine {
  unitPriceMinor: bigint;
  /** Quantity in thousandths (1 unit = 1000). */
  quantityMilli: bigint;
  discount?: Discount | null;
}

export interface PricedLine {
  grossMinor: bigint;
  lineDiscountMinor: bigint;
  orderDiscountMinor: bigint;
  netMinor: bigint;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotalMinor: bigint;
  lineDiscountsMinor: bigint;
  orderDiscountMinor: bigint;
  totalMinor: bigint;
}

export class PricingError extends Error {
  constructor(
    readonly code: 'INVALID_QUANTITY' | 'INVALID_PRICE' | 'INVALID_DISCOUNT',
    readonly line: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'PricingError';
  }
}

const PERCENT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;

/** Validates a discount percentage: 0–100 with at most 2 decimals. */
export function isValidDiscountPercent(value: string): boolean {
  return PERCENT.test(value);
}

function discountOn(
  base: bigint,
  discount: Discount | null | undefined,
  line: number | null,
): bigint {
  if (!discount) return 0n;
  if (discount.type === 'percent') {
    if (!isValidDiscountPercent(discount.percent))
      throw new PricingError(
        'INVALID_DISCOUNT',
        line,
        'Discount percent must be 0–100 with up to 2 decimals.',
      );
    const { units, scale } = parseDecimal(discount.percent);
    return divideHalfUp(base * units, pow10(scale) * 100n);
  }
  if (discount.amountMinor < 0n)
    throw new PricingError('INVALID_DISCOUNT', line, 'A discount cannot be negative.');
  if (discount.amountMinor > base)
    throw new PricingError(
      'INVALID_DISCOUNT',
      line,
      'A discount cannot exceed the amount it applies to.',
    );
  return discount.amountMinor;
}

export function priceCart(
  lines: readonly PricingLine[],
  orderDiscount?: Discount | null,
): PricedCart {
  const first = lines.map((l, i) => {
    if (l.quantityMilli <= 0n)
      throw new PricingError('INVALID_QUANTITY', i, 'Quantity must be positive.');
    if (l.unitPriceMinor < 0n)
      throw new PricingError('INVALID_PRICE', i, 'Price cannot be negative.');
    const grossMinor = divideHalfUp(l.unitPriceMinor * l.quantityMilli, 1000n);
    const lineDiscountMinor = discountOn(grossMinor, l.discount, i);
    return { grossMinor, lineDiscountMinor, base: grossMinor - lineDiscountMinor };
  });
  const baseTotal = first.reduce((s, l) => s + l.base, 0n);
  const orderDiscountMinor = discountOn(baseTotal, orderDiscount, null);
  const shares =
    orderDiscountMinor > 0n
      ? Money.ofMinor(orderDiscountMinor, 'KWD')
          .allocate(first.map((l) => l.base))
          .map((m) => m.minor)
      : first.map(() => 0n);
  const priced = first.map((l, i) => ({
    grossMinor: l.grossMinor,
    lineDiscountMinor: l.lineDiscountMinor,
    orderDiscountMinor: shares[i]!,
    netMinor: l.base - shares[i]!,
  }));
  return {
    lines: priced,
    subtotalMinor: priced.reduce((s, l) => s + l.grossMinor, 0n),
    lineDiscountsMinor: priced.reduce((s, l) => s + l.lineDiscountMinor, 0n),
    orderDiscountMinor,
    totalMinor: priced.reduce((s, l) => s + l.netMinor, 0n),
  };
}

/**
 * True when `discountMinor` is more than `limitPercent` % of `baseMinor` (exact compare,
 * no rounding): used to require `sales.discount.override_limit`.
 */
export function exceedsDiscountLimit(
  discountMinor: bigint,
  baseMinor: bigint,
  limitPercent: string,
): boolean {
  const { units, scale } = parseDecimal(limitPercent);
  return discountMinor * 100n * pow10(scale) > units * baseMinor;
}
