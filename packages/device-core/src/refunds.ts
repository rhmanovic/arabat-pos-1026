import type { DeviceRecord } from '@arabat/contracts';
import {
  type PaybackInput,
  PosRuleError,
  type RefundApprovalReason,
  type RefundLineInput,
  type RefundablePayment,
  computeRefund,
  formatRefundNumber,
  paybackAllocation,
  refundApprovalReasons,
} from '@arabat/pos-core';
import type { BridgeDb } from './bridge.js';
import { newId, nowIso } from './ids.js';
import { enqueueStatement } from './outbox.js';
import { type LocalSale, getSale } from './sales.js';
import { type LocalShift, assertShiftUsable, shiftSummary } from './shifts.js';
import { type LocalContext, type StaffMember, holds } from './snapshot.js';

export type RefundRecord = Extract<DeviceRecord, { kind: 'refund' }>;
export type RefundReason = RefundRecord['reason'];

export interface RefundableSale {
  sale: LocalSale;
  lines: {
    position: number;
    variantId: string;
    name: { nameEn: string | null; nameAr: string | null };
    soldMilli: bigint;
    netMinor: bigint;
    unitCostMinor: bigint | null;
    trackInventory: boolean;
    refundedMilli: bigint;
    refundedMinor: bigint;
  }[];
  payments: (RefundablePayment & { kind: string; nameEn: string | null; nameAr: string | null })[];
  refunds: {
    id: string;
    refundNumber: string;
    totalMinor: bigint;
    occurredAt: string;
    reason: string;
  }[];
}

/** A sale this device made, with what was already refunded of each line and payment. */
export async function refundableSale(db: BridgeDb, saleId: string): Promise<RefundableSale | null> {
  const sale = await getSale(db, saleId);
  if (!sale) return null;
  const refundedLines = await db.query(
    `SELECT rl.sale_position, sum(CAST(rl.quantity AS REAL)) AS qty, sum(CAST(rl.amount_minor AS INTEGER)) AS amount
     FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id WHERE r.sale_id = ? GROUP BY rl.sale_position`,
    [saleId],
  );
  const refundedPays = await db.query(
    `SELECT rp.payment_id, sum(CAST(rp.amount_minor AS INTEGER)) AS amount
     FROM refund_payments rp JOIN refunds r ON r.id = rp.refund_id WHERE r.sale_id = ? GROUP BY rp.payment_id`,
    [saleId],
  );
  const refunds = await db.query(`SELECT * FROM refunds WHERE sale_id = ? ORDER BY occurred_at`, [
    saleId,
  ]);
  // Quantities are summed exactly from their decimal strings to stay in thousandths.
  const refundedQty = new Map<number, bigint>();
  for (const r of refundedLines) {
    const rows = await db.query(
      `SELECT rl.quantity FROM refund_lines rl JOIN refunds x ON x.id = rl.refund_id WHERE x.sale_id = ? AND rl.sale_position = ?`,
      [saleId, Number(r['sale_position'])],
    );
    refundedQty.set(
      Number(r['sale_position']),
      rows.reduce((s, q) => s + milli(String(q['quantity'])), 0n),
    );
  }
  return {
    sale,
    lines: sale.lines.map((l) => {
      const done = refundedLines.find((r) => Number(r['sale_position']) === l.position);
      return {
        position: l.position,
        variantId: l.variantId,
        name: { nameEn: l.nameEn, nameAr: l.nameAr },
        soldMilli: milli(l.quantity),
        netMinor: l.netMinor,
        unitCostMinor: null,
        trackInventory: l.trackInventory,
        refundedMilli: refundedQty.get(l.position) ?? 0n,
        refundedMinor: BigInt(String(done?.['amount'] ?? 0)),
      };
    }),
    payments: sale.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      amountMinor: p.amountMinor,
      refundedMinor: BigInt(
        String(refundedPays.find((r) => r['payment_id'] === p.id)?.['amount'] ?? 0),
      ),
    })),
    refunds: refunds.map((r) => ({
      id: String(r['id']),
      refundNumber: String(r['refund_number']),
      totalMinor: BigInt(String(r['total_minor'])),
      occurredAt: String(r['occurred_at']),
      reason: String(r['reason']),
    })),
  };
}

