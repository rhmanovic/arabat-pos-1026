import type {
  CashBranch,
  CashOverview,
  CashStatement,
  CashTransfer,
  cashCountSchema,
  cashTransferQuerySchema,
  createCashTransferSchema,
  pageQuerySchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import {
  accountBalance,
  assertCovers,
  assertTreasuryCounted,
  lockAccounts,
  postEntries,
  postTransfer,
} from '../payments/cash-ledger.js';
import { cashTransfers, financialAccounts } from '../payments/payments.schema.js';
import { parseAmount } from '../payments/payments.service.js';
import { cashMovements, registers, shifts } from '../registers/registers.schema.js';
import { ShiftsService } from '../registers/shifts.service.js';

type TransferInput = z.output<typeof createCashTransferSchema>;
type CountInput = z.output<typeof cashCountSchema>;
type PageQuery = z.output<typeof pageQuerySchema>;
type TransferQuery = z.output<typeof cashTransferQuerySchema>;
type AccountRow = typeof financialAccounts.$inferSelect;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();
const decimal = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toDecimalString();
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);

/**
 * Cash custody for managers (ADR-0090): where the cash is (each branch treasury and register
 * drawer), statements, transfers between a register and its branch treasury, and physical
 * counts. Everything here needs `cash.custody` at the branch concerned.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly shifts: ShiftsService,
  ) {}

  async overview(actor: MerchantActor, branchId?: string): Promise<CashOverview> {
    const scope = this.scope(actor, branchId, sql`b.id`);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select a.id, a.kind, a.branch_id, a.register_id, a.name_en, a.name_ar, a.counted_at,
                 coalesce((select sum(e.amount_minor) from financial_account_entries e
                           where e.account_id = a.id), 0)::text as balance,
                 b.name_en as branch_name_en, b.name_ar as branch_name_ar,
                 r.code, r.name_en as register_name_en, r.name_ar as register_name_ar,
                 r.status as register_status, r.needs_count,
                 s.id as shift_id, s.opened_at, u.full_name
          from financial_accounts a
          join branches b on b.id = a.branch_id
          left join registers r on r.id = a.register_id
          left join shifts s on s.register_id = r.id and s.status = 'open'
          left join users u on u.id = s.user_id
          where a.kind in ('treasury', 'register') and ${scope ?? sql`true`}
          order by b.is_main desc, b.name_en nulls last, b.name_ar, r.code`)
      ).rows as Record<string, unknown>[];
      const branches = new Map<string, CashBranch & { totalMinor: bigint }>();
      let treasuriesTotal = 0n;
      let registersTotal = 0n;
      for (const r of rows.filter((x) => x['kind'] === 'treasury')) {
        const balance = BigInt(r['balance'] as string);
        treasuriesTotal += balance;
        branches.set(r['branch_id'] as string, {
          branchId: r['branch_id'] as string,
          nameEn: (r['branch_name_en'] as string | null) ?? null,
          nameAr: (r['branch_name_ar'] as string | null) ?? null,
          treasury: {
            accountId: r['id'] as string,
            nameEn: (r['name_en'] as string | null) ?? null,
            nameAr: (r['name_ar'] as string | null) ?? null,
            balance: money(balance),
            countedAt: iso(r['counted_at'] as string | null),
          },
          registers: [],
          total: money(balance),
          totalMinor: balance,
        });
      }
      for (const r of rows.filter((x) => x['kind'] === 'register')) {
        const branch = branches.get(r['branch_id'] as string);
        if (!branch) continue;
        const balance = BigInt(r['balance'] as string);
        registersTotal += balance;
        branch.totalMinor += balance;
        branch.total = money(branch.totalMinor);
        branch.registers.push({
          accountId: r['id'] as string,
          registerId: r['register_id'] as string,
          code: r['code'] as string,
          nameEn: (r['register_name_en'] as string | null) ?? null,
          nameAr: (r['register_name_ar'] as string | null) ?? null,
          status: r['register_status'] as 'active' | 'inactive',
          balance: money(balance),
          needsCount: Boolean(r['needs_count']),
          openShift: r['shift_id']
            ? {
                id: r['shift_id'] as string,
                employeeName: r['full_name'] as string,
                openedAt: iso(r['opened_at'] as string)!,
              }
            : null,
        });
      }
      // Cash sent between branches stays company cash until it is received (ADR-0091).
      const transitScope = this.scope(actor, branchId, sql`t.from_branch_id`);
      const [transit] = (
        await tx.execute(sql`select coalesce(sum(t.amount_sent_minor), 0)::text as total
          from cash_branch_transfers t
          where t.status = 'in_transit' and ${transitScope ?? sql`true`}`)
      ).rows as { total: string }[];
      const inTransitTotal = BigInt(transit!.total);
      // Deposits not yet confirmed on the bank side (BR-168): no longer cash on hand, not yet
      // in the bank; shown so nobody forgets them.
      const depositScope = this.scope(actor, branchId, sql`f.branch_id`);
      const [deposits] = (
        await tx.execute(sql`select coalesce(sum(t.amount_minor), 0)::text as total
          from cash_transfers t
          join financial_accounts f on f.id = t.from_account_id
          join financial_accounts d on d.id = t.to_account_id
          where d.kind = 'deposit_transit'
            and not exists (select 1 from cash_transfers c where c.confirms_transfer_id = t.id)
            and ${depositScope ?? sql`true`}`)
      ).rows as { total: string }[];
      return {
        branches: [...branches.values()].map(({ totalMinor: _t, ...b }) => b),
        treasuriesTotal: money(treasuriesTotal),
        registersTotal: money(registersTotal),
        inTransitTotal: money(inTransitTotal),
        depositsInTransitTotal: money(BigInt(deposits!.total)),
        total: money(treasuriesTotal + registersTotal + inTransitTotal),
      };
    });
  }

  /** The ledger of one treasury or drawer, newest first, with the running balance. */
  async statement(
    actor: MerchantActor,
    accountId: string,
    query: PageQuery,
  ): Promise<CashStatement> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const account = await this.custodyAccount(tx, accountId);
      assertCan(actor, 'cash.custody', account.branchId);
      const [count] = (
        await tx.execute(sql`select count(*)::int as n from financial_account_entries
          where account_id = ${accountId}`)
      ).rows as { n: number }[];
      const rows = (
        await tx.execute(sql`
          select e.id, e.amount_minor::text as amount, e.entry_type, e.source_type, e.description,
                 e.created_at, u.full_name,
                 (sum(e.amount_minor) over (order by e.created_at, e.id))::text as running
          from financial_account_entries e left join users u on u.id = e.created_by_user_id
          where e.account_id = ${accountId}
          order by e.created_at desc, e.id desc
          limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as Record<string, unknown>[];
      return {
        account: {
          id: account.id,
          kind: account.kind,
          nameEn: account.nameEn,
          nameAr: account.nameAr,
          branchId: account.branchId,
          balance: money(await accountBalance(tx, accountId)),
        },
        entries: rows.map((r) => ({
          id: r['id'] as string,
          amount: money(BigInt(r['amount'] as string)),
          balance: money(BigInt(r['running'] as string)),
          entryType: r['entry_type'] as string,
          sourceType: r['source_type'] as string,
          description: (r['description'] as string | null) ?? null,
          createdBy: (r['full_name'] as string | null) ?? null,
          createdAt: iso(r['created_at'] as string)!,
        })),
        total: count?.n ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async listTransfers(actor: MerchantActor, query: TransferQuery, onlyId?: string) {
    // Branch of a transfer: its register/treasury side (the transit accounts have none); a
    // deposit confirmation belongs to the branch of the deposit it settles.
    const branchOf = sql`coalesce(f.branch_id, d.branch_id,
      (select ff.branch_id from cash_transfers c join financial_accounts ff on ff.id = c.from_account_id
        where c.id = t.confirms_transfer_id))`;
    const scope = this.scope(actor, query.branchId, branchOf);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const where = sql`${scope ?? sql`true`} and ${onlyId ? sql`t.id = ${onlyId}` : sql`true`}`;
      const [count] = (
        await tx.execute(sql`select count(*)::int as n from cash_transfers t
          join financial_accounts f on f.id = t.from_account_id
          join financial_accounts d on d.id = t.to_account_id where ${where}`)
      ).rows as { n: number }[];
      const rows = (
        await tx.execute(sql`
          select t.id, t.amount_minor::text as amount, t.origin, t.note, t.reference, t.created_at,
                 u.full_name, f.id as f_id, f.kind as f_kind, f.name_en as f_en, f.name_ar as f_ar,
                 ${branchOf} as branch_id, d.id as d_id, d.kind as d_kind, d.name_en as d_en, d.name_ar as d_ar
          from cash_transfers t
          join financial_accounts f on f.id = t.from_account_id
          join financial_accounts d on d.id = t.to_account_id
          join users u on u.id = t.created_by_user_id
          where ${where}
          order by t.created_at desc, t.id desc
          limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as Record<string, unknown>[];
      return {
        transfers: rows.map((r): CashTransfer => ({
          id: r['id'] as string,
          from: {
            accountId: r['f_id'] as string,
            kind: r['f_kind'] as string,
            nameEn: (r['f_en'] as string | null) ?? null,
            nameAr: (r['f_ar'] as string | null) ?? null,
          },
          to: {
            accountId: r['d_id'] as string,
            kind: r['d_kind'] as string,
            nameEn: (r['d_en'] as string | null) ?? null,
            nameAr: (r['d_ar'] as string | null) ?? null,
          },
          branchId: (r['branch_id'] as string | null) ?? null,
          amount: money(BigInt(r['amount'] as string)),
          origin: r['origin'] as CashTransfer['origin'],
          note: (r['note'] as string | null) ?? null,
          reference: (r['reference'] as string | null) ?? null,
          createdBy: r['full_name'] as string,
          createdAt: iso(r['created_at'] as string)!,
        })),
        total: count?.n ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /**
   * Moves cash between a register's drawer and its branch treasury. When the register has an
   * open shift, the move is also recorded on the shift (as a drop or top-up by the manager)
   * so the shift's records keep reconciling with the drawer.
   */
  async transfer(actor: MerchantActor, input: TransferInput, ip: string): Promise<CashTransfer> {
    const amountMinor = parseAmount(input.amount, 'amount');
    if (amountMinor <= 0n)
      throw AppError.validation([
        { path: 'amount', code: 'too_small', message: 'Amount must be greater than zero.' },
      ]);
    try {
      const id = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [done] = await tx
          .select({ id: cashTransfers.id })
          .from(cashTransfers)
          .where(eq(cashTransfers.idempotencyKey, input.idempotencyKey));
        if (done) return done.id;
        const from = await this.custodyAccount(tx, input.fromAccountId);
        const to = await this.custodyAccount(tx, input.toAccountId);
        const drawer = from.kind === 'register' ? from : to;
        const treasury = from.kind === 'treasury' ? from : to;
        if (
          drawer.kind !== 'register' ||
          treasury.kind !== 'treasury' ||
          drawer.branchId !== treasury.branchId
        )
          throw new AppError(
            400,
            'TRANSFER_NOT_ALLOWED',
            'Cash moves between a register and the treasury of its branch.',
          );
        assertCan(actor, 'cash.custody', drawer.branchId);
        // Lock order: the open shift first, then the accounts (sorted).
        const [shift] = await tx
          .select()
          .from(shifts)
          .where(and(eq(shifts.registerId, drawer.registerId!), eq(shifts.status, 'open')))
          .for('update');
        await lockAccounts(tx, [from.id, to.id]);
        if (from.kind === 'treasury') {
          assertTreasuryCounted({ ...treasury, branchId: treasury.branchId! });
          assertCovers(await accountBalance(tx, from.id), amountMinor, 'treasury');
        } else {
          const available = shift
            ? await this.shifts.drawerCash(tx, shift)
            : await accountBalance(tx, from.id);
          assertCovers(available, amountMinor, 'register');
        }
        let movementId: string | null = null;
        if (shift) {
          movementId = newId();
          await tx.insert(cashMovements).values({
            id: movementId,
            merchantId: actor.merchantId,
            shiftId: shift.id,
            branchId: shift.branchId,
            registerId: shift.registerId,
            kind: from.kind === 'register' ? 'cash_out' : 'cash_in',
            amountMinor,
            reason: from.kind === 'register' ? 'safe_drop' : 'float_top_up',
            note: input.note,
            createdByUserId: actor.userId,
          });
        }
        const transferId = await postTransfer(tx, {
          merchantId: actor.merchantId,
          fromAccountId: from.id,
          toAccountId: to.id,
          amountMinor,
          origin: 'manager',
          cashMovementId: movementId,
          note: input.note,
          idempotencyKey: input.idempotencyKey,
          userId: actor.userId,
          fromShiftId: from.kind === 'register' ? (shift?.id ?? null) : null,
          toShiftId: to.kind === 'register' ? (shift?.id ?? null) : null,
        });
        await this.record(tx, actor, 'cash.transfer.created', 'cash_transfer', transferId, ip, {
          from: from.id,
          to: to.id,
          amount: decimal(amountMinor),
          shiftId: shift?.id ?? null,
        });
        return transferId;
      });
      return this.transferById(actor, id);
    } catch (error) {
      if (isUniqueViolation(error, 'cash_transfers_idempotency_key')) {
        const [existing] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
          tx
            .select({ id: cashTransfers.id })
            .from(cashTransfers)
            .where(eq(cashTransfers.idempotencyKey, input.idempotencyKey)),
        );
        if (existing) return this.transferById(actor, existing.id);
      }
      throw error;
    }
  }

  /**
   * Records a physical count of a treasury, or of a drawer without an open shift. The
   * difference is booked as an adjustment; a treasury's first count is its opening balance.
   */
  async count(
    actor: MerchantActor,
    accountId: string,
    input: CountInput,
    ip: string,
  ): Promise<CashBranch> {
    const countedMinor = parseAmount(input.countedCash, 'countedCash');
    const shownMinor = parseAmount(input.expectedCash, 'expectedCash');
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
    const branchId = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const account = await this.custodyAccount(tx, accountId);
      assertCan(actor, 'cash.custody', account.branchId);
      let register: typeof registers.$inferSelect | undefined;
      if (account.kind === 'register') {
        [register] = await tx
          .select()
          .from(registers)
          .where(eq(registers.id, account.registerId!))
          .for('update');
        const [open] = await tx
          .select({ id: shifts.id })
          .from(shifts)
          .where(and(eq(shifts.registerId, account.registerId!), eq(shifts.status, 'open')));
        if (open)
          throw new AppError(
            409,
            'REGISTER_BUSY',
            'This register has an open shift: its cashier counts it when closing.',
          );
      }
      await lockAccounts(tx, [account.id]);
      const balance = await accountBalance(tx, account.id);
      if (balance !== shownMinor)
        throw new AppError(409, 'EXPECTED_CHANGED', 'The balance changed. Count again.');
      const difference = countedMinor - balance;
      // First counts set the balance; later differences need an explanation.
      const firstCount =
        account.kind === 'treasury' ? account.countedAt === null : Boolean(register?.needsCount);
      let followsShiftId: string | null = null;
      if (register?.needsCount) {
        const [last] = await tx
          .select({ id: shifts.id, closeType: shifts.closeType, legacyOpen: shifts.legacyOpen })
          .from(shifts)
          .where(and(eq(shifts.registerId, register.id), eq(shifts.status, 'closed')))
          .orderBy(sql`${shifts.closedAt} desc`)
          .limit(1);
        if (last?.closeType === 'forced_uncounted' && !last.legacyOpen) followsShiftId = last.id;
      }
      const initial = firstCount && !followsShiftId;
      if (!initial && difference !== 0n && !input.note)
        throw AppError.validation([
          { path: 'note', code: 'required', message: 'Explain the difference.' },
        ]);
      const sourceType =
        account.kind === 'treasury'
          ? initial
            ? 'treasury_opening_count'
            : 'treasury_count'
          : initial
            ? 'register_initial_count'
            : 'register_count';
      await postEntries(tx, [
        {
          merchantId: actor.merchantId,
          accountId: account.id,
          amountMinor: difference,
          entryType: 'adjustment',
          sourceType,
          // A drawer difference after an uncounted forced close belongs to that shift.
          sourceId: followsShiftId ?? newId(),
          description: input.note,
          createdByUserId: actor.userId,
        },
      ]);
      if (account.kind === 'treasury' && account.countedAt === null)
        await tx
          .update(financialAccounts)
          .set({ countedAt: sql`now()` })
          .where(eq(financialAccounts.id, account.id));
      if (register)
        await tx.update(registers).set({ needsCount: false }).where(eq(registers.id, register.id));
      await this.record(tx, actor, 'cash.counted', 'financial_account', account.id, ip, {
        kind: account.kind,
        expected: decimal(balance),
        counted: decimal(countedMinor),
        difference: decimal(difference),
        initial,
        followsShiftId,
      });
      return account.branchId!;
    });
    const overview = await this.overview(actor, branchId);
    return overview.branches[0]!;
  }

  // ------------------------------------------------------------ helpers
  async transferById(actor: MerchantActor, id: string): Promise<CashTransfer> {
    const { transfers } = await this.listTransfers(actor, { page: 1, pageSize: 1 }, id);
    if (!transfers[0]) throw AppError.notFound();
    return transfers[0];
  }

  private async custodyAccount(tx: Transaction, id: string): Promise<AccountRow> {
    const [row] = await tx.select().from(financialAccounts).where(eq(financialAccounts.id, id));
    if (!row || (row.kind !== 'register' && row.kind !== 'treasury'))
      throw AppError.notFound('Cash account not found.');
    return row;
  }

  private scope(actor: MerchantActor, branchId: string | undefined, column: SQL): SQL | undefined {
    if (branchId) {
      assertCan(actor, 'cash.custody', branchId);
      return sql`${column} = ${branchId}`;
    }
    const scope = permissionBranchScope(actor.access, 'cash.custody');
    if (scope.all) return undefined;
    if (scope.branchIds.length === 0) throw AppError.forbidden();
    return sql`${column} in (${sql.join(
      scope.branchIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    targetType: string,
    targetId: string,
    ip: string,
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
      details,
    });
  }
}
