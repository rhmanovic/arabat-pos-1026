import type { DeviceRecord, DeviceRole } from '@arabat/contracts';
import { PosRuleError, otherCashOutExceedsLimit, shiftOutcome } from '@arabat/pos-core';
import type { BridgeDb } from './bridge.js';
import { newId, nowIso } from './ids.js';
import { type OutboxStatus, enqueueStatement, outboxEntry } from './outbox.js';
import { type DeviceSettings, type StaffMember, holds } from './snapshot.js';

export interface LocalShift {
  id: string;
  membershipId: string;
  userId: string;
  openedAt: string;
  closedAt: string | null;
  openingCashMinor: bigint;
  countedCashMinor: bigint | null;
  expectedCashMinor: bigint | null;
  status: 'open' | 'closed';
  /** 'local': opened on this device (the primary); 'branch': the primary's shift, learned from sync. */
  origin: 'local' | 'branch';
  /** 'device' (closed here), 'forced' (a manager closed it here), 'server' (learned from sync). */
  closedBy: 'device' | 'forced' | 'server' | null;
}

/**
 * Whether the server has taken the shift (ADR-0112 amendment 3, the refused-shift cascade):
 * 'pending' until uploaded, 'refused' with the code while the server says no (selling is
 * blocked, the record is retried every sync), 'accepted' / 'duplicate' once taken, 'branch' for
 * the primary's shift a secondary device learned from the server.
 */
export interface ShiftAcceptance {
  status: OutboxStatus | 'branch';
  code: string | null;
  message: string | null;
  attempts: number;
}

const big = (v: unknown) => (v === null || v === undefined ? null : BigInt(String(v)));

const toShift = (r: Record<string, unknown>): LocalShift => ({
  id: String(r['id']),
  membershipId: String(r['membership_id']),
  userId: String(r['user_id']),
  openedAt: String(r['opened_at']),
  closedAt: r['closed_at'] === null ? null : String(r['closed_at']),
  openingCashMinor: big(r['opening_cash_minor'])!,
  countedCashMinor: big(r['counted_cash_minor']),
  expectedCashMinor: big(r['expected_cash_minor']),
  status: r['status'] as 'open' | 'closed',
  origin: (r['origin'] as 'local' | 'branch' | undefined) ?? 'local',
  closedBy: (r['closed_by'] as LocalShift['closedBy'] | undefined) ?? null,
});

/** The device's open shift, if any (one at a time: the device is one register). */
export async function openShiftOf(db: BridgeDb): Promise<LocalShift | null> {
  const [row] = await db.query(`SELECT * FROM shifts WHERE status = 'open'`);
  return row ? toShift(row) : null;
}

export async function getShift(db: BridgeDb, id: string): Promise<LocalShift | null> {
  const [row] = await db.query(`SELECT * FROM shifts WHERE id = ?`, [id]);
  return row ? toShift(row) : null;
}

export async function shiftAcceptance(db: BridgeDb, shift: LocalShift): Promise<ShiftAcceptance> {
  if (shift.origin === 'branch')
    return { status: 'branch', code: null, message: null, attempts: 0 };
  const entry = await outboxEntry(db, shift.id);
  return entry
    ? { status: entry.status, code: entry.code, message: entry.message, attempts: entry.attempts }
    : { status: 'pending', code: null, message: null, attempts: 0 };
}

/**
 * Nothing is sold, moved or refunded behind a shift the server refused (amendment 3): the
 * cashier sees why at once instead of piling up records that would all be refused
 * `SHIFT_REQUIRED`. A shift still waiting to be uploaded (offline) is fine.
 */
export async function assertShiftUsable(db: BridgeDb, shift: LocalShift): Promise<void> {
  if (shift.status !== 'open') throw new PosRuleError(409, 'SHIFT_CLOSED', 'This shift is closed.');
  const a = await shiftAcceptance(db, shift);
  if (a.status === 'refused')
    throw new PosRuleError(
      409,
      'SHIFT_NOT_ACCEPTED',
      `The server refused this shift (${a.code ?? 'refused'}): ${a.message ?? ''}`.trim(),
    );
}

/** Records of a shift on this device (a refused shift without any can be discarded). */
export async function shiftRecordCount(db: BridgeDb, shiftId: string): Promise<number> {
  const [row] = await db.query(
    `SELECT (SELECT count(*) FROM sales WHERE shift_id = ?) + (SELECT count(*) FROM cash_movements WHERE shift_id = ?)
          + (SELECT count(*) FROM refunds WHERE shift_id = ?) AS n`,
    [shiftId, shiftId, shiftId],
  );
  return Number(row?.['n'] ?? 0);
}

