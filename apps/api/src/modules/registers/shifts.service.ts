import type {
  CashMovement,
  DiscrepancyReport,
  Register,
  Shift,
  ShiftRow,
  closeShiftSchema,
  discrepancyReportQuerySchema,
  openShiftSchema,
  recordCashMovementSchema,
  saveRegisterSchema,
  shiftListQuerySchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { branches } from '../branches/branches.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { parseAmount } from '../payments/payments.service.js';
import { cashMovements, registerMembers, registers, shifts } from './registers.schema.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

type SaveRegister = z.output<typeof saveRegisterSchema>;
type OpenShiftInput = z.output<typeof openShiftSchema>;
type CashMovementInput = z.output<typeof recordCashMovementSchema>;
type CloseShiftInput = z.output<typeof closeShiftSchema>;
type ShiftQuery = z.output<typeof shiftListQuerySchema>;
type ReportQuery = z.output<typeof discrepancyReportQuerySchema>;
type RegisterRow = typeof registers.$inferSelect;
type ShiftRecord = typeof shifts.$inferSelect;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);

export interface ShiftTotals {
  openingFloatMinor: bigint;
  cashInMinor: bigint;
  cashOutMinor: bigint;
  cashSalesMinor: bigint;
  cashRefundsMinor: bigint;
  expectedCashMinor: bigint;
}

export function outcomeOf(
  discrepancy: bigint | null,
  tolerance: bigint | null,
): 'balanced' | 'over' | 'short' | null {
  if (discrepancy === null) return null;
  const abs = discrepancy < 0n ? -discrepancy : discrepancy;
  if (abs <= (tolerance ?? 0n)) return 'balanced';
  return discrepancy > 0n ? 'over' : 'short';
}