/** "2" → 2000n, "1.5" → 1500n. */
function milli(quantity: string): bigint {
  const [whole, frac = ''] = quantity.split('.');
  return BigInt(whole!) * 1000n + BigInt((frac + '000').slice(0, 3));
}

export interface RefundInput {
  refundable: RefundableSale;
  lines: RefundLineInput[];
  reason: RefundReason;
  note: string | null;
  /** The cashier's split, or null for the suggested pay-back. */
  payback: PaybackInput[] | null;
  cashier: StaffMember;
  shift: LocalShift;
  /** The second person who typed their PIN when approval is needed. */
  approver: StaffMember | null;
}

export interface PreparedRefund {
  record: Omit<RefundRecord, 'id' | 'occurredAt'>;
  totalMinor: bigint;
  lines: ReturnType<typeof computeRefund>['lines'];
  payback: { paymentId: string; kind: string; amountMinor: bigint; reference: string | null }[];
  approvalReasons: RefundApprovalReason[];
  cashPaybackMinor: bigint;
}

/**
 * Decides a refund of one of this device's sales as the server would (DEVICE_API.md §4–5):
 * amounts with `computeRefund`, the pay-back with `paybackAllocation`, and the reasons that need
 * a second person with `refundApprovalReasons`; that person approves at the till with their PIN.
 */
export function prepareRefund(
  input: RefundInput,
  ctx: LocalContext,
  now: Date = new Date(),
): PreparedRefund {
  const { cashier, refundable } = input;
  if (!holds(cashier, 'pos.access') || !holds(cashier, 'refunds.create'))
    throw new PosRuleError(403, 'FORBIDDEN', 'You are not allowed to refund.');
  if (input.shift.status !== 'open')
    throw new PosRuleError(409, 'SHIFT_REQUIRED', 'Open a shift first.');
  const computed = computeRefund(refundable.lines, input.lines, input.reason);
  if (computed.totalMinor <= 0n && input.lines.length === 0)
    throw PosRuleError.validation([
      { path: 'lines', code: 'empty', message: 'Choose what to refund.' },
    ]);
  const allocation = paybackAllocation(refundable.payments, computed.totalMinor, input.payback);
  if (ctx.settings.requireTenderReference) {
    const missing = allocation.findIndex((a) => a.payment.kind !== 'cash' && !a.reference);
    if (missing >= 0)
      throw new PosRuleError(
        400,
        'REFERENCE_REQUIRED',
        'Enter the reference of each card or transfer pay-back.',
        [{ path: `allocation.${missing}.reference`, code: 'required', message: 'Required.' }],
      );
  }
  const reasons = refundApprovalReasons({
    totalMinor: computed.totalMinor,
    saleCreatedAt: new Date(refundable.sale.occurredAt),
    saleUserId: refundable.sale.userId,
    requesterUserId: cashier.userId,
    now,
    settings: {
      refundApprovalLimitMinor: BigInt(ctx.settings.refundApprovalLimitMinor),
      refundWindowDays: ctx.settings.refundWindowDays,
      refundOwnSalesNeedApproval: ctx.settings.refundOwnSalesNeedApproval,
    },
  });
  // Only the owner completes such a refund alone; anyone else needs a second person who may
  // approve refunds, and nobody approves their own.
  const needsApprover = reasons.length > 0 && !cashier.isOwner;
  if (needsApprover) {
    if (!input.approver)
      throw new PosRuleError(
        409,
        'APPROVAL_REQUIRED',
        `This refund needs a second person (${reasons.join(', ')}).`,
      );
    if (input.approver.userId === cashier.userId)
      throw new PosRuleError(403, 'SELF_APPROVAL', 'Nobody approves their own refund.');
    if (!holds(input.approver, 'refunds.approve'))
      throw new PosRuleError(403, 'FORBIDDEN', 'This person may not approve refunds here.');
  }
  const payback = allocation.map((a) => ({
    paymentId: a.payment.id,
    kind: a.payment.kind,
    amountMinor: a.amountMinor,
    reference: a.reference,
  }));
  return {
    record: {
      kind: 'refund',
      membershipId: cashier.membershipId,
      shiftId: input.shift.id,
      saleId: refundable.sale.id,
      lines: input.lines.map((l) => ({
        position: l.position,
        quantity: l.quantity,
        ...(l.restock === undefined ? {} : { restock: l.restock }),
      })),
      reason: input.reason,
      note: input.note,
      payback: payback.map((p) => ({
        paymentId: p.paymentId,
        amountMinor: p.amountMinor.toString(),
        reference: p.reference,
      })),
      approval: needsApprover
        ? { approverMembershipId: input.approver!.membershipId, reasons }
        : null,
    },
    totalMinor: computed.totalMinor,
    lines: computed.lines,
    payback,
    approvalReasons: reasons,
    cashPaybackMinor: payback
      .filter((p) => p.kind === 'cash')
      .reduce((s, p) => s + p.amountMinor, 0n),
  };
}

