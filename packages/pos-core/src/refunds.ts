import { Money, divideHalfUp, formatQuantity, parseQuantity } from '@arabat/money';
import { POS_CURRENCY, parseAmount } from './amounts.js';
import { PosRuleError } from './errors.js';

/** A sold line as a refund sees it: what was sold and what was already refunded. */
export interface RefundableLine {
  position: number;
  variantId: string;
  soldMilli: bigint;
  netMinor: bigint;
  unitCostMinor: bigint | null;
  trackInventory: boolean;
  refundedMilli: bigint;
  refundedMinor: bigint;
}

export interface RefundLineInput {
  /** The sale line's position. */
  position: number;
  quantity: string;
  /** Back into sellable stock; defaults by reason (BR-175). */
  restock?: boolean;
}

export interface RefundLineAmount {
  position: number;
  variantId: string;
  quantityMilli: bigint;
  amountMinor: bigint;
  restock: boolean;
  unitCostMinor: bigint | null;
  trackInventory: boolean;
}

/**
 * The refund lines and total (BR-090). Quantities must be positive and within what is left to
 * refund. Rounding is cumulative: all partial refunds of a line add up to its net amount exactly.
 * Damaged and defective goods stay out of sellable stock unless the cashier says otherwise.
 */
export function computeRefund(
  lines: readonly RefundableLine[],
  input: readonly RefundLineInput[],
  reason?: string,
): { lines: RefundLineAmount[]; totalMinor: bigint } {
  const restockDefault = !(reason === 'damaged' || reason === 'defective');
  const out = input.map((l, i) => {
    const line = lines.find((x) => x.position === l.position);
    if (!line)
      throw PosRuleError.validation([
        { path: `lines.${i}.position`, code: 'not_found', message: 'Item not on the sale.' },
      ]);
    const quantityMilli = parseQuantity(l.quantity);
    if (quantityMilli <= 0n)
      throw new PosRuleError(400, 'INVALID_QUANTITY', 'Quantity must be positive.', [
        { path: `lines.${i}.quantity`, code: 'too_small', message: 'Quantity must be positive.' },
      ]);
    const refundable = line.soldMilli - line.refundedMilli;
    if (quantityMilli > refundable)
      throw new PosRuleError(
        409,
        'REFUND_EXCEEDS_SALE',
        'More than was sold (or already refunded).',
        [
          {
            path: `lines.${i}.quantity`,
            code: 'too_big',
            message: `refundable=${formatQuantity(refundable)}`,
          },
        ],
      );
    const cumulative = divideHalfUp(
      line.netMinor * (line.refundedMilli + quantityMilli),
      line.soldMilli,
    );
    return {
      position: line.position,
      variantId: line.variantId,
      quantityMilli,
      amountMinor: cumulative - line.refundedMinor,
      restock: l.restock ?? restockDefault,
      unitCostMinor: line.unitCostMinor,
      trackInventory: line.trackInventory,
    };
  });
  return { lines: out, totalMinor: out.reduce((s, l) => s + l.amountMinor, 0n) };
}

/** An original payment of the sale and how much of it was already paid back. */
export interface RefundablePayment {
  id: string;
  amountMinor: bigint;
  refundedMinor: bigint;
}

/** Suggested pay-back: proportional to what each original payment can still refund. */
export function suggestPayback<P extends RefundablePayment>(
  payments: readonly P[],
  totalMinor: bigint,
): { payment: P; amountMinor: bigint; reference: string | null }[] {
  const open = payments.filter((p) => p.amountMinor - p.refundedMinor > 0n);
  if (totalMinor === 0n || open.length === 0) return [];
  const shares = Money.ofMinor(totalMinor, POS_CURRENCY)
    .allocate(open.map((p) => p.amountMinor - p.refundedMinor))
    .map((m) => m.minor);
  return open
    .map((p, i) => ({ payment: p, amountMinor: shares[i]!, reference: null as string | null }))
    .filter((a) => a.amountMinor > 0n);
}

/** A pay-back chosen at the till: which original payment, how much, the reference. */
export interface PaybackInput {
  paymentId: string;
  amount: string;
  reference: string | null;
}

/**
 * The pay-back: the suggestion when none is given, otherwise the cashier's split, each part
 * within what its payment can still refund, each payment once, summing to the refund total.
 */
export function paybackAllocation<P extends RefundablePayment>(
  payments: readonly P[],
  totalMinor: bigint,
  custom: readonly PaybackInput[] | null | undefined,
): { payment: P; amountMinor: bigint; reference: string | null }[] {
  if (!custom) return suggestPayback(payments, totalMinor);
  let sum = 0n;
  const result = custom.map((a, i) => {
    const payment = payments.find((p) => p.id === a.paymentId);
    if (!payment)
      throw new PosRuleError(400, 'REFUND_ALLOCATION_INVALID', 'Unknown payment.', [
        { path: `allocation.${i}`, code: 'not_found', message: 'Not a payment of this sale.' },
      ]);
    const amountMinor = parseAmount(a.amount, `allocation.${i}.amount`);
    if (amountMinor <= 0n || amountMinor > payment.amountMinor - payment.refundedMinor)
      throw new PosRuleError(
        400,
        'REFUND_ALLOCATION_INVALID',
        'More than this payment can refund.',
        [
          {
            path: `allocation.${i}.amount`,
            code: 'too_big',
            message: Money.ofMinor(
              payment.amountMinor - payment.refundedMinor,
              POS_CURRENCY,
            ).toDecimalString(),
          },
        ],
      );
    sum += amountMinor;
    return { payment, amountMinor, reference: a.reference };
  });
  if (new Set(custom.map((a) => a.paymentId)).size !== custom.length)
    throw new PosRuleError(400, 'REFUND_ALLOCATION_INVALID', 'Each payment may appear only once.');
  if (sum !== totalMinor)
    throw new PosRuleError(
      400,
      'REFUND_ALLOCATION_INVALID',
      'The allocation must equal the refund total.',
    );
  return result;
}

export type RefundApprovalReason = 'over_limit' | 'outside_window' | 'own_sale';

/**
 * Why a refund must wait for a second person (BR-180): above the company's limit, later than the
 * refund window, or a sale the requester rang up themselves (when the company says so). Only the
 * owner may complete such a refund directly.
 */
export function refundApprovalReasons(input: {
  totalMinor: bigint;
  saleCreatedAt: Date;
  saleUserId: string | null;
  requesterUserId: string;
  now: Date;
  settings: {
    refundApprovalLimitMinor: bigint;
    refundWindowDays: number;
    refundOwnSalesNeedApproval: boolean;
  };
}): RefundApprovalReason[] {
  const reasons: RefundApprovalReason[] = [];
  if (input.totalMinor > input.settings.refundApprovalLimitMinor) reasons.push('over_limit');
  const ageDays = (input.now.getTime() - input.saleCreatedAt.getTime()) / 86_400_000;
  if (ageDays > input.settings.refundWindowDays) reasons.push('outside_window');
  if (input.settings.refundOwnSalesNeedApproval && input.saleUserId === input.requesterUserId)
    reasons.push('own_sale');
  return reasons;
}

/** A sale can be cancelled (voided) only in the cashier's own open shift and with no refunds. */
export function assertVoidable(input: {
  saleShiftId: string | null;
  openShiftId: string;
  activeRefunds: number;
}): void {
  if (input.saleShiftId !== input.openShiftId || input.activeRefunds > 0)
    throw new PosRuleError(
      409,
      'NOT_VOIDABLE',
      'Only sales of your open shift without refunds can be cancelled.',
    );
}