/**
 * Registers, cashier shifts and drawer cash (Prompt 9).
 *
 * Shift policy (BR-073): a register is used by one employee at a time — at most one open
 * shift per register and per employee (enforced by unique indexes). Only the shift owner
 * records cash movements and closes the shift; a manager with `registers.manage` can
 * force-close an abandoned shift. Expected cash is always derived from the records:
 * opening float + cash in − cash out + cash sales − cash refunds.
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // ------------------------------------------------------------ registers (manager)
  async listRegisters(actor: MerchantActor, branchId?: string): Promise<Register[]> {
    const scope = this.scope(actor, 'registers.manage', branchId);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select()
        .from(registers)
        .where(scope)
        .orderBy(asc(registers.branchId), asc(registers.code));
      return Promise.all(rows.map((r) => this.toRegister(tx, r)));
    });
  }

  async saveRegister(
    actor: MerchantActor,
    id: string | null,
    input: SaveRegister,
    ip: string,
  ): Promise<Register> {
    assertCan(actor, 'registers.manage', input.branchId);
    const fields = {
      branchId: input.branchId,
      code: input.code,
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      accessMode: input.accessMode,
      defaultOpeningFloatMinor: parseAmount(input.defaultOpeningFloat, 'defaultOpeningFloat'),
      discrepancyToleranceMinor: parseAmount(input.discrepancyTolerance, 'discrepancyTolerance'),
    };
    const registerId = id ?? newId();
    try {
      return await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [branch] = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.id, input.branchId));
        if (!branch) throw AppError.notFound('Branch not found.');
        if (id) {
          if (!input.version)
            throw AppError.validation([
              { path: 'version', code: 'required', message: 'version is required' },
            ]);
          const existing = await this.findRegister(tx, id);
          assertCan(actor, 'registers.manage', existing.branchId);
          if (existing.branchId !== input.branchId)
            throw AppError.conflict('A register cannot move to another branch.');
          const [row] = await tx
            .update(registers)
            .set({ ...fields, version: sql`${registers.version} + 1`, updatedAt: sql`now()` })
            .where(and(eq(registers.id, id), eq(registers.version, input.version)))
            .returning({ id: registers.id });
          if (!row) throw versionConflict();
        } else {
          await this.subscriptions.assertCapacity(tx, actor.merchantId, 'registers');
          await tx
            .insert(registers)
            .values({ id: registerId, merchantId: actor.merchantId, ...fields });
        }
        await this.setMembers(tx, actor.merchantId, registerId, input.memberIds);
        await this.record(
          tx,
          actor,
          id ? 'register.updated' : 'register.created',
          'register',
          registerId,
          ip,
          {
            code: input.code,
            accessMode: input.accessMode,
            members: input.memberIds.length,
          },
        );
        return this.toRegister(tx, await this.findRegister(tx, registerId));
      });
    } catch (error) {
      if (isUniqueViolation(error, 'registers_branch_code_key'))
        throw new AppError(
          409,
          'DUPLICATE_CODE',
          'A register with this code already exists at the branch.',
        );
      throw error;
    }
  }

  async setRegisterStatus(
    actor: MerchantActor,
    id: string,
    status: 'active' | 'inactive',
    ip: string,
  ): Promise<Register> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const register = await this.findRegister(tx, id);
      assertCan(actor, 'registers.manage', register.branchId);
      if (status === 'inactive') {
        const [open] = await tx
          .select({ id: shifts.id })
          .from(shifts)
          .where(and(eq(shifts.registerId, id), eq(shifts.status, 'open')));
        if (open)
          throw new AppError(409, 'REGISTER_BUSY', 'Close the open shift before deactivating.');
      }
      if (status === 'active' && register.status !== 'active')
        await this.subscriptions.assertCapacity(tx, actor.merchantId, 'registers');
      await tx
        .update(registers)
        .set({ status, version: sql`${registers.version} + 1`, updatedAt: sql`now()` })
        .where(eq(registers.id, id));
      await this.record(
        tx,
        actor,
        `register.${status === 'active' ? 'activated' : 'deactivated'}`,
        'register',
        id,
        ip,
      );
      return this.toRegister(tx, await this.findRegister(tx, id));
    });
  }

  private async setMembers(
    tx: Transaction,
    merchantId: string,
    registerId: string,
    memberIds: string[],
  ) {
    await tx.delete(registerMembers).where(eq(registerMembers.registerId, registerId));
    const unique = [...new Set(memberIds)];
    if (unique.length === 0) return;
    const found = (
      await tx.execute(
        sql`select id from memberships where id in (${sql.join(
          unique.map((m) => sql`${m}`),
          sql`, `,
        )})`,
      )
    ).rows;
    if (found.length !== unique.length) throw AppError.notFound('Employee not found.');
    await tx
      .insert(registerMembers)
      .values(unique.map((membershipId) => ({ merchantId, registerId, membershipId })));
  }

  private async toRegister(tx: Transaction, r: RegisterRow): Promise<Register> {
    const members = await tx
      .select({ id: registerMembers.membershipId })
      .from(registerMembers)
      .where(eq(registerMembers.registerId, r.id));
    const [open] = (
      await tx.execute(sql`
        select s.id, s.opened_at, u.full_name from shifts s join users u on u.id = s.user_id
        where s.register_id = ${r.id} and s.status = 'open'`)
    ).rows as { id: string; opened_at: string; full_name: string }[];
    return {
      id: r.id,
      branchId: r.branchId,
      code: r.code,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      status: r.status as Register['status'],
      accessMode: r.accessMode as Register['accessMode'],
      memberIds: members.map((m) => m.id),
      defaultOpeningFloat: money(r.defaultOpeningFloatMinor),
      discrepancyTolerance: money(r.discrepancyToleranceMinor),
      openShift: open
        ? { id: open.id, employeeName: open.full_name, openedAt: iso(open.opened_at)! }
        : null,
      version: r.version,
    };
  }

  private async findRegister(tx: Transaction, id: string): Promise<RegisterRow> {
    const [row] = await tx.select().from(registers).where(eq(registers.id, id));
    if (!row) throw AppError.notFound('Register not found.');
    return row;
  }

  // ------------------------------------------------------------ POS
  private posBranch(actor: MerchantActor): string {
    if (!actor.boundBranchId) throw AppError.forbidden();
    return actor.boundBranchId;
  }

  private async mayUse(
    tx: Transaction,
    actor: MerchantActor,
    register: RegisterRow,
  ): Promise<boolean> {
    if (register.branchId !== actor.boundBranchId) return false;
    if (!can(actor.access, 'shifts.operate', register.branchId)) return false;
    if (register.accessMode === 'branch' || actor.access.isOwner) return true;
    const [member] = await tx
      .select({ id: registerMembers.membershipId })
      .from(registerMembers)
      .where(
        and(
          eq(registerMembers.registerId, register.id),
          eq(registerMembers.membershipId, actor.membershipId),
        ),
      );
    return Boolean(member);
  }

  /** Registers at the POS branch that this employee may use. */
  async posRegisters(actor: MerchantActor) {
    const branchId = this.posBranch(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select()
        .from(registers)
        .where(and(eq(registers.branchId, branchId), eq(registers.status, 'active')))
        .orderBy(asc(registers.code));
      const result = [];
      for (const r of rows) {
        if (!(await this.mayUse(tx, actor, r))) continue;
        const [open] = (
          await tx.execute(sql`
            select s.membership_id, u.full_name from shifts s join users u on u.id = s.user_id
            where s.register_id = ${r.id} and s.status = 'open'`)
        ).rows as { membership_id: string; full_name: string }[];
        result.push({
          id: r.id,
          code: r.code,
          nameEn: r.nameEn,
          nameAr: r.nameAr,
          defaultOpeningFloat: money(r.defaultOpeningFloatMinor),
          availability: !open
            ? ('free' as const)
            : open.membership_id === actor.membershipId
              ? ('mine' as const)
              : ('occupied' as const),
          occupiedBy: open && open.membership_id !== actor.membershipId ? open.full_name : null,
        });
      }
      return result;
    });
  }

  async currentShift(actor: MerchantActor): Promise<Shift | null> {
    const branchId = this.posBranch(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.membershipId, actor.membershipId), eq(shifts.status, 'open')));
      if (!row) return null;
      // An open shift at another branch is not usable from this POS session.
      if (row.branchId !== branchId) return null;
      return this.toShift(tx, row);
    });
  }

  async openShift(actor: MerchantActor, input: OpenShiftInput, ip: string): Promise<Shift> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'shifts.operate', branchId);
    const openingFloatMinor = parseAmount(input.openingFloat, 'openingFloat');
    try {
      return await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const register = await this.findRegister(tx, input.registerId);
        if (register.branchId !== branchId) throw AppError.notFound('Register not found.');
        if (register.status !== 'active')
          throw new AppError(409, 'REGISTER_INACTIVE', 'This register is inactive.');
        if (!(await this.mayUse(tx, actor, register)))
          throw new AppError(
            403,
            'REGISTER_ACCESS_DENIED',
            'You are not allowed to use this register.',
          );
        const [branch] = await tx
          .select({ status: branches.status })
          .from(branches)
          .where(eq(branches.id, branchId));
        if (branch?.status !== 'active')
          throw new AppError(409, 'BRANCH_INACTIVE', 'This branch is inactive.');
        const id = newId();
        await tx.insert(shifts).values({
          id,
          merchantId: actor.merchantId,
          branchId,
          registerId: register.id,
          membershipId: actor.membershipId,
          userId: actor.userId,
          openingFloatMinor,
          openingNote: input.note,
        });
        await this.record(tx, actor, 'shift.opened', 'shift', id, ip, {
          registerId: register.id,
          openingFloat: Money.ofMinor(openingFloatMinor, CURRENCY).toDecimalString(),
        });
        const [row] = await tx.select().from(shifts).where(eq(shifts.id, id));
        return this.toShift(tx, row!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'shifts_one_open_per_register'))
        throw new AppError(409, 'REGISTER_BUSY', 'Another shift is already open on this register.');
      if (isUniqueViolation(error, 'shifts_one_open_per_member'))
        throw new AppError(409, 'SHIFT_ALREADY_OPEN', 'You already have an open shift.');
      throw error;
    }
  }

  /** Locks and returns the actor's own open shift at the POS branch. */
  async lockOwnShift(tx: Transaction, actor: MerchantActor): Promise<ShiftRecord> {
    const [row] = await tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.membershipId, actor.membershipId), eq(shifts.status, 'open')))
      .for('update');
    if (!row || row.branchId !== actor.boundBranchId)
      throw new AppError(409, 'SHIFT_REQUIRED', 'Open a shift first.');
    return row;
  }

  async recordCashMovement(
    actor: MerchantActor,
    input: CashMovementInput,
    ip: string,
  ): Promise<Shift> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'cash.move', branchId);
    const amountMinor = parseAmount(input.amount, 'amount');
    if (amountMinor <= 0n)
      throw new AppError(400, 'INVALID_PRICE', 'Amount must be greater than zero.', [
        { path: 'amount', code: 'too_small', message: 'Amount must be greater than zero.' },
      ]);
    try {
      return await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        if (input.idempotencyKey) {
          const [done] = await tx
            .select({ shiftId: cashMovements.shiftId })
            .from(cashMovements)
            .where(eq(cashMovements.idempotencyKey, input.idempotencyKey));
          if (done) {
            const [row] = await tx.select().from(shifts).where(eq(shifts.id, done.shiftId));
            return this.toShift(tx, row!);
          }
        }
        const shift = await this.lockOwnShift(tx, actor);
        if (input.kind === 'cash_out') {
          const totals = await this.totals(tx, shift);
          if (amountMinor > totals.expectedCashMinor)
            throw new AppError(
              409,
              'INSUFFICIENT_CASH',
              'The drawer does not hold this much cash.',
            );
        }
        const id = newId();
        await tx.insert(cashMovements).values({
          id,
          merchantId: actor.merchantId,
          shiftId: shift.id,
          branchId: shift.branchId,
          registerId: shift.registerId,
          kind: input.kind,
          amountMinor,
          reason: input.reason,
          note: input.note,
          idempotencyKey: input.idempotencyKey ?? null,
          createdByUserId: actor.userId,
        });
        await this.record(tx, actor, `shift.${input.kind}`, 'shift', shift.id, ip, {
          movementId: id,
          amount: Money.ofMinor(amountMinor, CURRENCY).toDecimalString(),
          reason: input.reason,
        });
        return this.toShift(tx, shift);
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error, 'cash_movements_idempotency_key'))
        return (await this.currentShift(actor))!;
      throw error;
    }
  }

  async closeOwnShift(actor: MerchantActor, input: CloseShiftInput, ip: string): Promise<Shift> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'shifts.operate', branchId);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const shift = await this.lockOwnShift(tx, actor);
      return this.close(tx, actor, shift, input, 'normal', ip);
    });
  }

  // ------------------------------------------------------------ manager
  async forceClose(
    actor: MerchantActor,
    shiftId: string,
    input: CloseShiftInput,
    ip: string,
  ): Promise<Shift> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [shift] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).for('update');
      if (!shift) throw AppError.notFound();
      assertCan(actor, 'registers.manage', shift.branchId);
      if (shift.status !== 'open')
        throw new AppError(409, 'SHIFT_CLOSED', 'This shift is already closed.');
      if (!input.note)
        throw AppError.validation([
          {
            path: 'note',
            code: 'required',
            message: 'Explain why the shift is closed by a manager.',
          },
        ]);
      return this.close(tx, actor, shift, input, 'forced', ip);
    });
  }

  private async close(
    tx: Transaction,
    actor: MerchantActor,
    shift: ShiftRecord,
    input: CloseShiftInput,
    closeType: 'normal' | 'forced',
    ip: string,
  ): Promise<Shift> {
    if (shift.version !== input.version) throw versionConflict();
    const countedMinor = parseAmount(input.countedCash, 'countedCash');
    if (input.breakdown) {
      let sum = 0n;
      for (const d of input.breakdown) sum += parseAmount(d.value, 'breakdown') * BigInt(d.count);
      if (sum !== countedMinor)
        throw new AppError(
          400,
          'INVALID_BREAKDOWN',
          'The denomination count does not match the counted cash.',
        );
    }
    const totals = await this.totals(tx, shift);
    const register = await this.findRegister(tx, shift.registerId);
    const discrepancy = countedMinor - totals.expectedCashMinor;
    await tx
      .update(shifts)
      .set({
        status: 'closed',
        closedAt: sql`now()`,
        closedByUserId: actor.userId,
        closeType,
        expectedCashMinor: totals.expectedCashMinor,
        countedCashMinor: countedMinor,
        discrepancyMinor: discrepancy,
        discrepancyToleranceMinor: register.discrepancyToleranceMinor,
        countedBreakdown: input.breakdown ?? null,
        closingNote: input.note,
        version: sql`${shifts.version} + 1`,
      })
      .where(eq(shifts.id, shift.id));
    await this.record(
      tx,
      actor,
      closeType === 'forced' ? 'shift.force_closed' : 'shift.closed',
      'shift',
      shift.id,
      ip,
      {
        expected: Money.ofMinor(totals.expectedCashMinor, CURRENCY).toDecimalString(),
        counted: Money.ofMinor(countedMinor, CURRENCY).toDecimalString(),
        discrepancy: Money.ofMinor(discrepancy, CURRENCY).toDecimalString(),
      },
    );
    const [row] = await tx.select().from(shifts).where(eq(shifts.id, shift.id));
    return this.toShift(tx, row!);
  }

  async getShift(actor: MerchantActor, id: string): Promise<Shift> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(shifts).where(eq(shifts.id, id));
      if (!row) throw AppError.notFound();
      assertCan(actor, 'shifts.view_all', row.branchId);
      return this.toShift(tx, row);
    });
  }

  async listShifts(actor: MerchantActor, query: ShiftQuery) {
    const scope = this.scope(actor, 'shifts.view_all', query.branchId, sql`s.branch_id`);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const tz = await this.timezone(tx, actor.merchantId);
      const conditions: SQL[] = [scope ?? sql`true`];
      if (query.registerId) conditions.push(sql`s.register_id = ${query.registerId}`);
      if (query.status !== 'all') conditions.push(sql`s.status = ${query.status}`);
      if (query.from)
        conditions.push(sql`s.opened_at >= (${query.from}::date)::timestamp at time zone ${tz}`);
      if (query.to)
        conditions.push(sql`s.opened_at < ((${query.to}::date + 1)::timestamp at time zone ${tz})`);
      const out = sql`(s.status = 'closed' and abs(s.discrepancy_minor) > coalesce(s.discrepancy_tolerance_minor, 0))`;
      if (query.outcome === 'discrepancy') conditions.push(out);
      if (query.outcome === 'over') conditions.push(sql`${out} and s.discrepancy_minor > 0`);
      if (query.outcome === 'short') conditions.push(sql`${out} and s.discrepancy_minor < 0`);
      if (query.outcome === 'balanced') conditions.push(sql`s.status = 'closed' and not ${out}`);
      const where = sql.join(conditions, sql` and `);
      const [total] = (
        await tx.execute(sql`select count(*)::int as n from shifts s where ${where}`)
      ).rows as { n: number }[];
      const ids = (
        await tx.execute(sql`select s.id from shifts s where ${where}
          order by s.opened_at desc, s.id desc limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as { id: string }[];
      const rows: ShiftRow[] = [];
      for (const { id } of ids) {
        const [row] = await tx.select().from(shifts).where(eq(shifts.id, id));
        const { movements: _m, countedBreakdown: _b, ...rest } = await this.toShift(tx, row!);
        rows.push(rest);
      }
      return { shifts: rows, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async discrepancyReport(actor: MerchantActor, query: ReportQuery): Promise<DiscrepancyReport> {
    const scope = this.scope(actor, 'shifts.view_all', query.branchId, sql`s.branch_id`);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const tz = await this.timezone(tx, actor.merchantId);
      const conditions: SQL[] = [scope ?? sql`true`, sql`s.status = 'closed'`];
      if (query.from)
        conditions.push(sql`s.closed_at >= (${query.from}::date)::timestamp at time zone ${tz}`);
      if (query.to)
        conditions.push(sql`s.closed_at < ((${query.to}::date + 1)::timestamp at time zone ${tz})`);
      const where = sql.join(conditions, sql` and `);
      const out = sql`abs(s.discrepancy_minor) > coalesce(s.discrepancy_tolerance_minor, 0)`;
      const aggregates = sql`count(*)::int as shifts,
        count(*) filter (where not ${out})::int as balanced,
        count(*) filter (where ${out} and s.discrepancy_minor > 0)::int as over,
        count(*) filter (where ${out} and s.discrepancy_minor < 0)::int as short,
        coalesce(sum(s.discrepancy_minor) filter (where s.discrepancy_minor > 0), 0)::text as total_over,
        coalesce(sum(-s.discrepancy_minor) filter (where s.discrepancy_minor < 0), 0)::text as total_short,
        coalesce(sum(s.discrepancy_minor), 0)::text as net`;
      const totalsOf = (r: Record<string, unknown>) => ({
        shifts: r['shifts'] as number,
        balanced: r['balanced'] as number,
        over: r['over'] as number,
        short: r['short'] as number,
        totalOver: money(BigInt(r['total_over'] as string)),
        totalShort: money(BigInt(r['total_short'] as string)),
        net: money(BigInt(r['net'] as string)),
      });
      const [totals] = (await tx.execute(sql`select ${aggregates} from shifts s where ${where}`))
        .rows as Record<string, unknown>[];
      const byEmployee = (
        await tx.execute(sql`select s.membership_id, u.full_name, ${aggregates}
          from shifts s join users u on u.id = s.user_id where ${where}
          group by s.membership_id, u.full_name order by sum(abs(s.discrepancy_minor)) desc`)
      ).rows as Record<string, unknown>[];
      const byRegister = (
        await tx.execute(sql`select r.id, r.branch_id, r.name_en, r.name_ar, ${aggregates}
          from shifts s join registers r on r.id = s.register_id where ${where}
          group by r.id, r.branch_id, r.name_en, r.name_ar order by sum(abs(s.discrepancy_minor)) desc`)
      ).rows as Record<string, unknown>[];
      return {
        totals: totalsOf(totals!),
        byEmployee: byEmployee.map((r) => ({
          membershipId: r['membership_id'] as string,
          employeeName: r['full_name'] as string,
          ...totalsOf(r),
        })),
        byRegister: byRegister.map((r) => ({
          registerId: r['id'] as string,
          branchId: r['branch_id'] as string,
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
          ...totalsOf(r),
        })),
      };
    });
  }

  // ------------------------------------------------------------ calculations
  /**
   * Cash totals of a shift, from records only. Cash sales come from the checkout payment
   * records; cash refunds from the refund payment records.
   */
  async totals(tx: Transaction, shift: ShiftRecord): Promise<ShiftTotals> {
    const [m] = (
      await tx.execute(sql`
        select coalesce(sum(amount_minor) filter (where kind = 'cash_in'), 0)::text as cash_in,
               coalesce(sum(amount_minor) filter (where kind = 'cash_out'), 0)::text as cash_out
        from cash_movements where shift_id = ${shift.id}`)
    ).rows as { cash_in: string; cash_out: string }[];
    const cashInMinor = BigInt(m!.cash_in);
    const cashOutMinor = BigInt(m!.cash_out);
    // Cash taken on sales (Prompt 10): the applied amount, i.e. tendered minus change.
    const [p] = (
      await tx.execute(sql`
        select coalesce(sum(amount_minor), 0)::text as cash_sales
        from payments where shift_id = ${shift.id} and method_kind = 'cash' and status = 'succeeded'
          and sale_id is not null`)
    ).rows as { cash_sales: string }[];
    const cashSalesMinor = BigInt(p!.cash_sales);
    // Cash paid back on refunds processed in this shift (Prompt 11).
    const [r] = (
      await tx.execute(sql`
        select coalesce(sum(amount_minor), 0)::text as cash_refunds
        from refund_payments where shift_id = ${shift.id} and method_kind = 'cash' and status = 'succeeded'`)
    ).rows as { cash_refunds: string }[];
    const cashRefundsMinor = BigInt(r!.cash_refunds);
    return {
      openingFloatMinor: shift.openingFloatMinor,
      cashInMinor,
      cashOutMinor,
      cashSalesMinor,
      cashRefundsMinor,
      expectedCashMinor:
        shift.openingFloatMinor + cashInMinor - cashOutMinor + cashSalesMinor - cashRefundsMinor,
    };
  }

  private async toShift(tx: Transaction, r: ShiftRecord): Promise<Shift> {
    const totals =
      r.status === 'closed'
        ? { ...(await this.totals(tx, r)), expectedCashMinor: r.expectedCashMinor! }
        : await this.totals(tx, r);
    const [info] = (
      await tx.execute(sql`
        select reg.name_en, reg.name_ar, u.full_name, cu.full_name as closed_by
        from registers reg, users u left join users cu on cu.id = ${r.closedByUserId}
        where reg.id = ${r.registerId} and u.id = ${r.userId}`)
    ).rows as Record<string, string | null>[];
    const movements = (
      await tx.execute(sql`
        select m.*, u.full_name from cash_movements m join users u on u.id = m.created_by_user_id
        where m.shift_id = ${r.id} order by m.created_at, m.id`)
    ).rows as Record<string, unknown>[];
    return {
      id: r.id,
      branchId: r.branchId,
      registerId: r.registerId,
      registerName: { nameEn: info?.['name_en'] ?? null, nameAr: info?.['name_ar'] ?? null },
      membershipId: r.membershipId,
      employeeName: info?.['full_name'] ?? '',
      status: r.status as Shift['status'],
      openedAt: iso(r.openedAt)!,
      openingNote: r.openingNote,
      closedAt: iso(r.closedAt),
      closedByName: info?.['closed_by'] ?? null,
      closeType: (r.closeType as Shift['closeType']) ?? null,
      summary: {
        openingFloat: money(totals.openingFloatMinor),
        cashIn: money(totals.cashInMinor),
        cashOut: money(totals.cashOutMinor),
        cashSales: money(totals.cashSalesMinor),
        cashRefunds: money(totals.cashRefundsMinor),
        expectedCash: money(totals.expectedCashMinor),
      },
      countedCash: r.countedCashMinor === null ? null : money(r.countedCashMinor),
      discrepancy: r.discrepancyMinor === null ? null : money(r.discrepancyMinor),
      outcome: outcomeOf(r.discrepancyMinor, r.discrepancyToleranceMinor),
      countedBreakdown: (r.countedBreakdown as Shift['countedBreakdown']) ?? null,
      closingNote: r.closingNote,
      movements: movements.map((m): CashMovement => ({
        id: m['id'] as string,
        kind: m['kind'] as CashMovement['kind'],
        amount: money(BigInt(m['amount_minor'] as string)),
        reason: m['reason'] as string,
        note: (m['note'] as string | null) ?? null,
        createdBy: m['full_name'] as string,
        createdAt: iso(m['created_at'] as string)!,
      })),
      version: r.version,
    };
  }

  // ------------------------------------------------------------ helpers
  /** Branch filter for a branch-scoped permission (optionally one branch). */
  private scope(
    actor: MerchantActor,
    permission: 'registers.manage' | 'shifts.view_all',
    branchId: string | undefined,
    column: SQL = sql`${registers.branchId}`,
  ): SQL | undefined {
    if (branchId) {
      assertCan(actor, permission, branchId);
      return sql`${column} = ${branchId}`;
    }
    const scope = permissionBranchScope(actor.access, permission);
    if (scope.all) return undefined;
    if (scope.branchIds.length === 0) throw AppError.forbidden();
    return sql`${column} in (${sql.join(
      scope.branchIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  }

  private async timezone(tx: Transaction, merchantId: string): Promise<string> {
    const [m] = await tx
      .select({ tz: merchants.timezone })
      .from(merchants)
      .where(eq(merchants.id, merchantId));
    return m?.tz ?? 'Asia/Kuwait';
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    targetType: string,
    targetId: string,
    ip: string,
    details: Record<string, unknown> = {},
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType,
      targetId,
      ip,
      details,
    });
  }
}
