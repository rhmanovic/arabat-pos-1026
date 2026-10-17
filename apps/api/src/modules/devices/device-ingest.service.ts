import {
  type DeviceRecord,
  type DeviceRecordResult,
  type DeviceUploadResult,
  OVERRIDABLE_PERMISSIONS,
  deviceRecordSchema,
} from '@arabat/contracts';
import { Money, PricingError, formatQuantity, parseQuantity, priceCart } from '@arabat/money';
import { can } from '@arabat/permissions';
import {
  formatDeviceReceiptNumber,
  otherCashOutExceedsLimit,
  shiftOutcome,
  toDiscount,
} from '@arabat/pos-core';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { Device } from '../../kernel/access/device-resolver.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { rules } from '../../kernel/errors/pos-rule.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { AccessRepository } from '../iam/access.repository.js';
import { consumptionCosts, stockConsumption } from '../inventory/consumption.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import {
  accountBalance,
  lockAccounts,
  postEntries,
  registerAccount,
} from '../payments/cash-ledger.js';
import { PrintJobsService } from '../printing/print-jobs.service.js';
import { RefundsService } from '../refunds/refunds.service.js';
import { orderLines, orders, payments, saleLines, sales } from '../sales/sales.schema.js';

const CURRENCY = 'KWD' as const;
/** A record dated more than this after its upload has a wrong device clock (gap B). */
const CLOCK_SKEW_MS = 10 * 60 * 1000;
const kwd = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toDecimalString();

type Row = Record<string, unknown>;
type SaleRecord = Extract<DeviceRecord, { kind: 'sale' }>;
type RefundRecord = Extract<DeviceRecord, { kind: 'refund' }>;
type CashRecord = Extract<DeviceRecord, { kind: 'cash_movement' }>;
type OpenRecord = Extract<DeviceRecord, { kind: 'shift_open' }>;
type CloseRecord = Extract<DeviceRecord, { kind: 'shift_close' }>;

interface ShiftRow {
  id: string;
  registerId: string;
  branchId: string;
  membershipId: string;
  status: string;
  openedAt: Date;
}

/** What an accepted record produced and what managers must look at. */
interface Outcome {
  result: Record<string, unknown>;
  outsideShift: boolean;
  negativeStock: { variantId: string; balance: string }[];
}

/**
 * Sync upload for local-first devices (ADR-0112 §5–§7b, docs/DEVICE_API.md). Each record is
 * ingested exactly once (the device's id is the key), in its own transaction, through the same
 * ledger code as the browser till: `StockLedgerService.apply`, `cash-ledger.ts`, the audit log,
 * the refunds engine and print jobs. The server accepts what the device decided (prices, limits,
 * overrides, negative stock) and refuses only what cannot be a valid record; refused records are
 * kept for the managers.
 */
@Injectable()
export class DeviceIngestService {
  private readonly logger = new Logger(DeviceIngestService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessRepository,
    private readonly ledger: StockLedgerService,
    private readonly printJobs: PrintJobsService,
    private readonly audit: AuditService,
    private readonly refunds: RefundsService,
  ) {}

  async upload(
    device: Device,
    records: { id: string; kind: string }[],
    ip: string,
  ): Promise<DeviceUploadResult> {
    const results: DeviceRecordResult[] = [];
    // In the order sent: a shift must exist before its sales, a sale before its refunds.
    for (const raw of records) results.push(await this.one(device, raw, ip));
    await this.database.withMerchantTx(device.merchantId, (tx) =>
      tx.execute(sql`update pos_devices set last_sync_at = now() where id = ${device.id}`),
    );
    return { serverTime: new Date().toISOString(), results };
  }