/** Writes the refund and queues it; cash paid back must be in the drawer. */
export async function commitRefund(
  db: BridgeDb,
  prepared: PreparedRefund,
  input: { refundable: RefundableSale; shift: LocalShift; approver: StaffMember | null },
  now: Date = new Date(),
): Promise<{ refundId: string; refundNumber: string; totalMinor: bigint }> {
  await assertShiftUsable(db, input.shift);
  if (prepared.cashPaybackMinor > 0n) {
    const summary = await shiftSummary(db, input.shift);
    if (prepared.cashPaybackMinor > summary.expectedCashMinor)
      throw new PosRuleError(
        409,
        'INSUFFICIENT_CASH',
        'The drawer does not hold enough cash for this refund.',
      );
  }
  const [count] = await db.query(`SELECT count(*) AS n FROM refunds WHERE sale_id = ?`, [
    input.refundable.sale.id,
  ]);
  const refundNumber = formatRefundNumber(
    input.refundable.sale.receiptNumber,
    Number(count?.['n'] ?? 0) + 1,
  );
  const id = newId();
  const at = nowIso(now);
  const record: RefundRecord = { ...prepared.record, id, occurredAt: at };
  await db.transaction([
    {
      sql: `INSERT INTO refunds (id, sale_id, shift_id, membership_id, refund_number, reason, note, total_minor, occurred_at, approver_membership_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        record.saleId,
        record.shiftId,
        record.membershipId,
        refundNumber,
        record.reason,
        record.note,
        prepared.totalMinor.toString(),
        at,
        prepared.record.approval?.approverMembershipId ?? null,
      ],
    },
    ...prepared.lines.map((l) => ({
      sql: `INSERT INTO refund_lines (refund_id, sale_position, quantity, amount_minor) VALUES (?, ?, ?, ?)`,
      params: [id, l.position, quantityText(l.quantityMilli), l.amountMinor.toString()],
    })),
    ...prepared.payback.map((p) => ({
      sql: `INSERT INTO refund_payments (refund_id, payment_id, method_kind, amount_minor) VALUES (?, ?, ?, ?)`,
      params: [id, p.paymentId, p.kind, p.amountMinor.toString()],
    })),
    enqueueStatement(record, at),
  ]);
  return { refundId: id, refundNumber, totalMinor: prepared.totalMinor };
}

function quantityText(milliUnits: bigint): string {
  const whole = milliUnits / 1000n;
  const frac = (milliUnits % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