/**
 * Drops a shift the server refused when nothing was recorded in it: the cashier opens a new one
 * once the cause is fixed. A shift with records stays until the server takes it (its records are
 * retried with it).
 */
export async function discardRefusedShift(db: BridgeDb, shift: LocalShift): Promise<void> {
  const a = await shiftAcceptance(db, shift);
  if (a.status !== 'refused')
    throw new PosRuleError(
      409,
      'INVALID_STATE',
      'Only a shift the server refused can be discarded.',
    );
  if ((await shiftRecordCount(db, shift.id)) > 0)
    throw new PosRuleError(409, 'INVALID_STATE', 'This shift has records; it cannot be discarded.');
  await db.transaction([
    { sql: `DELETE FROM outbox WHERE id = ?`, params: [shift.id] },
    { sql: `DELETE FROM shifts WHERE id = ?`, params: [shift.id] },
  ]);
}

/** A cashier signed in with their PIN: uploaded as their last sign-in and the device audit log. */
export async function recordSignIn(
  db: BridgeDb,
  member: StaffMember,
  now: Date = new Date(),
): Promise<string> {
  const at = nowIso(now);
  const record: DeviceRecord = {
    kind: 'sign_in',
    id: newId(),
    occurredAt: at,
    membershipId: member.membershipId,
  };
  const st = enqueueStatement(record, at);
  await db.exec(st.sql, st.params);
  return record.id;
}

const notPrimary = () =>
  new PosRuleError(
    409,
    'NOT_PRIMARY_DEVICE',
    'Only the primary till opens and closes the branch shift and moves drawer cash.',
  );

/** Totals of a shift from the device's own records: the X report during, the Z report at close. */
export interface ShiftSummary {
  salesCount: number;
  salesTotalMinor: bigint;
  discountsMinor: bigint;
  refundsCount: number;
  refundsTotalMinor: bigint;
  byMethod: {
    methodId: string;
    kind: string;
    nameEn: string | null;
    nameAr: string | null;
    amountMinor: bigint;
  }[];
  cashSalesMinor: bigint;
  cashRefundsMinor: bigint;
  cashInMinor: bigint;
  cashOutMinor: bigint;
  openingCashMinor: bigint;
  /** opening + cash sales − cash refunds + pay-ins − pay-outs. */
  expectedCashMinor: bigint;
}

export async function shiftSummary(db: BridgeDb, shift: LocalShift): Promise<ShiftSummary> {
  const [sales] = await db.query(
    `SELECT count(*) AS n, coalesce(sum(CAST(total_minor AS INTEGER)), 0) AS total,
            coalesce(sum(CAST(line_discounts_minor AS INTEGER) + CAST(order_discount_minor AS INTEGER)), 0) AS discounts
     FROM sales WHERE shift_id = ?`,
    [shift.id],
  );
  const methods = await db.query(
    `SELECT p.method_id, p.method_kind, p.name_en, p.name_ar, sum(CAST(p.amount_minor AS INTEGER)) AS amount
     FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.shift_id = ? GROUP BY p.method_id, p.method_kind, p.name_en, p.name_ar
     ORDER BY p.method_kind = 'cash' DESC, p.name_en`,
    [shift.id],
  );
  const [refunds] = await db.query(
    `SELECT count(*) AS n, coalesce(sum(CAST(total_minor AS INTEGER)), 0) AS total FROM refunds WHERE shift_id = ?`,
    [shift.id],
  );
  const [cashRefunds] = await db.query(
    `SELECT coalesce(sum(CAST(rp.amount_minor AS INTEGER)), 0) AS total FROM refund_payments rp
     JOIN refunds r ON r.id = rp.refund_id WHERE r.shift_id = ? AND rp.method_kind = 'cash'`,
    [shift.id],
  );
  const moves = await db.query(
    `SELECT direction, coalesce(sum(CAST(amount_minor AS INTEGER)), 0) AS total FROM cash_movements WHERE shift_id = ? GROUP BY direction`,
    [shift.id],
  );
  const move = (d: string) =>
    BigInt(String(moves.find((m) => m['direction'] === d)?.['total'] ?? 0));
  const byMethod = methods.map((m) => ({
    methodId: String(m['method_id']),
    kind: String(m['method_kind']),
    nameEn: m['name_en'] === null ? null : String(m['name_en']),
    nameAr: m['name_ar'] === null ? null : String(m['name_ar']),
    amountMinor: BigInt(String(m['amount'])),
  }));
  const cashSalesMinor = byMethod
    .filter((m) => m.kind === 'cash')
    .reduce((s, m) => s + m.amountMinor, 0n);
  const cashRefundsMinor = BigInt(String(cashRefunds?.['total'] ?? 0));
  const cashInMinor = move('cash_in');
  const cashOutMinor = move('cash_out');
  return {
    salesCount: Number(sales?.['n'] ?? 0),
    salesTotalMinor: BigInt(String(sales?.['total'] ?? 0)),
    discountsMinor: BigInt(String(sales?.['discounts'] ?? 0)),
    refundsCount: Number(refunds?.['n'] ?? 0),
    refundsTotalMinor: BigInt(String(refunds?.['total'] ?? 0)),
    byMethod,
    cashSalesMinor,
    cashRefundsMinor,
    cashInMinor,
    cashOutMinor,
    openingCashMinor: shift.openingCashMinor,
    expectedCashMinor:
      shift.openingCashMinor + cashSalesMinor - cashRefundsMinor + cashInMinor - cashOutMinor,
  };
}

