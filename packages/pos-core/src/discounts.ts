import { divideHalfUp, isValidDiscountPercent, parseDecimal, pow10 } from '@arabat/money';

/*
 * Product discounts (ADR-0133): a percentage or an amount off the catalog price of the products
 * a discount covers, for the point of sale and / or the online store, optionally between two
 * dates. Which products a discount covers is resolved by the API (categories, lists, products);
 * these rules only turn a covering discount into a price and choose the one in force.
 */

export interface ProductDiscountRule {
  id: string;
  type: 'percentage' | 'amount';
  /** 0–100 with up to 2 decimals (percentage). */
  percent: string | null;
  /** Fils off the price (amount). */
  amountMinor: bigint | null;
  /** ISO timestamps; null = from now on / without end. */
  startsAt: string | null;
  endsAt: string | null;
}

/** A discounted price of one variant, valid between two moments. */
export interface PriceOffer {
  discountId: string;
  priceMinor: bigint;
  startsAt: string | null;
  endsAt: string | null;
}

/**
 * The price after a discount, rounded half-up to the fils, or null when the discount would not
 * leave a price above zero (an amount as large as the price, a 100% discount): such a product
 * keeps its price. A discount never makes an item free.
 */
export function discountedPrice(priceMinor: bigint, rule: ProductDiscountRule): bigint | null {
  if (priceMinor <= 0n) return null;
  let cut: bigint;
  if (rule.type === 'percentage') {
    if (rule.percent === null || !isValidDiscountPercent(rule.percent)) return null;
    const { units, scale } = parseDecimal(rule.percent);
    cut = divideHalfUp(priceMinor * units, pow10(scale) * 100n);
  } else {
    if (rule.amountMinor === null) return null;
    cut = rule.amountMinor;
  }
  if (cut <= 0n || cut >= priceMinor) return null;
  return priceMinor - cut;
}

/** Every discounted price of a variant, one per covering discount that lowers it. */
export function priceOffers(
  priceMinor: bigint,
  rules: readonly ProductDiscountRule[],
): PriceOffer[] {
  return rules.flatMap((rule) => {
    const price = discountedPrice(priceMinor, rule);
    return price === null
      ? []
      : [{ discountId: rule.id, priceMinor: price, startsAt: rule.startsAt, endsAt: rule.endsAt }];
  });
}

/** Whether an offer is in force at a moment (from its start, until before its end). */
export function offerActive(offer: Pick<PriceOffer, 'startsAt' | 'endsAt'>, now: Date): boolean {
  const t = now.getTime();
  return (
    (offer.startsAt === null || Date.parse(offer.startsAt) <= t) &&
    (offer.endsAt === null || t < Date.parse(offer.endsAt))
  );
}

/**
 * The offer in force at `now`: discounts never add up; the lowest price (the largest discount
 * for the customer) wins, and on a tie the first offer given.
 */
export function offerAt<T extends PriceOffer>(offers: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const offer of offers)
    if (offerActive(offer, now) && (best === null || offer.priceMinor < best.priceMinor))
      best = offer;
  return best;
}

/** The whole percentage saved, for a badge ("-20%"): rounded down, at least 1. */
export function savedPercent(regularMinor: bigint, priceMinor: bigint): number {
  if (regularMinor <= 0n || priceMinor >= regularMinor) return 0;
  const pct = Number(((regularMinor - priceMinor) * 100n) / regularMinor);
  return Math.max(1, pct);
}
