import type {
  CashMovement,
  DiscrepancyReport,
  PosShift,
  Register,
  Shift,
  ShiftRow,
  closeShiftSchema,
  discrepancyReportQuerySchema,
  forceCloseShiftSchema,
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
import { suppliers } from '../purchasing/purchasing.schema.js';
import { salesSettings } from '../sales/sales.schema.js';
import {
  accountBalance,
  activeBankAccount,
  assertCovers,
  assertTreasuryCounted,
  branchTreasury,
  ensureRegisterAccount,
  lockAccounts,
  postDisbursement,
  postEntries,
  postTransfer,
  registerAccount,
} from '../payments/cash-ledger.js';
import { parseAmount } from '../payments/payments.service.js';
import { cashMovements, registerMembers, registers, shifts } from './registers.schema.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

type SaveRegister = z.output<typeof saveRegisterSchema>;
type OpenShiftInput = z.output<typeof openShiftSchema>;
type CashMovementInput = z.output<typeof recordCashMovementSchema>;
type CloseShiftInput = z.output<typeof closeShiftSchema>;
type ForceCloseInput = z.output<typeof forceCloseShiftSchema>;
type Breakdown = { value: string; count: number }[];
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
 * force-close an abandoned shift.
 *
 * Cash custody (ADR-0090): each register's drawer is an account of the cash ledger whose
 * balance carries across shifts. Opening counts the drawer against that balance (a
 * difference is a between-shifts discrepancy, or the drawer's first count); closing counts it
 * again and the difference is booked on the shift; the cash stays in the drawer. Shifts open
 * at the cutover (`legacy_open`) close with the old record-based expected cash, and their count
 * becomes the drawer's first balance.
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
          await ensureRegisterAccount(tx, actor.merchantId, { id: registerId, ...fields });
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
        const drawer = await registerAccount(tx, id);
        if ((await accountBalance(tx, drawer.id)) !== 0n)
          throw new AppError(
            409,
            'REGISTER_HAS_CASH',
            'Move the cash to the treasury before deactivating the register.',
          );
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
      const blind = await this.blindFor(tx, actor, branchId);
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
          // Blind counts (BR-162): the cashier learns the expected balance only after counting.
          expectedCash: blind
            ? null
            : money(await accountBalance(tx, (await registerAccount(tx, r.id)).id)),
          blindCount: blind,
          needsCount: r.needsCount,
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

  async currentShift(actor: MerchantActor): Promise<PosShift | null> {
    const branchId = this.posBranch(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.membershipId, actor.membershipId), eq(shifts.status, 'open')));
      if (!row) return null;
      // An open shift at another branch is not usable from this POS session.
      if (row.branchId !== branchId) return null;
      return this.toPosShift(tx, actor, row);
    });
  }

  /**
   * Blind-count policy (BR-162): on by default per company; it binds users who may not
   * monitor shifts (`shifts.view_all`) at the branch, so the owner and supervisors still
   * see drawer figures while cashiers count without a target.
   */
  private async blindFor(tx: Transaction, actor: MerchantActor, branchId: string) {
    if (can(actor.access, 'shifts.view_all', branchId)) return false;
    const [row] = await tx
      .select({ blind: salesSettings.blindCashCount })
      .from(salesSettings)
      .where(eq(salesSettings.merchantId, actor.merchantId));
    return row?.blind ?? true;
  }

  /** The cashier's own view: drawer figures withheld under a blind count. */
  private async toPosShift(
    tx: Transaction,
    actor: MerchantActor,
    row: ShiftRecord,
  ): Promise<PosShift> {
    const blind = await this.blindFor(tx, actor, row.branchId);
    const shift = await this.toShift(tx, row);
    return {
      ...shift,
      summary: blind ? null : shift.summary,
      blindCount: blind,
      openingDiscrepancy: shift.summary.openingDiscrepancy,
    };
  }

  /**
   * Opens a shift by counting the drawer (ADR-0090). The cashier sees the drawer's balance
   * and confirms the count; a stale balance (someone moved cash meanwhile) is refused so the
   * count is always against what the system holds now.
   */
  async openShift(actor: MerchantActor, input: OpenShiftInput, ip: string): Promise<PosShift> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'shifts.operate', branchId);
    const countedMinor = parseAmount(input.countedCash, 'countedCash');
    const shownMinor =
      input.expectedCash === undefined ? null : parseAmount(input.expectedCash, 'expectedCash');
    checkBreakdown(input.breakdown, countedMinor);
    try {
      return await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const blind = await this.blindFor(tx, actor, branchId);
        // Outside a blind count the client must say which balance the cashier was shown.
        if (!blind && shownMinor === null)
          throw AppError.validation([
            { path: 'expectedCash', code: 'required', message: 'Expected cash is required.' },
          ]);
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
        const drawer = await registerAccount(tx, register.id);
        await lockAccounts(tx, [drawer.id]);
        // Under the drawer lock: a concurrent opening has either committed (busy) or not.
        const [busy] = await tx
          .select({ id: shifts.id })
          .from(shifts)
          .where(and(eq(shifts.registerId, register.id), eq(shifts.status, 'open')));
        if (busy)
          throw new AppError(
            409,
            'REGISTER_BUSY',
            'Another shift is already open on this register.',
          );
        const expectedMinor = await accountBalance(tx, drawer.id);
        if (shownMinor !== null && shownMinor !== expectedMinor)
          throw new AppError(409, 'EXPECTED_CHANGED', 'The drawer balance changed. Count again.');
        // Whose difference is it? After a forced close without a count, the earlier shift's;
        // on the drawer's first verified count, nobody's (it sets the balance).
        const [last] = await tx
          .select({ id: shifts.id, closeType: shifts.closeType, legacyOpen: shifts.legacyOpen })
          .from(shifts)
          .where(and(eq(shifts.registerId, register.id), eq(shifts.status, 'closed')))
          .orderBy(sql`${shifts.closedAt} desc`)
          .limit(1);
        const followsShiftId =
          last && last.closeType === 'forced_uncounted' && !last.legacyOpen ? last.id : null;
        const initial = !followsShiftId && register.needsCount;
        const differenceMinor = countedMinor - expectedMinor;
        // A blind cashier cannot know there is a difference: it is booked between shifts and
        // explained in the manager's follow-up, not refused here (BR-162).
        if (
          !blind &&
          !initial &&
          !input.note &&
          abs(differenceMinor) > register.discrepancyToleranceMinor
        )
          throw AppError.validation([
            {
              path: 'note',
              code: 'required',
              message: 'Explain the difference between the drawer and the expected cash.',
            },
          ]);
        const id = newId();
        await tx.insert(shifts).values({
          id,
          merchantId: actor.merchantId,
          branchId,
          registerId: register.id,
          membershipId: actor.membershipId,
          userId: actor.userId,
          openingFloatMinor: countedMinor,
          openingExpectedMinor: expectedMinor,
          openingDiscrepancyMinor: initial ? null : differenceMinor,
          openingIsInitial: initial,
          openingFollowsShiftId: followsShiftId,
          openingBreakdown: input.breakdown ?? null,
          openingNote: input.note,
        });
        await postEntries(tx, [
          {
            merchantId: actor.merchantId,
            accountId: drawer.id,
            amountMinor: differenceMinor,
            entryType: 'adjustment',
            sourceType: initial ? 'register_initial_count' : 'shift_open',
            sourceId: id,
            description: input.note,
            createdByUserId: actor.userId,
            shiftId: id,
          },
        ]);
        await tx.update(registers).set({ needsCount: false }).where(eq(registers.id, register.id));
        await this.record(tx, actor, 'shift.opened', 'shift', id, ip, {
          registerId: register.id,
          expected: Money.ofMinor(expectedMinor, CURRENCY).toDecimalString(),
          counted: Money.ofMinor(countedMinor, CURRENCY).toDecimalString(),
          difference: Money.ofMinor(differenceMinor, CURRENCY).toDecimalString(),
          initialCount: initial,
          followsShiftId,
          blindCount: blind,
        });
        const [row] = await tx.select().from(shifts).where(eq(shifts.id, id));
        return this.toPosShift(tx, actor, row!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'shifts_one_open_per_register'))
        throw new AppError(409, 'REGISTER_BUSY', 'Another shift is already open on this register.');
      if (isUniqueViolation(error, 'shifts_one_open_per_member'))
        throw new AppError(409, 'SHIFT_ALREADY_OPEN', 'You already have an open shift.');
      throw error;
    }
  }

  /**
   * Cash physically available in a shift's drawer, under lock. Legacy shifts (open at the
   * cutover) still use the record-based figure; their drawer account starts at their close.
   */
  async drawerCash(tx: Transaction, shift: ShiftRecord): Promise<bigint> {
    if (shift.legacyOpen) return (await this.totals(tx, shift)).expectedCashMinor;
    const drawer = await registerAccount(tx, shift.registerId);
    await lockAccounts(tx, [drawer.id]);
    return accountBalance(tx, drawer.id);
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
  ): Promise<PosShift> {
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
            return this.toPosShift(tx, actor, row!);
          }
        }
        const shift = await this.lockOwnShift(tx, actor);
        const drawer = await registerAccount(tx, shift.registerId);
        const treasury =
          input.reason === 'float_top_up' || input.reason === 'safe_drop'
            ? await branchTreasury(tx, shift.branchId)
            : null;
        // Bank deposits need their own permission on top of cash.move (ADR-0091).
        let bankId: string | null = null;
        if (input.reason === 'bank_deposit') {
          assertCan(actor, 'cash.deposit', branchId);
          bankId = await activeBankAccount(tx, input.bankAccountId!);
        }
        if (input.reason === 'supplier_payment') await this.assertSupplier(tx, input.supplierId!);
        await lockAccounts(tx, [
          drawer.id,
          ...(treasury ? [treasury.id] : []),
          ...(bankId ? [bankId] : []),
        ]);
        if (input.kind === 'cash_out')
          assertCovers(await this.drawerCash(tx, shift), amountMinor, 'register');
        if (input.reason === 'float_top_up') {
          assertTreasuryCounted(treasury!);
          assertCovers(await accountBalance(tx, treasury!.id), amountMinor, 'treasury');
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
          bankAccountId: bankId,
          idempotencyKey: input.idempotencyKey ?? null,
          createdByUserId: actor.userId,
        });
        await this.postMovement(tx, actor, shift, drawer.id, treasury?.id ?? null, {
          id,
          kind: input.kind,
          reason: input.reason,
          amountMinor,
          note: input.note ?? null,
          bankId,
          category: input.category ?? null,
          supplierId: input.supplierId ?? null,
          receiptReference: input.receiptReference ?? null,
        });
        await this.record(tx, actor, `shift.${input.kind}`, 'shift', shift.id, ip, {
          movementId: id,
          amount: Money.ofMinor(amountMinor, CURRENCY).toDecimalString(),
          reason: input.reason,
        });
        return this.toPosShift(tx, actor, shift);
      });
    } catch (error) {
      if (input.idempotencyKey && isUniqueViolation(error, 'cash_movements_idempotency_key'))
        return (await this.currentShift(actor))!;
      throw error;
    }
  }

  /**
   * Books a drawer movement (ADR-0090, ADR-0091): a drop to or top-up from the branch
   * treasury and a bank deposit are transfers; an expense or a supplier payment is a real
   * outflow (a disbursement); exchanging notes for coins changes nothing; corrections and
   * other reasons move only the drawer.
   */
  private async postMovement(
    tx: Transaction,
    actor: MerchantActor,
    shift: ShiftRecord,
    drawerId: string,
    treasuryId: string | null,
    m: {
      id: string;
      kind: string;
      reason: string;
      amountMinor: bigint;
      note: string | null;
      bankId: string | null;
      category: string | null;
      supplierId: string | null;
      receiptReference: string | null;
    },
  ) {
    if (m.reason === 'change_received') return;
    if (m.reason === 'bank_deposit') {
      await postTransfer(tx, {
        merchantId: actor.merchantId,
        fromAccountId: drawerId,
        toAccountId: m.bankId!,
        amountMinor: m.amountMinor,
        origin: 'pos_movement',
        cashMovementId: m.id,
        note: m.note,
        userId: actor.userId,
        fromShiftId: shift.id,
      });
      return;
    }
    if (m.reason === 'petty_expense' || m.reason === 'supplier_payment') {
      await postDisbursement(tx, {
        merchantId: actor.merchantId,
        branchId: shift.branchId,
        sourceAccountId: drawerId,
        shiftId: shift.id,
        cashMovementId: m.id,
        kind: m.reason === 'petty_expense' ? 'expense' : 'supplier_payment',
        category: m.reason === 'petty_expense' ? m.category : null,
        supplierId: m.reason === 'supplier_payment' ? m.supplierId : null,
        purchaseOrderId: null,
        amountMinor: m.amountMinor,
        description: m.note,
        receiptReference: m.receiptReference,
        userId: actor.userId,
      });
      return;
    }
    if (m.reason === 'float_top_up' || m.reason === 'safe_drop') {
      const toDrawer = m.reason === 'float_top_up';
      await postTransfer(tx, {
        merchantId: actor.merchantId,
        fromAccountId: toDrawer ? treasuryId! : drawerId,
        toAccountId: toDrawer ? drawerId : treasuryId!,
        amountMinor: m.amountMinor,
        origin: 'pos_movement',
        cashMovementId: m.id,
        note: m.note,
        userId: actor.userId,
        fromShiftId: toDrawer ? null : shift.id,
        toShiftId: toDrawer ? shift.id : null,
      });
      return;
    }
    await postEntries(tx, [
      {
        merchantId: actor.merchantId,
        accountId: drawerId,
        amountMinor: m.kind === 'cash_in' ? m.amountMinor : -m.amountMinor,
        entryType:
          m.reason === 'correction' || m.reason === 'other' ? 'adjustment' : 'cash_movement',
        sourceType: 'cash_movement',
        sourceId: m.id,
        description: m.note ?? m.reason,
        createdByUserId: actor.userId,
        shiftId: shift.id,
      },
    ]);
  }

  private async assertSupplier(tx: Transaction, supplierId: string) {
    const [supplier] = await tx
      .select({ status: suppliers.status })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    if (!supplier) throw AppError.notFound('Supplier not found.');
    if (supplier.status !== 'active')
      throw new AppError(409, 'SUPPLIER_INACTIVE', 'This supplier is inactive.');
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
  /**
   * A manager closes an abandoned shift. With a count it is a verified close; without one
   * the shift is `forced_uncounted`: nothing is booked, and the drawer must be counted
   * before the next shift (the difference found then is reported against this shift).
   */
  async forceClose(
    actor: MerchantActor,
    shiftId: string,
    input: ForceCloseInput,
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
      if (input.countedCash === undefined)
        return this.closeUncounted(tx, actor, shift, input.note!, input.version, ip);
      return this.close(
        tx,
        actor,
        shift,
        {
          countedCash: input.countedCash,
          breakdown: input.breakdown,
          note: input.note,
          version: input.version,
        },
        'forced',
        ip,
      );
    });
  }

  private async closeUncounted(
    tx: Transaction,
    actor: MerchantActor,
    shift: ShiftRecord,
    note: string,
    version: number,
    ip: string,
  ): Promise<Shift> {
    if (shift.version !== version) throw versionConflict();
    const expectedMinor = await this.drawerCash(tx, shift);
    const register = await this.findRegister(tx, shift.registerId);
    await tx
      .update(shifts)
      .set({
        status: 'closed',
        closedAt: sql`now()`,
        closedByUserId: actor.userId,
        closeType: 'forced_uncounted',
        expectedCashMinor: expectedMinor,
        discrepancyToleranceMinor: register.discrepancyToleranceMinor,
        closingNote: note,
        version: sql`${shifts.version} + 1`,
      })
      .where(eq(shifts.id, shift.id));
    await tx.update(registers).set({ needsCount: true }).where(eq(registers.id, register.id));
    await this.record(tx, actor, 'shift.force_closed', 'shift', shift.id, ip, {
      counted: false,
      expected: Money.ofMinor(expectedMinor, CURRENCY).toDecimalString(),
    });
    const [row] = await tx.select().from(shifts).where(eq(shifts.id, shift.id));
    return this.toShift(tx, row!);
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
    checkBreakdown(input.breakdown, countedMinor);
    const register = await this.findRegister(tx, shift.registerId);
    const drawer = await registerAccount(tx, shift.registerId);
    await lockAccounts(tx, [drawer.id]);
    const balanceMinor = await accountBalance(tx, drawer.id);
    // Legacy shifts keep the record-based expected cash; their count then becomes the
    // drawer's first verified balance. Otherwise expected = the drawer balance.
    const expectedMinor = shift.legacyOpen
      ? (await this.totals(tx, shift)).expectedCashMinor
      : balanceMinor;
    const discrepancy = countedMinor - expectedMinor;
    // Posted while the shift is still open (register entries carry the open shift).
    await postEntries(tx, [
      {
        merchantId: actor.merchantId,
        accountId: drawer.id,
        amountMinor: countedMinor - balanceMinor,
        entryType: 'adjustment',
        sourceType: shift.legacyOpen ? 'register_initial_count' : 'shift_close',
        sourceId: shift.id,
        description: input.note,
        createdByUserId: actor.userId,
        shiftId: shift.id,
      },
    ]);
    await tx.update(registers).set({ needsCount: false }).where(eq(registers.id, register.id));
    const totals = { expectedCashMinor: expectedMinor };
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
      // Uncounted forced closes booked no difference (ADR-0090): counted apart, never "balanced".
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
      const [totals] = (
        await tx.execute(sql`select ${aggregates},
          count(*) filter (where s.close_type = 'forced_uncounted')::int as uncounted
          from shifts s where ${where}`)
      ).rows as Record<string, unknown>[];
      const byCloseType = (
        await tx.execute(sql`select s.close_type, count(*)::int as n,
            coalesce(sum(s.discrepancy_minor), 0)::text as net
          from shifts s where ${where} group by s.close_type order by s.close_type`)
      ).rows as Record<string, unknown>[];
      // Openings: period by opening time, same branch scope; the first count is no difference.
      const openConditions: SQL[] = [scope ?? sql`true`];
      if (query.from)
        openConditions.push(
          sql`s.opened_at >= (${query.from}::date)::timestamp at time zone ${tz}`,
        );
      if (query.to)
        openConditions.push(
          sql`s.opened_at < ((${query.to}::date + 1)::timestamp at time zone ${tz})`,
        );
      const openWhere = sql.join(openConditions, sql` and `);
      const betweenShifts = (
        await tx.execute(sql`select r.id, r.branch_id, r.name_en, r.name_ar, count(*)::int as n,
            coalesce(sum(s.opening_discrepancy_minor), 0)::text as net
          from shifts s join registers r on r.id = s.register_id
          where ${openWhere} and not s.opening_is_initial and s.opening_follows_shift_id is null
            and s.opening_discrepancy_minor is not null and s.opening_discrepancy_minor <> 0
          group by r.id, r.branch_id, r.name_en, r.name_ar
          order by sum(abs(s.opening_discrepancy_minor)) desc`)
      ).rows as Record<string, unknown>[];
      // Found later for an uncounted forced close: at the next opening, or a manager's count.
      const foundWhere = (column: SQL) => {
        const c: SQL[] = [];
        if (query.from)
          c.push(sql`${column} >= (${query.from}::date)::timestamp at time zone ${tz}`);
        if (query.to)
          c.push(sql`${column} < ((${query.to}::date + 1)::timestamp at time zone ${tz})`);
        return c.length ? sql.join(c, sql` and `) : sql`true`;
      };
      const afterUncounted = (
        await tx.execute(sql`
          select f.id, u.full_name, r.id as register_id, r.name_en, r.name_ar, f.closed_at,
                 x.found_at, x.difference::text as difference
          from (
            select n.opening_follows_shift_id as shift_id, n.opened_at as found_at,
                   n.opening_discrepancy_minor as difference
              from shifts n
             where n.opening_follows_shift_id is not null and n.opening_discrepancy_minor <> 0
               and ${foundWhere(sql`n.opened_at`)}
            union all
            select e.source_id, e.created_at, e.amount_minor
              from financial_account_entries e
             where e.source_type = 'register_count' and ${foundWhere(sql`e.created_at`)}
               and exists (select 1 from shifts z where z.id = e.source_id
                             and z.close_type = 'forced_uncounted')
          ) x
          join shifts f on f.id = x.shift_id
          join shifts s on s.id = f.id
          join users u on u.id = f.user_id
          join registers r on r.id = f.register_id
          where ${scope ?? sql`true`}
          order by x.found_at desc`)
      ).rows as Record<string, unknown>[];
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
        totals: { ...totalsOf(totals!), uncounted: totals!['uncounted'] as number },
        byCloseType: byCloseType.map((r) => ({
          closeType: ((r['close_type'] as string | null) ?? 'normal') as
            'normal' | 'forced' | 'forced_uncounted',
          shifts: r['n'] as number,
          net: money(BigInt(r['net'] as string)),
        })),
        afterUncounted: afterUncounted.map((r) => ({
          shiftId: r['id'] as string,
          employeeName: r['full_name'] as string,
          registerId: r['register_id'] as string,
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
          closedAt: new Date(r['closed_at'] as string).toISOString(),
          foundAt: new Date(r['found_at'] as string).toISOString(),
          difference: money(BigInt(r['difference'] as string)),
        })),
        betweenShifts: betweenShifts.map((r) => ({
          registerId: r['id'] as string,
          branchId: r['branch_id'] as string,
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
          openings: r['n'] as number,
          net: money(BigInt(r['net'] as string)),
        })),
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
        from cash_movements where shift_id = ${shift.id}
          -- Exchanging notes for coins does not change the drawer (ADR-0090).
          and (${shift.legacyOpen} or reason <> 'change_received')`)
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
        ? { ...(await this.totals(tx, r)), expectedCashMinor: r.expectedCashMinor ?? 0n }
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
        openingExpected: r.openingExpectedMinor === null ? null : money(r.openingExpectedMinor),
        openingDiscrepancy:
          r.openingDiscrepancyMinor === null ? null : money(r.openingDiscrepancyMinor),
        openingIsInitial: r.openingIsInitial,
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

function abs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

/** A denomination count must add up exactly to the counted cash. */
function checkBreakdown(breakdown: Breakdown | null | undefined, countedMinor: bigint) {
  if (!breakdown) return;
  let sum = 0n;
  for (const d of breakdown) sum += parseAmount(d.value, 'breakdown') * BigInt(d.count);
  if (sum !== countedMinor)
    throw new AppError(
      400,
      'INVALID_BREAKDOWN',
      'The denomination count does not match the counted cash.',
    );
}