const forbidden = (message: string) => new PosRuleError(403, 'FORBIDDEN', message);

/**
 * Opens the branch shift on the primary with the counted drawer cash (ADR-0090: a count at
 * opening). A secondary device never opens one: it sells into the primary's (amendment 3).
 */
export async function openShift(
  db: BridgeDb,
  input: { cashier: StaffMember; countedCashMinor: bigint; note: string | null; role: DeviceRole },
  now: Date = new Date(),
): Promise<LocalShift> {
  if (input.role !== 'primary') throw notPrimary();
  if (!holds(input.cashier, 'shifts.operate'))
    throw forbidden('You are not allowed to open a shift.');
  if (input.countedCashMinor < 0n)
    throw new PosRuleError(400, 'INVALID_PRICE', 'Counted cash cannot be negative.');
  if (await openShiftOf(db))
    throw new PosRuleError(409, 'REGISTER_BUSY', 'A shift is already open on this device.');
  const id = newId();
  const at = nowIso(now);
  const record: DeviceRecord = {
    kind: 'shift_open',
    id,
    occurredAt: at,
    membershipId: input.cashier.membershipId,
    countedCashMinor: input.countedCashMinor.toString(),
    note: input.note,
  };
  await db.transaction([
    {
      sql: `INSERT INTO shifts (id, membership_id, user_id, opened_at, opening_cash_minor, status) VALUES (?, ?, ?, ?, ?, 'open')`,
      params: [
        id,
        input.cashier.membershipId,
        input.cashier.userId,
        at,
        input.countedCashMinor.toString(),
      ],
    },
    enqueueStatement(record, at),
  ]);
  return (await getShift(db, id))!;
}

/**
 * Closes the branch shift with the counted cash; the Z summary comes from the local records.
 * Only the person who opened it closes it. `forced`: a manager present at the till
 * (`registers.manage`) closes an absent cashier's shift with their own PIN; a note is required
 * and the server lists it for review (amendment 3).
 */
