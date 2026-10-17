import { abs, parseAmount } from './amounts.js';
import { PosRuleError } from './errors.js';

export type ShiftOutcome = 'balanced' | 'over' | 'short';

/** Within the register's tolerance the count is balanced; otherwise over or short (BR-162). */
export function shiftOutcome(
  discrepancyMinor: bigint | null,
  toleranceMinor: bigint | null,
): ShiftOutcome | null {
  if (discrepancyMinor === null) return null;
  if (abs(discrepancyMinor) <= (toleranceMinor ?? 0n)) return 'balanced';
  return discrepancyMinor > 0n ? 'over' : 'short';
}

/** A counted difference beyond the tolerance needs an explanation (BR-164). */
export function cashDifferenceNeedsNote(
  differenceMinor: bigint,
  toleranceMinor: bigint,
  note: string | null | undefined,
): boolean {
  return !note && abs(differenceMinor) > toleranceMinor;
}

/**
 * Opening count: a blind cashier cannot know there is a difference, and a drawer's first count
 * has nothing to compare with; otherwise a difference beyond the tolerance needs a note.
 */
export function openingNoteRequired(input: {
  blind: boolean;
  initial: boolean;
  note: string | null | undefined;
  differenceMinor: bigint;
  toleranceMinor: bigint;
}): boolean {
  return (
    !input.blind &&
    !input.initial &&
    cashDifferenceNeedsNote(input.differenceMinor, input.toleranceMinor, input.note)
  );
}

/** Closing count: as opening, except that a manager's forced close always explains. */
export function closingNoteRequired(input: {
  closeType: 'normal' | 'forced';
  blind: boolean;
  note: string | null | undefined;
  discrepancyMinor: bigint;
  toleranceMinor: bigint;
}): boolean {
  return (
    cashDifferenceNeedsNote(input.discrepancyMinor, input.toleranceMinor, input.note) &&
    !(input.closeType === 'normal' && input.blind)
  );
}

/**
 * "Other" cash-outs are capped per movement and per shift (BR-164, D2); above the cap the owner
 * posts with an override and anyone else waits for a manager. `shiftOtherTotalMinor` is the sum
 * of the shift's posted and pending "other" cash-outs before this one.
 */
export function otherCashOutExceedsLimit(input: {
  amountMinor: bigint;
  shiftOtherTotalMinor: bigint;
  perMovementLimitMinor: bigint;
  perShiftLimitMinor: bigint;
}): boolean {
  if (input.amountMinor > input.perMovementLimitMinor) return true;
  return input.shiftOtherTotalMinor + input.amountMinor > input.perShiftLimitMinor;
}

/** One denomination of a drawer count, e.g. `{ value: "0.250", count: 4 }`. */
export interface DenominationCount {
  value: string;
  count: number;
}

/** A denomination count, when given, must add up exactly to the counted cash. */
export function checkCashBreakdown(
  breakdown: readonly DenominationCount[] | null | undefined,
  countedMinor: bigint,
): void {
  if (!breakdown) return;
  let sum = 0n;
  for (const d of breakdown) sum += parseAmount(d.value, 'breakdown') * BigInt(d.count);
  if (sum !== countedMinor)
    throw new PosRuleError(
      400,
      'INVALID_BREAKDOWN',
      'The denomination count does not match the counted cash.',
    );
}
