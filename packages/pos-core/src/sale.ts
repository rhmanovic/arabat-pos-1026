import type { OverridablePermission } from '@arabat/contracts';
import {
  type Discount,
  type PricedCart,
  PricingError,
  abovePercentOf,
  belowPercentOf,
  divideHalfUp,
  exceedsDiscountLimit,
  priceCart,
} from '@arabat/money';
import { PosRuleError } from './errors.js';

/** One cart line, parsed (amounts in fils, quantity in thousandths). */
export interface SaleLine {
  variantId: string;
  quantityMilli: bigint;
  /** The price the cashier set, or null for the catalog price. */
  priceOverrideMinor: bigint | null;
  priceOverrideReason: string | null;
  discount: Discount | null;
  /** Modifier prices added to the unit price (restaurant); 0 otherwise. */
  extraMinor: bigint;
}

/** The catalog's list price and cost of a variant sellable at the branch. */
export interface CatalogPrice {
  priceMinor: bigint;
  costMinor: bigint | null;
}

/** The company's price-change and discount limits (`sales_settings`, BR-178 / BR-183). */
export interface PricePolicy {
  /** Largest combined discount per line without `sales.discount.override_limit`, e.g. "10". */
  maxDiscountPercent: string;
  /** A changed price may not go below / above this % of the list price (null = no bound). */
  priceOverrideFloorPercent: string | null;
  priceOverrideCeilingPercent: string | null;
  /** Whether a changed price may go below the item's cost. */
  priceOverrideBelowCost: boolean;
}

/** Whether the person at the till may use a right (their own, or a supervisor's grant). */
export type RightCheck = (permission: OverridablePermission) => boolean;

/**
 * Rights from the cashier, or else from a supervisor's single-use grant (BR-177). `supplied`
 * collects the rights the grant actually provided, which are recorded on the sale.
 */
export function createRightCheck(
  cashierHolds: (permission: OverridablePermission) => boolean,
  grant: readonly OverridablePermission[] | null,
): { allowed: RightCheck; supplied: Set<OverridablePermission> } {
  const supplied = new Set<OverridablePermission>();
  const allowed: RightCheck = (permission) => {
    if (cashierHolds(permission)) return true;
    if (grant?.includes(permission)) {
      supplied.add(permission);
      return true;
    }
    return false;
  };
  return { allowed, supplied };
}

/**
 * Step 1 of a sale, before the catalog is read: any discount needs `sales.discount`, any price
 * entered by the cashier needs `sales.price_override`.
 */
export function assertSellingRights(
  lines: readonly SaleLine[],
  orderDiscount: Discount | null,
  allowed: RightCheck,
): void {
  if ((orderDiscount || lines.some((l) => l.discount)) && !allowed('sales.discount'))
    throw new PosRuleError(
      403,
      'DISCOUNT_LIMIT_EXCEEDED',
      'You are not allowed to give discounts.',
    );
  if (lines.some((l) => l.priceOverrideMinor !== null) && !allowed('sales.price_override'))
    throw new PosRuleError(403, 'PRICE_OVERRIDE_DENIED', 'You are not allowed to change prices.');
}

export interface SaleEvaluationInput {
  lines: readonly SaleLine[];
  orderDiscount: Discount | null;
  /** List price and cost per variant; a variant missing here cannot be sold at the branch. */
  catalog: ReadonlyMap<string, CatalogPrice>;
  policy: PricePolicy;
  allowed: RightCheck;
  /** Required when the total is zero (BR-179). */
  zeroTotalReason: string | null | undefined;
  /** The total the cashier saw; null skips the check (the device prices the sale itself). */
  expectedTotalMinor: bigint | null;
}

export interface SaleEvaluation {
  priced: PricedCart;
  /** A line is above the company's discount limit (needed `sales.discount.override_limit`). */
  aboveLimit: boolean;
}

/** The variant's price differs from the list price (BR-178). */
function changedPrice(line: SaleLine, catalog: ReadonlyMap<string, CatalogPrice>): boolean {
  return (
    line.priceOverrideMinor !== null &&
    line.priceOverrideMinor !== catalog.get(line.variantId)!.priceMinor
  );
}

function unitPrice(line: SaleLine, catalog: ReadonlyMap<string, CatalogPrice>): bigint {
  return (line.priceOverrideMinor ?? catalog.get(line.variantId)!.priceMinor) + line.extraMinor;
}

/**
 * The combined discount per line (D4, BR-183): line discount + the share of the sale discount +
 * the gap between the list price and a lowered price, compared with the list gross. A zero price
 * always counts as above the limit (BR-178).
 */
function isAboveLimit(
  lines: readonly SaleLine[],
  priced: PricedCart,
  catalog: ReadonlyMap<string, CatalogPrice>,
  maxDiscountPercent: string,
): boolean {
  return priced.lines.some((p, i) => {
    const l = lines[i]!;
    const list = catalog.get(l.variantId)!.priceMinor + l.extraMinor;
    const listGross = divideHalfUp(list * l.quantityMilli, 1000n);
    const gap = listGross > p.grossMinor ? listGross - p.grossMinor : 0n;
    if (changedPrice(l, catalog) && l.priceOverrideMinor === 0n) return true;
    return exceedsDiscountLimit(
      p.lineDiscountMinor + p.orderDiscountMinor + gap,
      listGross,
      maxDiscountPercent,
    );
  });
}