export async function closeShift(
  db: BridgeDb,
  input: {
    cashier: StaffMember;
    shift: LocalShift;
    countedCashMinor: bigint;
    note: string | null;
    role: DeviceRole;
    forced?: boolean;
  },
  now: Date = new Date(),
): Promise<{
  shift: LocalShift;
  summary: ShiftSummary;
  discrepancyMinor: bigint;
  outcome: ReturnType<typeof shiftOutcome>;
}> {
  // A secondary may still close a shift it opened itself before amendment 3.
  if (input.role !== 'primary' && input.shift.origin !== 'local') throw notPrimary();
  if (input.shift.status !== 'open')
    throw new PosRuleError(409, 'SHIFT_CLOSED', 'This shift is closed.');
  const forced = input.forced === true;
  if (forced) {
    if (!holds(input.cashier, 'registers.manage'))
      throw forbidden('Closing another person’s shift needs a manager.');
    if (!input.note) throw new PosRuleError(400, 'REASON_REQUIRED', 'A forced close needs a note.');
  } else {
    if (!holds(input.cashier, 'shifts.operate'))
      throw forbidden('You are not allowed to close a shift.');
    if (input.shift.membershipId !== input.cashier.membershipId)
      throw forbidden(
        'Only the person who opened the shift closes it; a manager can force-close it.',
      );
  }
  if (input.countedCashMinor < 0n)
    throw new PosRuleError(400, 'INVALID_PRICE', 'Counted cash cannot be negative.');
  const summary = await shiftSummary(db, input.shift);
  const at = nowIso(now);
  const record: DeviceRecord = {
    kind: 'shift_close',
    id: newId(),
    occurredAt: at,
    membershipId: input.cashier.membershipId,
    shiftId: input.shift.id,
    countedCashMinor: input.countedCashMinor.toString(),
    note: input.note,
    forced,
  };
  await db.transaction([
    {
      sql: `UPDATE shifts SET status = 'closed', closed_at = ?, counted_cash_minor = ?, expected_cash_minor = ?, closed_by = ?
            WHERE id = ? AND status = 'open'`,
      params: [
        at,
        input.countedCashMinor.toString(),
        summary.expectedCashMinor.toString(),
        forced ? 'forced' : 'device',
        input.shift.id,
      ],
    },
    enqueueStatement(record, at),
  ]);
  const discrepancyMinor = input.countedCashMinor - summary.expectedCashMinor;
  return {
    shift: (await getShift(db, input.shift.id))!,
    summary,
    discrepancyMinor,
    outcome: shiftOutcome(discrepancyMinor, 0n),
  };
}

/** A pay-in / pay-out of the drawer ("other"); custody moves stay online (DEVICE_API.md §4). */
export async function recordCashMovement(
  db: BridgeDb,
  input: {
    cashier: StaffMember;
    shift: LocalShift;
    direction: 'cash_in' | 'cash_out';
    amountMinor: bigint;
    note: string | null;
    settings: DeviceSettings;
    role: DeviceRole;
  },
  now: Date = new Date(),
): Promise<{ id: string; limitExceeded: boolean }> {
  if (input.role !== 'primary') throw notPrimary();
  if (!holds(input.cashier, 'cash.move')) throw forbidden('You are not allowed to move cash.');
  await assertShiftUsable(db, input.shift);
  if (input.amountMinor <= 0n)
    throw new PosRuleError(400, 'INVALID_PRICE', 'Amount must be greater than zero.');
  const summary = await shiftSummary(db, input.shift);
  let limitExceeded = false;
  if (input.direction === 'cash_out') {
    if (input.amountMinor > summary.expectedCashMinor)
      throw new PosRuleError(409, 'INSUFFICIENT_CASH', 'The drawer does not hold that much cash.');
    limitExceeded = otherCashOutExceedsLimit({
      amountMinor: input.amountMinor,
      shiftOtherTotalMinor: summary.cashOutMinor,
      perMovementLimitMinor: BigInt(input.settings.cashOutOtherLimitMinor),
      perShiftLimitMinor: BigInt(input.settings.cashOutOtherShiftLimitMinor),
    });
    // Above the company limit only the owner may take cash out without a manager (D2).
    if (limitExceeded && !input.cashier.isOwner)
      throw new PosRuleError(
        409,
        'APPROVAL_REQUIRED',
        'This pay-out is above the company limit. Ask a manager online.',
      );
  }
  const id = newId();
  const at = nowIso(now);
  const record: DeviceRecord = {
    kind: 'cash_movement',
    id,
    occurredAt: at,
    membershipId: input.cashier.membershipId,
    shiftId: input.shift.id,
    direction: input.direction,
    amountMinor: input.amountMinor.toString(),
    note: input.note,
  };
  await db.transaction([
    {
      sql: `INSERT INTO cash_movements (id, shift_id, membership_id, direction, amount_minor, note, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        input.shift.id,
        input.cashier.membershipId,
        input.direction,
        input.amountMinor.toString(),
        input.note,
        at,
      ],
    },
    enqueueStatement(record, at),
  ]);
  return { id, limitExceeded };
}

export async function listCashMovements(db: BridgeDb, shiftId: string) {
  const rows = await db.query(
    `SELECT * FROM cash_movements WHERE shift_id = ? ORDER BY occurred_at DESC`,
    [shiftId],
  );
  return rows.map((r) => ({
    id: String(r['id']),
    direction: r['direction'] as 'cash_in' | 'cash_out',
    amountMinor: BigInt(String(r['amount_minor'])),
    note: r['note'] === null ? null : String(r['note']),
    occurredAt: String(r['occurred_at']),
  }));
}