  private async one(
    device: Device,
    raw: { id: string; kind: string },
    ip: string,
  ): Promise<DeviceRecordResult> {
    const hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
    const base = { id: raw.id, kind: raw.kind, result: null, code: null, message: null };
    const [existing] = await this.database.withMerchantTx(device.merchantId, async (tx) => {
      const { rows } = await tx.execute(sql`
        select device_id, status, request_hash, result, clock_skew from device_records where id = ${raw.id}`);
      return rows as Row[];
    });
    if (existing) {
      if (existing['device_id'] !== device.id)
        return refusal(base, 'WRONG_DEVICE', 'This id belongs to another device.');
      if (existing['status'] === 'accepted')
        return existing['request_hash'] === hash
          ? {
              ...base,
              status: 'duplicate',
              result: (existing['result'] as Record<string, unknown>) ?? null,
              clockSkew: Boolean(existing['clock_skew']),
            }
          : refusal(
              base,
              'IDEMPOTENCY_CONFLICT',
              'A different record was already accepted with this id.',
            );
      // A refused record is tried again (it may have arrived before its shift or sale).
    }

    const parsed = deviceRecordSchema.safeParse(raw);
    const now = new Date();
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = `${issue?.path.join('.') || 'record'}: ${issue?.message ?? 'invalid'}`;
      await this.storeRefused(device, raw, hash, now, false, 'VALIDATION_FAILED', message);
      return refusal(base, 'VALIDATION_FAILED', message);
    }
    const record = parsed.data;
    const occurredAt = new Date(record.occurredAt);
    const ahead = occurredAt.getTime() - now.getTime() > CLOCK_SKEW_MS;
    try {
      const outcome = await this.database.withMerchantTx(device.merchantId, async (tx) => {
        const done = await this.apply(tx, device, record, occurredAt, hash, ip);
        const clockSkew = ahead || done.outsideShift;
        const stored = await tx.execute(sql`
          insert into device_records (id, merchant_id, device_id, branch_id, kind, status, request_hash, payload,
                                      result, occurred_at, clock_skew)
          values (${record.id}, ${device.merchantId}, ${device.id}, ${device.branchId}, ${record.kind}, 'accepted',
                  ${hash}, ${JSON.stringify(raw)}::jsonb, ${JSON.stringify(done.result)}::jsonb,
                  ${occurredAt.toISOString()}::timestamptz, ${clockSkew})
          on conflict (id) do update set status = 'accepted', request_hash = excluded.request_hash,
            payload = excluded.payload, result = excluded.result, error_code = null, error_message = null,
            occurred_at = excluded.occurred_at, received_at = now(), clock_skew = excluded.clock_skew,
            attempts = device_records.attempts + 1
          where device_records.status = 'refused'
          returning id`);
        // Another upload of the same record won meanwhile: answer from what it stored.
        if (stored.rows.length === 0) throw new ConcurrentUpload();
        // The earlier refusal of this record is settled by its acceptance.
        await tx.execute(sql`
          update device_exceptions set resolved_at = now(), resolution_note = 'accepted on a later upload'
          where record_id = ${record.id} and kind = 'refused' and resolved_at is null`);
        const exceptions: { kind: string; details: Record<string, unknown> }[] = [];
        if (clockSkew)
          exceptions.push({
            kind: 'clock_skew',
            details: {
              occurredAt: occurredAt.toISOString(),
              receivedAt: now.toISOString(),
              outsideShift: done.outsideShift,
              recordKind: record.kind,
            },
          });
        for (const n of done.negativeStock)
          exceptions.push({
            kind: 'negative_stock',
            details: { ...n, saleId: record.id, receiptNumber: done.result['receiptNumber'] },
          });
        for (const e of exceptions)
          await tx.execute(sql`
            insert into device_exceptions (id, merchant_id, branch_id, device_id, record_id, kind, details)
            values (${newId()}, ${device.merchantId}, ${device.branchId}, ${device.id}, ${record.id}, ${e.kind},
                    ${JSON.stringify(e.details)}::jsonb)`);
        return { ...done, clockSkew };
      });
      return {
        ...base,
        status: 'accepted',
        result: outcome.result,
        clockSkew: outcome.clockSkew,
      };
    } catch (error) {
      if (error instanceof ConcurrentUpload || isUniqueViolation(error, 'device_records_pkey'))
        return this.one(device, raw, ip);
      const known = toAppError(error);
      if (!known)
        this.logger.error(`Device record ${record.id} failed: ${(error as Error).stack ?? error}`);
      const code = known?.code ?? 'INTERNAL_ERROR';
      const message = known?.message ?? 'The server could not record this.';
      await this.storeRefused(device, raw, hash, occurredAt, ahead, code, message);
      return refusal(base, code, message);
    }
  }

  private async storeRefused(
    device: Device,
    raw: { id: string; kind: string },
    hash: string,
    occurredAt: Date,
    clockSkew: boolean,
    code: string,
    message: string,
  ) {
    const kind = KINDS.has(raw.kind) ? raw.kind : null;
    // An unknown kind cannot be stored as a record; it is answered and nothing else.
    if (!kind) return;
    const when = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
    await this.database.withMerchantTx(device.merchantId, async (tx) => {
      await tx.execute(sql`
        insert into device_records (id, merchant_id, device_id, branch_id, kind, status, request_hash, payload,
                                    error_code, error_message, occurred_at, clock_skew)
        values (${raw.id}, ${device.merchantId}, ${device.id}, ${device.branchId}, ${kind}, 'refused', ${hash},
                ${JSON.stringify(raw)}::jsonb, ${code}, ${message}, ${when.toISOString()}::timestamptz, ${clockSkew})
        on conflict (id) do update set request_hash = excluded.request_hash, payload = excluded.payload,
          error_code = excluded.error_code, error_message = excluded.error_message,
          occurred_at = excluded.occurred_at, received_at = now(), clock_skew = excluded.clock_skew,
          attempts = device_records.attempts + 1
        where device_records.status = 'refused'`);
      await tx.execute(sql`
        insert into device_exceptions (id, merchant_id, branch_id, device_id, record_id, kind, details)
        values (${newId()}, ${device.merchantId}, ${device.branchId}, ${device.id}, ${raw.id}, 'refused',
                ${JSON.stringify({ recordKind: kind, code, message })}::jsonb)
        on conflict (merchant_id, record_id) where kind = 'refused'
        do update set details = excluded.details, resolved_at = null, resolved_by_user_id = null,
          resolution_note = null`);
    });
  }

  private apply(
    tx: Transaction,
    device: Device,
    record: DeviceRecord,
    occurredAt: Date,
    hash: string,
    ip: string,
  ): Promise<Outcome> {
    switch (record.kind) {
      case 'shift_open':
        return this.openShift(tx, device, record, occurredAt, ip);
      case 'cash_movement':
        return this.cashMovement(tx, device, record, occurredAt, ip);
      case 'sale':
        return this.sale(tx, device, record, occurredAt, ip);
      case 'refund':
        return this.refund(tx, device, record, occurredAt, hash, ip);
      case 'shift_close':
        return this.closeShift(tx, device, record, occurredAt, ip);
    }
  }

  // ------------------------------------------------------------ people and shifts

  /**
   * The person at the till as an actor of the company. They must be a member who may use the
   * POS at the device's branch, or one deactivated after the record happened (it was valid then).
   */
  private async actorFor(
    tx: Transaction,
    device: Device,
    membershipId: string,
    occurredAt: Date,
  ): Promise<MerchantActor> {
    const m = await this.access.loadMembershipAccess(tx, membershipId);
    if (!m || m.merchantId !== device.merchantId)
      throw new AppError(403, 'MEMBER_NOT_ALLOWED', 'This person is not a member of the company.');
    if (m.access.membershipActive) {
      if (!can(m.access, 'pos.access', device.branchId))
        throw new AppError(
          403,
          'MEMBER_NOT_ALLOWED',
          'This person may not use the point of sale at this branch.',
        );
    } else {
      const [row] = (
        await tx.execute(sql`select updated_at from memberships where id = ${membershipId}`)
      ).rows as Row[];
      if (!row || new Date(row['updated_at'] as string) < occurredAt)
        throw new AppError(403, 'MEMBER_NOT_ALLOWED', 'This person was no longer active then.');
    }
    return {
      realm: 'merchant',
      interface: 'pos',
      sessionId: `device:${device.id}`,
      userId: m.userId,
      merchantId: m.merchantId,
      membershipId: m.membershipId,
      boundBranchId: device.branchId,
      access: { ...m.access, membershipActive: true },
    };
  }

  /** A shift of this device's register, locked. */
  private async deviceShift(tx: Transaction, device: Device, shiftId: string): Promise<ShiftRow> {
    const [row] = (
      await tx.execute(sql`
        select id, register_id, branch_id, membership_id, status, opened_at from shifts
        where id = ${shiftId} for update`)
    ).rows as Row[];
    if (!row) throw new AppError(409, 'SHIFT_REQUIRED', 'The shift has not been uploaded.');
    if (row['register_id'] !== device.registerId)
      throw new AppError(409, 'WRONG_DEVICE', 'This shift belongs to another register.');
    return {
      id: String(row['id']),
      registerId: String(row['register_id']),
      branchId: String(row['branch_id']),
      membershipId: String(row['membership_id']),
      status: String(row['status']),
      openedAt: new Date(row['opened_at'] as string),
    };
  }

  private openShiftOf(tx: Transaction, device: Device, shiftId: string) {
    return this.deviceShift(tx, device, shiftId).then((s) => {
      if (s.status !== 'open') throw new AppError(409, 'SHIFT_CLOSED', 'This shift is closed.');
      return s;
    });
  }

  private async openShift(
    tx: Transaction,
    device: Device,
    r: OpenRecord,
    occurredAt: Date,
    ip: string,
  ): Promise<Outcome> {
    const actor = await this.actorFor(tx, device, r.membershipId, occurredAt);
    const countedMinor = BigInt(r.countedCashMinor);
    const drawer = await registerAccount(tx, device.registerId);
    await lockAccounts(tx, [drawer.id]);
    const [register] = (
      await tx.execute(sql`
        select needs_count, discrepancy_tolerance_minor::text as tolerance from registers
        where id = ${device.registerId}`)
    ).rows as Row[];
    const [busy] = (
      await tx.execute(
        sql`select id from shifts where register_id = ${device.registerId} and status = 'open'`,
      )
    ).rows as Row[];
    if (busy)
      throw new AppError(409, 'REGISTER_BUSY', 'Another shift is already open on this register.');
    const expectedMinor = await accountBalance(tx, drawer.id);
    // Same attribution as the browser till: after a forced close without a count the
    // difference is the earlier shift's; the drawer's first count sets the balance.
    const [last] = (
      await tx.execute(sql`
        select id, close_type, legacy_open from shifts
        where register_id = ${device.registerId} and status = 'closed' order by closed_at desc limit 1`)
    ).rows as Row[];
    const followsShiftId =
      last && last['close_type'] === 'forced_uncounted' && !last['legacy_open']
        ? String(last['id'])
        : null;
    const initial = !followsShiftId && Boolean(register!['needs_count']);
    const differenceMinor = countedMinor - expectedMinor;
    await tx.execute(sql`
      insert into shifts (id, merchant_id, branch_id, register_id, membership_id, user_id, opening_float_minor,
                          opening_expected_minor, opening_discrepancy_minor, opening_is_initial,
                          opening_follows_shift_id, opening_note, opened_at)
      values (${r.id}, ${device.merchantId}, ${device.branchId}, ${device.registerId}, ${actor.membershipId},
              ${actor.userId}, ${countedMinor}, ${expectedMinor}, ${initial ? null : differenceMinor}, ${initial},
              ${followsShiftId}, ${r.note}, ${occurredAt.toISOString()}::timestamptz)`);
    await postEntries(tx, [
      {
        merchantId: device.merchantId,
        accountId: drawer.id,
        amountMinor: differenceMinor,
        entryType: 'adjustment',
        sourceType: initial ? 'register_initial_count' : 'shift_open',
        sourceId: r.id,
        description: r.note,
        createdByUserId: actor.userId,
        shiftId: r.id,
      },
    ]);
    await tx.execute(sql`update registers set needs_count = false where id = ${device.registerId}`);
    await this.record(tx, actor, 'shift.opened', 'shift', r.id, ip, device, {
      registerId: device.registerId,
      expected: kwd(expectedMinor),
      counted: kwd(countedMinor),
      difference: kwd(differenceMinor),
      initialCount: initial,
      followsShiftId,
    });
    return {
      result: { shiftId: r.id, expectedCashMinor: String(expectedMinor) },
      outsideShift: false,
      negativeStock: [],
    };
  }

  private async closeShift(
    tx: Transaction,
    device: Device,
    r: CloseRecord,
    occurredAt: Date,
    ip: string,
  ): Promise<Outcome> {
    const actor = await this.actorFor(tx, device, r.membershipId, occurredAt);
    const shift = await this.openShiftOf(tx, device, r.shiftId);
    const countedMinor = BigInt(r.countedCashMinor);
    const drawer = await registerAccount(tx, device.registerId);
    await lockAccounts(tx, [drawer.id]);
    const balanceMinor = await accountBalance(tx, drawer.id);
    const discrepancy = countedMinor - balanceMinor;
    const [register] = (
      await tx.execute(
        sql`select discrepancy_tolerance_minor::text as tolerance from registers where id = ${device.registerId}`,
      )
    ).rows as Row[];
    await postEntries(tx, [
      {
        merchantId: device.merchantId,
        accountId: drawer.id,
        amountMinor: discrepancy,
        entryType: 'adjustment',
        sourceType: 'shift_close',
        sourceId: shift.id,
        description: r.note,
        createdByUserId: actor.userId,
        shiftId: shift.id,
      },
    ]);
    await tx.execute(sql`
      update shifts set status = 'closed', closed_at = ${occurredAt.toISOString()}::timestamptz,
        closed_by_user_id = ${actor.userId}, close_type = 'normal', expected_cash_minor = ${balanceMinor},
        counted_cash_minor = ${countedMinor}, discrepancy_minor = ${discrepancy},
        discrepancy_tolerance_minor = ${String(register!['tolerance'])}::bigint, closing_note = ${r.note},
        version = version + 1
      where id = ${shift.id}`);
    await this.record(tx, actor, 'shift.closed', 'shift', shift.id, ip, device, {
      expected: kwd(balanceMinor),
      counted: kwd(countedMinor),
      discrepancy: kwd(discrepancy),
    });
    return {
      result: {
        shiftId: shift.id,
        expectedCashMinor: String(balanceMinor),
        discrepancyMinor: String(discrepancy),
        outcome: shiftOutcome(discrepancy, BigInt(String(register!['tolerance']))),
      },
      outsideShift: occurredAt < shift.openedAt,
      negativeStock: [],
    };
  }

  // ------------------------------------------------------------ cash

  /** A pay-in / pay-out of the drawer ("other"); posted as the device recorded it. */
  private async cashMovement(
    tx: Transaction,
    device: Device,
    r: CashRecord,
    occurredAt: Date,
    ip: string,
  ): Promise<Outcome> {
    const actor = await this.actorFor(tx, device, r.membershipId, occurredAt);
    const shift = await this.openShiftOf(tx, device, r.shiftId);
    const amountMinor = BigInt(r.amountMinor);
    if (amountMinor <= 0n)
      throw new AppError(400, 'INVALID_PRICE', 'Amount must be greater than zero.');
    const drawer = await registerAccount(tx, device.registerId);
    await lockAccounts(tx, [drawer.id]);
    // Flagged for the manager's review like a browser cash-out above the company limit.
    let limitExceeded = false;
    if (r.direction === 'cash_out') {
      const [policy] = (
        await tx.execute(sql`
          select coalesce((select cash_out_other_limit_minor from sales_settings where merchant_id = ${device.merchantId}), 20000)::text as one,
                 coalesce((select cash_out_other_shift_limit_minor from sales_settings where merchant_id = ${device.merchantId}), 50000)::text as shift,
                 (select coalesce(sum(amount_minor), 0) from cash_movements
                  where shift_id = ${shift.id} and kind = 'cash_out' and reason = 'other' and status = 'posted')::text as total`)
      ).rows as Row[];
      limitExceeded = otherCashOutExceedsLimit({
        amountMinor,
        shiftOtherTotalMinor: BigInt(String(policy!['total'])),
        perMovementLimitMinor: BigInt(String(policy!['one'])),
        perShiftLimitMinor: BigInt(String(policy!['shift'])),
      });
    }
    await tx.execute(sql`
      insert into cash_movements (id, merchant_id, shift_id, branch_id, register_id, kind, amount_minor, reason,
                                  note, idempotency_key, created_by_user_id, created_at, status, limit_exceeded)
      values (${r.id}, ${device.merchantId}, ${shift.id}, ${device.branchId}, ${device.registerId}, ${r.direction},
              ${amountMinor}, 'other', ${r.note}, ${r.id}, ${actor.userId}, ${occurredAt.toISOString()}::timestamptz,
              'posted', ${limitExceeded})`);
    await postEntries(tx, [
      {
        merchantId: device.merchantId,
        accountId: drawer.id,
        amountMinor: r.direction === 'cash_in' ? amountMinor : -amountMinor,
        entryType: 'adjustment',
        sourceType: 'cash_movement',
        sourceId: r.id,
        description: r.note ?? 'other',
        createdByUserId: actor.userId,
        shiftId: shift.id,
      },
    ]);
    await this.record(tx, actor, `shift.${r.direction}`, 'shift', shift.id, ip, device, {
      movementId: r.id,
      amount: kwd(amountMinor),
      reason: 'other',
      ...(limitExceeded ? { limitExceeded: true } : {}),
    });
    return {
      result: { movementId: r.id, limitExceeded },
      outsideShift: occurredAt < shift.openedAt,
      negativeStock: [],
    };
  }

  // ------------------------------------------------------------ sales

  /**
   * A completed device sale, at the device's prices (§5): the figures must add up exactly
   * (priced again with `priceCart` from the device's unit prices and discounts), the receipt
   * number must be in the device's series, and every variant must exist. Stock may go negative;
   * each balance it drives below zero becomes a stock exception.
   */
  private async sale(
    tx: Transaction,
    device: Device,
    r: SaleRecord,
    occurredAt: Date,
    ip: string,
  ): Promise<Outcome> {
    const actor = await this.actorFor(tx, device, r.membershipId, occurredAt);
    const shift = await this.openShiftOf(tx, device, r.shiftId);
    const [codes] = (
      await tx.execute(sql`
        select b.code as branch, g.code as register from branches b, registers g
        where b.id = ${device.branchId} and g.id = ${device.registerId}`)
    ).rows as Row[];
    const prefix = formatDeviceReceiptNumber(
      String(codes!['branch']),
      String(codes!['register']),
      0,
    )
      .slice(0, -6)
      .toLowerCase();
    if (
      !r.receiptNumber.toLowerCase().startsWith(prefix) ||
      r.receiptNumber.length !== prefix.length + 6
    )
      throw new AppError(
        400,
        'RECEIPT_NUMBER_INVALID',
        `Device receipt numbers are ${prefix.toUpperCase()}NNNNNN.`,
      );

    // Every variant must exist in the company (archived or moved since is fine: it was sold).
    const ids = [...new Set(r.lines.map((l) => l.variantId))];
    const variantRows = (
      await tx.execute(sql`
        select v.id, v.product_id, v.cost_minor::text as cost, v.name_en as variant_name_en,
               v.name_ar as variant_name_ar, v.sku, p.name_en, p.name_ar
        from product_variants v join products p on p.id = v.product_id
        where v.id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`)
    ).rows as Row[];
    const items = new Map(variantRows.map((v) => [String(v['id']), v]));
    const unknown = r.lines.findIndex((l) => !items.has(l.variantId));
    if (unknown >= 0)
      throw new AppError(409, 'UNKNOWN_VARIANT', `lines.${unknown}: unknown product variant.`);

    // The figures must be what the device's prices and discounts give.
    const lines = r.lines.map((l, i) => {
      let quantityMilli: bigint;
      try {
        quantityMilli = parseQuantity(l.quantity);
      } catch {
        throw new AppError(400, 'INVALID_QUANTITY', `lines.${i}.quantity is not a quantity.`);
      }
      return {
        input: l,
        quantityMilli,
        unitPriceMinor: BigInt(l.unitPriceMinor),
        listUnitPriceMinor: BigInt(l.listUnitPriceMinor),
        discount: rules(() => toDiscount(l.discount, `lines.${i}.discount`)),
      };
    });
    let priced;
    try {
      priced = priceCart(
        lines.map((l) => ({
          unitPriceMinor: l.unitPriceMinor,
          quantityMilli: l.quantityMilli,
          discount: l.discount,
        })),
        rules(() => toDiscount(r.orderDiscount, 'orderDiscount')),
      );
    } catch (error) {
      if (error instanceof PricingError)
        throw new AppError(400, 'TOTALS_MISMATCH', `The sale cannot be priced: ${error.message}`);
      throw error;
    }
    const mismatch = (path: string) =>
      new AppError(400, 'TOTALS_MISMATCH', `${path} does not add up.`);
    priced.lines.forEach((p, i) => {
      const l = r.lines[i]!;
      if (BigInt(l.grossMinor) !== p.grossMinor) throw mismatch(`lines.${i}.grossMinor`);
      if (BigInt(l.lineDiscountMinor) !== p.lineDiscountMinor)
        throw mismatch(`lines.${i}.lineDiscountMinor`);
      if (BigInt(l.orderDiscountMinor) !== p.orderDiscountMinor)
        throw mismatch(`lines.${i}.orderDiscountMinor`);
      if (BigInt(l.netMinor) !== p.netMinor) throw mismatch(`lines.${i}.netMinor`);
    });
    if (BigInt(r.subtotalMinor) !== priced.subtotalMinor) throw mismatch('subtotalMinor');
    if (BigInt(r.lineDiscountsMinor) !== priced.lineDiscountsMinor)
      throw mismatch('lineDiscountsMinor');
    if (BigInt(r.orderDiscountMinor) !== priced.orderDiscountMinor)
      throw mismatch('orderDiscountMinor');
    if (BigInt(r.totalMinor) !== priced.totalMinor) throw mismatch('totalMinor');
    if (priced.totalMinor === 0n && !r.zeroTotalReason)
      throw new AppError(400, 'REASON_REQUIRED', 'A sale with nothing to pay needs a reason.');

    // Payments: they cover the total exactly, with methods of this company.
    const paid = r.payments.reduce((s, p) => s + BigInt(p.amountMinor), 0n);
    if (paid !== priced.totalMinor)
      throw new AppError(400, 'PAYMENT_TOTAL_MISMATCH', 'Payments must equal the total.');
    const methodIds = [...new Set(r.payments.map((p) => p.methodId))];
    const methods = methodIds.length
      ? new Map(
          (
            (
              await tx.execute(sql`
                select id, kind, name_en, name_ar, gateway_provider, financial_account_id from payment_methods
                where id in (${sql.join(
                  methodIds.map((id) => sql`${id}`),
                  sql`, `,
                )})`)
            ).rows as Row[]
          ).map((m) => [String(m['id']), m]),
        )
      : new Map<string, Row>();
    r.payments.forEach((p, i) => {
      const m = methods.get(p.methodId);
      if (!m)
        throw new AppError(409, 'PAYMENT_METHOD_UNAVAILABLE', `payments.${i}: unknown method.`);
      if (m['gateway_provider'])
        throw new AppError(
          409,
          'PAYMENT_NOT_VERIFIED',
          `payments.${i}: gateway payments are online only.`,
        );
      const amount = BigInt(p.amountMinor);
      const change = BigInt(p.changeMinor);
      const tendered = p.tenderedMinor === null ? null : BigInt(p.tenderedMinor);
      const fee = BigInt(p.feeMinor);
      if (
        amount <= 0n ||
        fee > amount ||
        (m['kind'] !== 'cash' && change !== 0n) ||
        (m['kind'] === 'cash' && fee !== 0n) ||
        (tendered === null ? change !== 0n : tendered !== amount + change)
      )
        throw new AppError(400, 'PAYMENT_TOTAL_MISMATCH', `payments.${i} does not add up.`);
    });

    // Supervisor override recorded at the till (BR-177): a different, current member.
    let overrideId: string | null = null;
    if (r.override) {
      const approver = await this.access.loadMembershipAccess(tx, r.override.approverMembershipId);
      if (!approver || approver.merchantId !== device.merchantId)
        throw new AppError(
          409,
          'OVERRIDE_INVALID',
          'The supervisor is not a member of the company.',
        );
      if (approver.userId === actor.userId)
        throw new AppError(403, 'OVERRIDE_SELF', 'A supervisor cannot approve their own sale.');
      const bad = r.override.rights.find(
        (k) => !(OVERRIDABLE_PERMISSIONS as readonly string[]).includes(k),
      );
      if (bad) throw new AppError(409, 'OVERRIDE_INVALID', `${bad} cannot be lent.`);
      overrideId = newId();
      const at = occurredAt.toISOString();
      await tx.execute(sql`
        insert into sale_overrides (id, merchant_id, branch_id, shift_id, cashier_membership_id, cashier_user_id,
                                    approver_membership_id, approver_user_id, permissions, note, status, kinds,
                                    expires_at, used_at, created_at)
        values (${overrideId}, ${device.merchantId}, ${device.branchId}, ${shift.id}, ${actor.membershipId},
                ${actor.userId}, ${approver.membershipId}, ${approver.userId},
                ${`{${r.override.rights.join(',')}}`}::text[], ${r.override.note}, 'used',
                ${`{${r.override.rights.join(',')}}`}::text[], ${at}::timestamptz, ${at}::timestamptz, ${at}::timestamptz)`);
    }

    // The order the sale completes (an immutable record of the cart, as at the browser till).
    const orderId = newId();
    await tx.insert(orders).values({
      id: orderId,
      merchantId: device.merchantId,
      branchId: device.branchId,
      registerId: device.registerId,
      shiftId: shift.id,
      membershipId: actor.membershipId,
      userId: actor.userId,
      status: 'completed',
      orderDiscountType: r.orderDiscount?.type ?? null,
      orderDiscountValue: r.orderDiscount?.value ?? null,
      idempotencyKey: r.id,
      completedAt: occurredAt,
      createdAt: occurredAt,
    });
    await tx.insert(orderLines).values(
      lines.map((l, i) => ({
        merchantId: device.merchantId,
        orderId,
        position: i,
        variantId: l.input.variantId,
        quantity: formatQuantity(l.quantityMilli),
        priceOverrideMinor: l.unitPriceMinor === l.listUnitPriceMinor ? null : l.unitPriceMinor,
        priceOverrideReason:
          l.unitPriceMinor === l.listUnitPriceMinor ? null : l.input.priceOverrideReason,
        discountType: l.input.discount?.type ?? null,
        discountValue: l.input.discount?.value ?? null,
      })),
    );

    // Stock: the same consumption (recipes) and ledger as a browser sale, negative allowed.
    const consumption = await stockConsumption(
      tx,
      lines.map((l) => ({
        variantId: l.input.variantId,
        quantityMilli: l.quantityMilli,
        modifierIds: [],
      })),
    );
    const applied = await this.ledger.apply(
      tx,
      {
        merchantId: device.merchantId,
        branchId: device.branchId,
        movementType: 'sale',
        sourceType: 'sale',
        sourceId: r.id,
        userId: actor.userId,
        negative: 'allow',
      },
      consumption.map((c) => ({
        variantId: c.variantId,
        mode: 'delta' as const,
        quantityMilli: -c.quantityMilli,
      })),
    );
    const negativeStock = applied
      .filter((a) => a.tracked && a.deltaMilli < 0n && a.balanceMilli < 0n)
      .map((a) => ({ variantId: a.variantId, balance: formatQuantity(a.balanceMilli) }));
    const costs = consumptionCosts(lines.length, consumption, applied, (i) => {
      const cost = items.get(lines[i]!.input.variantId)!['cost'];
      return cost === null ? null : BigInt(String(cost));
    });

    let costMinor: bigint | null = 0n;
    const lineRows = lines.map((l, i) => {
      const item = items.get(l.input.variantId)!;
      const p = priced.lines[i]!;
      const lineCost = costs.total[i]!;
      if (lineCost === null) costMinor = null;
      else if (costMinor !== null) costMinor += lineCost;
      const unitCost =
        costs.own[i] ??
        (lineCost === null
          ? null
          : (2n * lineCost * 1000n + l.quantityMilli) / (2n * l.quantityMilli));
      const overridden = l.unitPriceMinor !== l.listUnitPriceMinor;
      return {
        merchantId: device.merchantId,
        saleId: r.id,
        position: i,
        variantId: l.input.variantId,
        productId: String(item['product_id']),
        nameEn: (item['name_en'] as string | null) ?? null,
        nameAr: (item['name_ar'] as string | null) ?? null,
        variantNameEn: (item['variant_name_en'] as string | null) ?? null,
        variantNameAr: (item['variant_name_ar'] as string | null) ?? null,
        sku: (item['sku'] as string | null) ?? null,
        quantity: formatQuantity(l.quantityMilli),
        listUnitPriceMinor: l.listUnitPriceMinor,
        unitPriceMinor: l.unitPriceMinor,
        priceOverridden: overridden,
        priceOverrideReason: overridden ? l.input.priceOverrideReason : null,
        grossMinor: p.grossMinor,
        discountType: l.input.discount?.type ?? null,
        discountValue: l.input.discount?.value ?? null,
        lineDiscountMinor: p.lineDiscountMinor,
        orderDiscountMinor: p.orderDiscountMinor,
        netMinor: p.netMinor,
        trackInventory: costs.tracked[i]!,
        unitCostMinor: unitCost,
      };
    });
    const [limit] = (
      await tx.execute(
        sql`select coalesce((select max_discount_percent from sales_settings where merchant_id = ${device.merchantId}), 10)::text as pct`,
      )
    ).rows as Row[];
    await tx.insert(sales).values({
      id: r.id,
      merchantId: device.merchantId,
      orderId,
      branchId: device.branchId,
      registerId: device.registerId,
      shiftId: shift.id,
      membershipId: actor.membershipId,
      userId: actor.userId,
      receiptNumber: r.receiptNumber.toUpperCase(),
      customerId: null,
      subtotalMinor: priced.subtotalMinor,
      lineDiscountsMinor: priced.lineDiscountsMinor,
      orderDiscountMinor: priced.orderDiscountMinor,
      totalMinor: priced.totalMinor,
      paidMinor: priced.totalMinor,
      changeMinor: r.payments.reduce((s, p) => s + BigInt(p.changeMinor), 0n),
      feesMinor: r.payments.reduce((s, p) => s + BigInt(p.feeMinor), 0n),
      costMinor,
      aboveLimit: r.aboveLimit,
      discountLimitPercent: String(limit!['pct']),
      zeroTotalReason: priced.totalMinor === 0n ? r.zeroTotalReason : null,
      overrideId,
      createdAt: occurredAt,
    });
    await tx.insert(saleLines).values(lineRows);
    if (r.payments.length > 0) {
      // Cash settles into this register's drawer (ADR-0090); other methods into their account.
      const drawer = r.payments.some((p) => methods.get(p.methodId)!['kind'] === 'cash')
        ? (await registerAccount(tx, device.registerId)).id
        : null;
      const accountOf = (methodId: string) => {
        const m = methods.get(methodId)!;
        return m['kind'] === 'cash'
          ? drawer
          : ((m['financial_account_id'] as string | null) ?? null);
      };
      await tx.insert(payments).values(
        r.payments.map((p) => {
          const m = methods.get(p.methodId)!;
          return {
            id: p.id,
            merchantId: device.merchantId,
            saleId: r.id,
            branchId: device.branchId,
            shiftId: shift.id,
            paymentMethodId: p.methodId,
            methodKind: String(m['kind']),
            methodNameEn: (m['name_en'] as string | null) ?? null,
            methodNameAr: (m['name_ar'] as string | null) ?? null,
            amountMinor: BigInt(p.amountMinor),
            tenderedMinor: p.tenderedMinor === null ? null : BigInt(p.tenderedMinor),
            changeMinor: BigInt(p.changeMinor),
            feeMinor: BigInt(p.feeMinor),
            status: 'succeeded',
            verification: 'manual',
            reference: p.reference,
            financialAccountId: accountOf(p.methodId),
            createdAt: occurredAt,
          };
        }),
      );
      await postEntries(
        tx,
        r.payments.flatMap((p) => {
          const accountId = accountOf(p.methodId);
          if (!accountId) return [];
          const cash = methods.get(p.methodId)!['kind'] === 'cash';
          const base = {
            merchantId: device.merchantId,
            accountId,
            sourceType: 'payment',
            sourceId: p.id,
            description: r.receiptNumber.toUpperCase(),
            createdByUserId: actor.userId,
            shiftId: cash ? shift.id : null,
          };
          const fee = BigInt(p.feeMinor);
          return [
            { ...base, entryType: 'payment' as const, amountMinor: BigInt(p.amountMinor) },
            ...(fee > 0n && !cash
              ? [{ ...base, entryType: 'fee' as const, amountMinor: -fee }]
              : []),
          ];
        }),
      );
    }
    await this.record(tx, actor, 'sale.completed', 'sale', r.id, ip, device, {
      receiptNumber: r.receiptNumber.toUpperCase(),
      total: kwd(priced.totalMinor),
      shiftId: shift.id,
      registerId: device.registerId,
      catalogVersion: r.catalogVersion,
      aboveLimit: r.aboveLimit,
      discounts: kwd(priced.lineDiscountsMinor + priced.orderDiscountMinor),
      priceOverrides: lineRows
        .filter((l) => l.priceOverridden)
        .map((l) => ({
          variantId: l.variantId,
          from: kwd(l.listUnitPriceMinor),
          to: kwd(l.unitPriceMinor),
          reason: l.priceOverrideReason,
        })),
      ...(priced.totalMinor === 0n ? { zeroTotalReason: r.zeroTotalReason } : {}),
      ...(r.override
        ? {
            override: {
              id: overrideId,
              approverMembershipId: r.override.approverMembershipId,
              kinds: r.override.rights,
            },
          }
        : {}),
      ...(negativeStock.length ? { negativeStock } : {}),
    });
    // The device prints its own receipt; the server prints only when asked (gap A).
    if (r.requestRemotePrint)
      await this.printJobs.queueAutoInTx(tx, {
        merchantId: device.merchantId,
        branchId: device.branchId,
        saleId: r.id,
      });
    return {
      result: { saleId: r.id, receiptNumber: r.receiptNumber.toUpperCase() },
      outsideShift: occurredAt < shift.openedAt,
      negativeStock,
    };
  }

  // ------------------------------------------------------------ refunds

  /** A refund of a sale this device made (owner decision 4), through the refunds engine. */
  private async refund(
    tx: Transaction,
    device: Device,
    r: RefundRecord,
    occurredAt: Date,
    hash: string,
    ip: string,
  ): Promise<Outcome> {
    const actor = await this.actorFor(tx, device, r.membershipId, occurredAt);
    const shift = await this.openShiftOf(tx, device, r.shiftId);
    const [sale] = (await tx.execute(sql`select register_id from sales where id = ${r.saleId}`))
      .rows as Row[];
    if (!sale) throw new AppError(409, 'NOT_FOUND', 'The sale has not been uploaded.');
    if (sale['register_id'] !== device.registerId)
      throw new AppError(
        409,
        'NOT_OWN_SALE',
        'A device refunds only its own sales; use the online refund for this one.',
      );
    let approval: { approverUserId: string; reasons: string[] } | null = null;
    if (r.approval) {
      const approver = await this.access.loadMembershipAccess(tx, r.approval.approverMembershipId);
      if (!approver || approver.merchantId !== device.merchantId)
        throw new AppError(
          409,
          'APPROVAL_REQUIRED',
          'The approver is not a member of the company.',
        );
      if (approver.userId === actor.userId)
        throw new AppError(403, 'SELF_APPROVAL', 'Nobody approves their own refund.');
      approval = { approverUserId: approver.userId, reasons: r.approval.reasons };
    }
    const done = await this.refunds.recordDeviceRefundInTx(
      tx,
      actor,
      { id: shift.id, registerId: device.registerId },
      {
        refundId: r.id,
        saleId: r.saleId,
        lines: r.lines,
        reason: r.reason,
        note: r.note,
        allocation: r.payback.map((p) => ({
          paymentId: p.paymentId,
          amount: kwd(BigInt(p.amountMinor)),
          reference: p.reference,
        })),
        approval,
        occurredAt,
        requestHash: hash,
        deviceId: device.id,
      },
      ip,
    );
    return {
      result: {
        refundId: r.id,
        refundNumber: done.refundNumber,
        totalMinor: String(done.totalMinor),
      },
      outsideShift: occurredAt < shift.openedAt,
      negativeStock: [],
    };
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    targetType: string,
    targetId: string,
    ip: string,
    device: Device,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType,
      targetId,
      ip,
      details: { ...details, deviceId: device.id },
    });
  }
}

class ConcurrentUpload extends Error {}

const KINDS = new Set(['shift_open', 'sale', 'cash_movement', 'refund', 'shift_close']);

function refusal(
  base: { id: string; kind: string },
  code: string,
  message: string,
): DeviceRecordResult {
  return { ...base, status: 'refused', result: null, code, message, clockSkew: false };
}

/** Known refusals, including the database's own guarantees. */
function toAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  if (isUniqueViolation(error, 'sales_receipt_number_key'))
    return new AppError(409, 'RECEIPT_NUMBER_TAKEN', 'This receipt number is already used.');
  if (isUniqueViolation(error, 'shifts_one_open_per_member'))
    return new AppError(409, 'SHIFT_ALREADY_OPEN', 'This person already has an open shift.');
  if (isUniqueViolation(error, 'shifts_one_open_per_register'))
    return new AppError(409, 'REGISTER_BUSY', 'Another shift is already open on this register.');
  const cause = (error as { cause?: { code?: string } }).cause ?? (error as { code?: string });
  if (cause?.code === '23505')
    return new AppError(409, 'IDEMPOTENCY_CONFLICT', 'An id in this record is already used.');
  return null;
}