/**
 * Steps 2–4 of a sale: availability, pricing, price-change bounds, the discount limit, zero
 * totals and the total the cashier saw. Throws the first refusal as a `PosRuleError`, in the
 * server's order.
 */
export function evaluateSale(input: SaleEvaluationInput): SaleEvaluation {
  const { lines, catalog, policy, allowed } = input;
  const unavailable = lines.flatMap((l, i) =>
    catalog.has(l.variantId)
      ? []
      : [
          {
            path: `lines.${i}.variantId`,
            code: 'unavailable',
            message: 'This item cannot be sold here.',
          },
        ],
  );
  if (unavailable.length)
    throw new PosRuleError(
      409,
      'ITEM_UNAVAILABLE',
      'Some items are not available at this branch.',
      unavailable,
    );

  let priced: PricedCart;
  try {
    priced = priceCart(
      lines.map((l) => ({
        unitPriceMinor: unitPrice(l, catalog),
        quantityMilli: l.quantityMilli,
        discount: l.discount,
      })),
      input.orderDiscount,
    );
  } catch (error) {
    if (error instanceof PricingError)
      throw new PosRuleError(400, error.code, error.message, [
        {
          path: error.line === null ? 'orderDiscount' : `lines.${error.line}`,
          code: 'invalid',
          message: error.message,
        },
      ]);
    throw error;
  }

  // Price changes (BR-178): a reason, and the company's floor, ceiling and cost bounds.
  lines.forEach((l, i) => {
    if (!changedPrice(l, catalog)) return;
    const item = catalog.get(l.variantId)!;
    const price = l.priceOverrideMinor!;
    if (!l.priceOverrideReason)
      throw new PosRuleError(400, 'REASON_REQUIRED', 'Give a reason for the price change.', [
        { path: `lines.${i}.priceOverrideReason`, code: 'required', message: 'Required.' },
      ]);
    const outOfBounds =
      (policy.priceOverrideFloorPercent !== null &&
        belowPercentOf(price, item.priceMinor, policy.priceOverrideFloorPercent)) ||
      (policy.priceOverrideCeilingPercent !== null &&
        abovePercentOf(price, item.priceMinor, policy.priceOverrideCeilingPercent)) ||
      (!policy.priceOverrideBelowCost && item.costMinor !== null && price < item.costMinor);
    if (outOfBounds)
      throw new PosRuleError(
        400,
        'PRICE_OUT_OF_BOUNDS',
        'This price is outside the limits set for price changes.',
        [{ path: `lines.${i}.priceOverride`, code: 'out_of_bounds', message: 'Out of bounds.' }],
      );
  });

  const aboveLimit = isAboveLimit(lines, priced, catalog, policy.maxDiscountPercent);
  if (aboveLimit && !allowed('sales.discount.override_limit'))
    throw new PosRuleError(
      403,
      'DISCOUNT_LIMIT_EXCEEDED',
      `Discounts above ${policy.maxDiscountPercent}% need a manager.`,
    );

  // Nothing to pay (BR-179): a dedicated right and a reason.
  if (priced.totalMinor === 0n) {
    if (!allowed('sales.zero_total'))
      throw new PosRuleError(
        403,
        'ZERO_TOTAL_DENIED',
        'A sale with nothing to pay needs a supervisor.',
      );
    if (!input.zeroTotalReason)
      throw new PosRuleError(
        400,
        'REASON_REQUIRED',
        'Give a reason for a sale with nothing to pay.',
        [{ path: 'zeroTotalReason', code: 'required', message: 'Required.' }],
      );
  }

  if (input.expectedTotalMinor !== null && priced.totalMinor !== input.expectedTotalMinor)
    throw new PosRuleError(409, 'TOTAL_CHANGED', 'Prices changed. Review the cart and try again.');

  return { priced, aboveLimit };
}

/**
 * The overridable rights a sale needs, by the same rules `assertSellingRights` and
 * `evaluateSale` apply: what the cashier lacks must come from a supervisor before the sale
 * completes. Returns null when the cart cannot be priced (unknown item or pricing error).
 */
export function requiredSaleRights(
  lines: readonly SaleLine[],
  orderDiscount: Discount | null,
  catalog: ReadonlyMap<string, CatalogPrice>,
  maxDiscountPercent: string,
): OverridablePermission[] | null {
  if (lines.some((l) => !catalog.has(l.variantId))) return null;
  let priced: PricedCart;
  try {
    priced = priceCart(
      lines.map((l) => ({
        unitPriceMinor: unitPrice(l, catalog),
        quantityMilli: l.quantityMilli,
        discount: l.discount,
      })),
      orderDiscount,
    );
  } catch (error) {
    if (error instanceof PricingError) return null;
    throw error;
  }
  const rights: OverridablePermission[] = [];
  if (orderDiscount || lines.some((l) => l.discount)) rights.push('sales.discount');
  if (lines.some((l) => l.priceOverrideMinor !== null)) rights.push('sales.price_override');
  if (isAboveLimit(lines, priced, catalog, maxDiscountPercent))
    rights.push('sales.discount.override_limit');
  if (priced.totalMinor === 0n) rights.push('sales.zero_total');
  return rights;
}

/** The part of an exchange's refund credit spent on the new sale: at most its total. */
export function exchangeCreditUsed(creditMinor: bigint, totalMinor: bigint): bigint {
  return creditMinor < totalMinor ? creditMinor : totalMinor;
}
