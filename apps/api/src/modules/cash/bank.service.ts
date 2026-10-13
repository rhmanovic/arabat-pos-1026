import type {
  BankReconciliation,
  BankReconciliationState,
  CashTransfer,
  DepositInTransitList,
  createBankReconciliationSchema,
  depositInTransitQuerySchema,
  settleDepositSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { branchTreasury, lockAccounts, postTransfer } from '../payments/cash-ledger.js';
import {
  bankReconciliationItems,
  bankReconciliations,
  cashTransfers,
  financialAccounts,
} from '../payments/payments.schema.js';
import { parseAmount } from '../payments/payments.service.js';
import { branchScope } from './cash-payouts.service.js';
import { CashService } from './cash.service.js';

type PendingQuery = z.output<typeof depositInTransitQuerySchema>;
type SettleInput = z.output<typeof settleDepositSchema>;
type ReconcileInput = z.output<typeof createBankReconciliationSchema>;
type Row = Record<string, unknown>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();
const decimal = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toDecimalString();
const iso = (v: unknown) => new Date(v as string).toISOString();
const str = (v: unknown) => (v as string | null) ?? null;

/** "-12.500" → −12500n: a bank statement balance may be overdrawn. */
function parseSigned(value: string, path: string): bigint {
  const negative = value.startsWith('-');
  const minor = parseAmount(negative ? value.slice(1) : value, path);
  return negative ? -minor : minor;
}

/**
 * Bank side of cash custody (BR-168, remediation R1.3): deposits wait in "deposits in transit"
 * until a second person confirms them on the bank side (or returns them to the treasury), and
 * each bank account is reconciled by hand against its statement. Nothing here is edited or
 * deleted: a settlement is a new transfer, a reconciliation a new record.
 */
@Injectable()
export class BankService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  // ------------------------------------------------------------ deposits in transit
  async pendingDeposits(actor: MerchantActor, query: PendingQuery): Promise<DepositInTransitList> {
    const scope = branchScope(actor, 'cash.deposit', query.branchId, sql`f.branch_id`);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select t.id, t.amount_minor::text as amount, t.reference, t.note, t.created_at,
                 t.created_by_user_id, u.full_name,
                 f.id as f_id, f.kind as f_kind, f.name_en as f_en, f.name_ar as f_ar, f.branch_id,
                 g.id as g_id, g.name_en as g_en, g.name_ar as g_ar
          from cash_transfers t
          join financial_accounts f on f.id = t.from_account_id
          join financial_accounts d on d.id = t.to_account_id
          join financial_accounts g on g.id = t.target_account_id
          join users u on u.id = t.created_by_user_id
          where d.kind = 'deposit_transit'
            and not exists (select 1 from cash_transfers c where c.confirms_transfer_id = t.id)
            and ${scope ?? sql`true`}
          order by t.created_at, t.id`)
      ).rows as Row[];
      let total = 0n;
      const deposits = rows.map((r) => {
        const amount = BigInt(r['amount'] as string);
        total += amount;
        return {
          id: r['id'] as string,
          from: {
            accountId: r['f_id'] as string,
            kind: r['f_kind'] as 'register' | 'treasury',
            nameEn: str(r['f_en']),
            nameAr: str(r['f_ar']),
          },
          branchId: r['branch_id'] as string,
          bank: { id: r['g_id'] as string, nameEn: str(r['g_en']), nameAr: str(r['g_ar']) },
          amount: money(amount),
          reference: (r['reference'] as string | null) ?? '',
          note: str(r['note']),
          createdBy: r['full_name'] as string,
          createdByUserId: r['created_by_user_id'] as string,
          createdAt: iso(r['created_at']),
        };
      });
      return { deposits, total: money(total) };
    });
  }

  /**
   * A second person confirms a deposit on the bank side (it reaches its bank account) or
   * returns it to the branch treasury. Nobody settles their own deposit; the owner may, and
   * the exception is recorded.
   */
  async settleDeposit(
    actor: MerchantActor,
    id: string,
    input: SettleInput,
    ip: string,
  ): Promise<CashTransfer> {
    try {
      const settlementId = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        // Transfers are append-only (no row locks): a race on the same deposit ends in the
        // unique settlement index below, reported as DEPOSIT_SETTLED.
        const [deposit] = await tx.select().from(cashTransfers).where(eq(cashTransfers.id, id));
        if (!deposit || !deposit.targetAccountId) throw AppError.notFound('Deposit not found.');
        const [transit] = await tx
          .select({ kind: financialAccounts.kind })
          .from(financialAccounts)
          .where(eq(financialAccounts.id, deposit.toAccountId));
        if (transit?.kind !== 'deposit_transit') throw AppError.notFound('Deposit not found.');
        const [from] = await tx
          .select({ branchId: financialAccounts.branchId })
          .from(financialAccounts)
          .where(eq(financialAccounts.id, deposit.fromAccountId));
        assertCan(actor, 'cash.deposit', from!.branchId);
        const [settled] = await tx
          .select({ id: cashTransfers.id })
          .from(cashTransfers)
          .where(eq(cashTransfers.confirmsTransferId, id));
        if (settled)
          throw new AppError(409, 'DEPOSIT_SETTLED', 'This deposit was already settled.');
        const ownerOverride = deposit.createdByUserId === actor.userId;
        if (ownerOverride && !actor.access.isOwner)
          throw AppError.forbidden('You cannot confirm your own deposit.');

        let toAccountId: string;
        if (input.decision === 'confirm') {
          const [bank] = await tx
            .select({ status: financialAccounts.status })
            .from(financialAccounts)
            .where(eq(financialAccounts.id, deposit.targetAccountId));
          if (bank?.status !== 'active')
            throw new AppError(
              409,
              'TRANSFER_NOT_ALLOWED',
              'The bank account is no longer active; return the deposit to the treasury.',
            );
          toAccountId = deposit.targetAccountId;
        } else {
          toAccountId = (await branchTreasury(tx, from!.branchId!)).id;
        }
        await lockAccounts(tx, [deposit.toAccountId, toAccountId]);
        const transferId = await postTransfer(tx, {
          merchantId: actor.merchantId,
          fromAccountId: deposit.toAccountId,
          toAccountId,
          amountMinor: deposit.amountMinor,
          origin: input.decision === 'confirm' ? 'deposit_confirmation' : 'deposit_return',
          confirmsTransferId: id,
          reference: input.reference,
          note: input.note,
          userId: actor.userId,
        });
        await this.audit.recordIn(tx, {
          merchantId: actor.merchantId,
          actorType: 'user',
          actorId: actor.userId,
          action: input.decision === 'confirm' ? 'cash.deposit.confirmed' : 'cash.deposit.returned',
          targetType: 'cash_transfer',
          targetId: id,
          ip,
          details: {
            settlementId: transferId,
            amount: decimal(deposit.amountMinor),
            bank: deposit.targetAccountId,
            depositedBy: deposit.createdByUserId,
            slip: deposit.reference,
            reference: input.reference,
            note: input.note,
            ...(ownerOverride ? { ownerOverride: true } : {}),
          },
        });
        return transferId;
      });
      return this.cash.transferById(actor, settlementId);
    } catch (error) {
      if (isUniqueViolation(error, 'cash_transfers_confirms_key'))
        throw new AppError(409, 'DEPOSIT_SETTLED', 'This deposit was already settled.');
      throw error;
    }
  }

  // ------------------------------------------------------------ bank reconciliation
  async reconciliationState(
    actor: MerchantActor,
    accountId: string,
  ): Promise<BankReconciliationState> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const account = await this.bankAccount(tx, accountId);
      const [sums] = (
        await tx.execute(sql`
          select coalesce((select sum(e.amount_minor) from financial_account_entries e
                           where e.account_id = ${accountId}), 0)::text as book,
                 coalesce((select sum(e.amount_minor) from financial_account_entries e
                           join bank_reconciliation_items i on i.entry_id = e.id
                           where e.account_id = ${accountId}), 0)::text as cleared`)
      ).rows as { book: string; cleared: string }[];
      const unreconciled = (
        await tx.execute(sql`
          select e.id, e.amount_minor::text as amount, e.entry_type, e.source_type, e.description,
                 e.created_at, u.full_name, coalesce(t.reference, o.reference) as reference
          from financial_account_entries e
          left join users u on u.id = e.created_by_user_id
          left join cash_transfers t on e.source_type = 'cash_transfer' and t.id = e.source_id
          -- A confirmation without a bank reference shows the slip number of its deposit.
          left join cash_transfers o on o.id = t.confirms_transfer_id
          where e.account_id = ${accountId}
            and not exists (select 1 from bank_reconciliation_items i where i.entry_id = e.id)
          order by e.created_at, e.id
          limit 1000`)
      ).rows as Row[];
      const history = await this.reconciliationRows(tx, sql`r.account_id = ${accountId}`, 12);
      return {
        account: {
          id: account.id,
          nameEn: account.nameEn,
          nameAr: account.nameAr,
          status: account.status as 'active' | 'inactive',
        },
        bookBalance: money(BigInt(sums!.book)),
        clearedBalance: money(BigInt(sums!.cleared)),
        unreconciled: unreconciled.map((r) => ({
          id: r['id'] as string,
          amount: money(BigInt(r['amount'] as string)),
          entryType: r['entry_type'] as string,
          sourceType: r['source_type'] as string,
          description: str(r['description']),
          reference: str(r['reference']),
          createdBy: str(r['full_name']),
          createdAt: iso(r['created_at']),
        })),
        last: history[0] ?? null,
        history,
      };
    });
  }

  /**
   * Records a reconciliation: the ticked entries appeared on the statement; the cleared balance
   * (everything ticked so far) is compared with the statement balance and any difference must
   * be explained.
   */
  async reconcile(
    actor: MerchantActor,
    accountId: string,
    input: ReconcileInput,
    ip: string,
  ): Promise<BankReconciliation> {
    const statementMinor = parseSigned(input.statementBalance, 'statementBalance');
    const ids = [...new Set(input.entryIds)];
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const account = await this.bankAccount(tx, accountId);
      await lockAccounts(tx, [account.id]);
      const [sums] = (
        await tx.execute(sql`
          select coalesce((select sum(e.amount_minor) from financial_account_entries e
                           where e.account_id = ${accountId}), 0)::text as book,
                 coalesce((select sum(e.amount_minor) from financial_account_entries e
                           join bank_reconciliation_items i on i.entry_id = e.id
                           where e.account_id = ${accountId}), 0)::text as cleared`)
      ).rows as { book: string; cleared: string }[];
      let ticked = 0n;
      if (ids.length > 0) {
        const rows = (
          await tx.execute(sql`
            select e.id, e.amount_minor::text as amount from financial_account_entries e
            where e.account_id = ${accountId}
              and e.id in (${sql.join(
                ids.map((x) => sql`${x}`),
                sql`, `,
              )})
              and not exists (select 1 from bank_reconciliation_items i where i.entry_id = e.id)`)
        ).rows as { id: string; amount: string }[];
        if (rows.length !== ids.length)
          throw AppError.validation([
            {
              path: 'entryIds',
              code: 'invalid',
              message: 'Every ticked entry must be an unreconciled entry of this bank account.',
            },
          ]);
        for (const r of rows) ticked += BigInt(r.amount);
      }
      const cleared = BigInt(sums!.cleared) + ticked;
      const difference = statementMinor - cleared;
      if (difference !== 0n && !input.note)
        throw AppError.validation([
          {
            path: 'note',
            code: 'required',
            message: `The statement differs from the cleared balance by ${decimal(difference)} KWD. Explain the difference.`,
          },
        ]);
      await tx.insert(bankReconciliations).values({
        id,
        merchantId: actor.merchantId,
        accountId,
        statementDate: input.statementDate,
        statementBalanceMinor: statementMinor,
        bookBalanceMinor: BigInt(sums!.book),
        clearedBalanceMinor: cleared,
        differenceMinor: difference,
        note: input.note,
        createdByUserId: actor.userId,
      });
      if (ids.length > 0)
        await tx.insert(bankReconciliationItems).values(
          ids.map((entryId) => ({
            id: newId(),
            merchantId: actor.merchantId,
            reconciliationId: id,
            entryId,
          })),
        );
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'bank.reconciled',
        targetType: 'financial_account',
        targetId: accountId,
        ip,
        details: {
          reconciliationId: id,
          statementDate: input.statementDate,
          statementBalance: decimal(statementMinor),
          clearedBalance: decimal(cleared),
          difference: decimal(difference),
          entries: ids.length,
          note: input.note,
        },
      });
    });
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await this.reconciliationRows(tx, sql`r.id = ${id}`, 1);
      return row!;
    });
  }

  private async reconciliationRows(tx: Transaction, where: ReturnType<typeof sql>, limit: number) {
    const rows = (
      await tx.execute(sql`
        select r.id, r.statement_date, r.statement_balance_minor::text as statement,
               r.book_balance_minor::text as book, r.cleared_balance_minor::text as cleared,
               r.difference_minor::text as difference, r.note, r.created_at, u.full_name,
               (select count(*) from bank_reconciliation_items i where i.reconciliation_id = r.id)::int as items
        from bank_reconciliations r join users u on u.id = r.created_by_user_id
        where ${where}
        order by r.created_at desc, r.id desc
        limit ${limit}`)
    ).rows as Row[];
    return rows.map((r): BankReconciliation => ({
      id: r['id'] as string,
      statementDate: r['statement_date'] as string,
      statementBalance: money(BigInt(r['statement'] as string)),
      bookBalance: money(BigInt(r['book'] as string)),
      clearedBalance: money(BigInt(r['cleared'] as string)),
      difference: money(BigInt(r['difference'] as string)),
      itemCount: Number(r['items']),
      note: str(r['note']),
      createdBy: r['full_name'] as string,
      createdAt: iso(r['created_at']),
    }));
  }

  private async bankAccount(tx: Transaction, id: string) {
    const [row] = await tx.select().from(financialAccounts).where(eq(financialAccounts.id, id));
    if (!row || row.kind !== 'bank' || row.status === 'archived')
      throw AppError.notFound('Bank account not found.');
    return row;
  }
}
