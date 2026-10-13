import type {
  BankAccountOption,
  CashBranchTransfer,
  CashDisbursement,
  CashDisbursementList,
  CashTransfer,
  SupplierOptions,
  SupplierPayments,
  cancelCashBranchTransferSchema,
  cashBranchTransferQuerySchema,
  cashDisbursementQuerySchema,
  createBankDepositSchema,
  createCashBranchTransferSchema,
  createCashDisbursementSchema,
  receiveCashBranchTransferSchema,
  reverseCashDisbursementSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { type PermissionKey, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { branches } from '../branches/branches.schema.js';
import {
  accountBalance,
  activeBankAccount,
  assertCovers,
  assertTreasuryCounted,
  branchTreasury,
  inTransitAccount,
  lockAccounts,
  postDisbursement,
  postEntries,
  postTransfer,
} from '../payments/cash-ledger.js';
import {
  cashBranchTransfers,
  cashDisbursements,
  cashTransfers,
  financialAccounts,
} from '../payments/payments.schema.js';
import { parseAmount } from '../payments/payments.service.js';
import { purchaseOrders, suppliers } from '../purchasing/purchasing.schema.js';
import { shifts } from '../registers/registers.schema.js';
import {
  assertNotOverpaid,
  assertReceiptReference,
  exceedsApprovalLimit,
} from './approval-limits.js';
import { CashService } from './cash.service.js';

type DisbursementInput = z.output<typeof createCashDisbursementSchema>;
type DisbursementQuery = z.output<typeof cashDisbursementQuerySchema>;
type ReverseInput = z.output<typeof reverseCashDisbursementSchema>;
type DepositInput = z.output<typeof createBankDepositSchema>;
type SendInput = z.output<typeof createCashBranchTransferSchema>;
type ReceiveInput = z.output<typeof receiveCashBranchTransferSchema>;
type CancelInput = z.output<typeof cancelCashBranchTransferSchema>;
type BranchTransferQuery = z.output<typeof cashBranchTransferQuerySchema>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();
const decimal = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toDecimalString();
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
const str = (v: unknown) => (v as string | null) ?? null;

/**
 * Cash leaving custody (ADR-0091): expenses and supplier payments (real outflows, never
 * transfers), bank deposits, and cash sent between branch treasuries through the company
 * in-transit account. Payments from a drawer are made at the POS (shifts service); this
 * service covers the manager side, reversals, lists and the POS pickers.
 */
@Injectable()
export class CashPayoutsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
  ) {}

  // ------------------------------------------------------------ disbursements
  async listDisbursements(
    actor: MerchantActor,
    query: DisbursementQuery,
  ): Promise<CashDisbursementList> {
    const scope = branchScope(actor, 'cash.custody', query.branchId, sql`d.branch_id`);
    const filters: SQL[] = [scope ?? sql`true`];
    if (query.kind) filters.push(sql`d.kind = ${query.kind}`);
    if (query.category) filters.push(sql`d.category = ${query.category}`);
    if (query.supplierId) filters.push(sql`d.supplier_id = ${query.supplierId}`);
    if (query.from) filters.push(sql`d.created_at >= ${query.from}::date`);
    if (query.to) filters.push(sql`d.created_at < ${query.to}::date + 1`);
    const where = sql.join(filters, sql` and `);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [agg] = (
        await tx.execute(sql`select count(*)::int as n,
            coalesce(sum(case when d.reverses_id is null then d.amount_minor
                              else -d.amount_minor end), 0)::text as net
          from cash_disbursements d where ${where}`)
      ).rows as { n: number; net: string }[];
      const rows = await this.disbursementRows(
        tx,
        where,
        sql`limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`,
      );
      return {
        disbursements: rows,
        netTotal: money(BigInt(agg!.net)),
        total: agg!.n,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** Supplier page: cash paid to one supplier in the branches the actor may see. */
  async supplierPayments(actor: MerchantActor, supplierId: string): Promise<SupplierPayments> {
    const scope = branchScope(actor, 'purchasing.read', undefined, sql`d.branch_id`);
    const where = sql`d.kind = 'supplier_payment' and d.supplier_id = ${supplierId}
      and ${scope ?? sql`true`}`;
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.id, supplierId));
      if (!supplier) throw AppError.notFound('Supplier not found.');
      const [agg] = (
        await tx.execute(sql`select coalesce(sum(case when d.reverses_id is null
            then d.amount_minor else -d.amount_minor end), 0)::text as net
          from cash_disbursements d where ${where}`)
      ).rows as { net: string }[];
      return {
        payments: await this.disbursementRows(tx, where, sql`limit 200`),
        totalPaid: money(BigInt(agg!.net)),
      };
    });
  }

  /** A manager pays an expense or a supplier from a branch treasury. */
  async createDisbursement(
    actor: MerchantActor,
    input: DisbursementInput,
    ip: string,
  ): Promise<CashDisbursement> {
    assertCan(actor, 'cash.custody', input.branchId);
    const amountMinor = positive(input.amount, 'amount');
    try {
      const id = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [done] = await tx
          .select({ id: cashDisbursements.id })
          .from(cashDisbursements)
          .where(eq(cashDisbursements.idempotencyKey, input.idempotencyKey));
        if (done) return done.id;
        if (input.kind === 'supplier_payment')
          await assertPayable(tx, input.supplierId!, input.purchaseOrderId ?? null);
        // Above the company's approval limit a second custody holder must approve (BR-166);
        // the owner pays directly and the exception is recorded.
        const limitExceeded = await exceedsApprovalLimit(
          tx,
          actor.merchantId,
          input.kind,
          amountMinor,
        );
        if (limitExceeded) {
          assertReceiptReference(input.receiptReference);
          if (!actor.access.isOwner)
            throw new AppError(
              409,
              'APPROVAL_REQUIRED',
              'This amount is above the approval limit: record it as a request for a second person to approve.',
            );
        }
        const overpaid =
          input.kind === 'supplier_payment' && input.purchaseOrderId
            ? await assertNotOverpaid(
                tx,
                actor,
                input.purchaseOrderId,
                amountMinor,
                input.confirmOverpayment,
              )
            : false;
        const treasury = await branchTreasury(tx, input.branchId);
        await lockAccounts(tx, [treasury.id]);
        assertTreasuryCounted(treasury);
        assertCovers(await accountBalance(tx, treasury.id), amountMinor, 'treasury');
        const disbursementId = await postDisbursement(tx, {
          merchantId: actor.merchantId,
          branchId: input.branchId,
          sourceAccountId: treasury.id,
          shiftId: null,
          kind: input.kind,
          category: input.kind === 'expense' ? input.category! : null,
          supplierId: input.kind === 'supplier_payment' ? input.supplierId! : null,
          purchaseOrderId:
            input.kind === 'supplier_payment' ? (input.purchaseOrderId ?? null) : null,
          amountMinor,
          description: input.description,
          receiptReference: input.receiptReference,
          idempotencyKey: input.idempotencyKey,
          userId: actor.userId,
        });
        await this.record(tx, actor, 'cash.disbursement.created', disbursementId, ip, {
          kind: input.kind,
          amount: decimal(amountMinor),
          branchId: input.branchId,
          source: 'treasury',
          ...(limitExceeded ? { limitExceeded: true, ownerOverride: true } : {}),
          ...(overpaid ? { overpaymentConfirmed: true } : {}),
        });
        return disbursementId;
      });
      return this.disbursementById(actor, id);
    } catch (error) {
      if (isUniqueViolation(error, 'cash_disbursements_idempotency_key')) {
        const existing = await this.byKey(actor, input.idempotencyKey);
        if (existing) return this.disbursementById(actor, existing);
      }
      throw error;
    }
  }

  /**
   * Cancels an expense or supplier payment with a reversing record: the amount returns to
   * the register or treasury it was paid from. Records are never edited or deleted.
   */
  async reverseDisbursement(
    actor: MerchantActor,
    id: string,
    input: ReverseInput,
    ip: string,
  ): Promise<CashDisbursement> {
    try {
      const reversalId = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [done] = await tx
          .select({ id: cashDisbursements.id })
          .from(cashDisbursements)
          .where(eq(cashDisbursements.idempotencyKey, input.idempotencyKey));
        if (done) return done.id;
        const [original] = await tx
          .select()
          .from(cashDisbursements)
          .where(eq(cashDisbursements.id, id));
        if (!original) throw AppError.notFound('Payment not found.');
        assertCan(actor, 'cash.custody', original.branchId);
        if (original.reversesId)
          throw new AppError(409, 'INVALID_STATE', 'A reversal cannot be reversed.');
        const [source] = await tx
          .select()
          .from(financialAccounts)
          .where(eq(financialAccounts.id, original.sourceAccountId));
        // Lock order: the register's open shift (if any), then the account.
        let shiftId: string | null = null;
        if (source!.kind === 'register') {
          const [open] = await tx
            .select({ id: shifts.id })
            .from(shifts)
            .where(and(eq(shifts.registerId, source!.registerId!), eq(shifts.status, 'open')))
            .for('update');
          shiftId = open?.id ?? null;
        }
        await lockAccounts(tx, [source!.id]);
        const [already] = await tx
          .select({ id: cashDisbursements.id })
          .from(cashDisbursements)
          .where(eq(cashDisbursements.reversesId, original.id));
        if (already) throw new AppError(409, 'INVALID_STATE', 'This payment is already reversed.');
        const newIdValue = await postDisbursement(tx, {
          merchantId: actor.merchantId,
          branchId: original.branchId,
          sourceAccountId: original.sourceAccountId,
          shiftId,
          kind: original.kind as 'expense' | 'supplier_payment',
          category: original.category,
          supplierId: original.supplierId,
          purchaseOrderId: original.purchaseOrderId,
          amountMinor: original.amountMinor,
          description: input.reason,
          receiptReference: original.receiptReference,
          reversesId: original.id,
          idempotencyKey: input.idempotencyKey,
          userId: actor.userId,
        });
        await this.record(tx, actor, 'cash.disbursement.reversed', original.id, ip, {
          reversalId: newIdValue,
          amount: decimal(original.amountMinor),
          reason: input.reason,
        });
        return newIdValue;
      });
      return this.disbursementById(actor, reversalId);
    } catch (error) {
      if (
        isUniqueViolation(error, 'cash_disbursements_idempotency_key') ||
        isUniqueViolation(error, 'cash_disbursements_one_reversal')
      ) {
        const existing = await this.byKey(actor, input.idempotencyKey);
        if (existing) return this.disbursementById(actor, existing);
        throw new AppError(409, 'INVALID_STATE', 'This payment is already reversed.');
      }
      throw error;
    }
  }

  // ------------------------------------------------------------ bank deposits
  /** A manager deposits cash from a branch treasury into a bank account. */
  async deposit(actor: MerchantActor, input: DepositInput, ip: string): Promise<CashTransfer> {
    const amountMinor = positive(input.amount, 'amount');
    try {
      const id = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [done] = await tx
          .select({ id: cashTransfers.id })
          .from(cashTransfers)
          .where(eq(cashTransfers.idempotencyKey, input.idempotencyKey));
        if (done) return done.id;
        const [from] = await tx
          .select()
          .from(financialAccounts)
          .where(eq(financialAccounts.id, input.fromAccountId));
        if (!from || from.kind !== 'treasury' || !from.branchId)
          throw new AppError(
            400,
            'TRANSFER_NOT_ALLOWED',
            'Deposits from a drawer are made at the POS; choose a branch treasury.',
          );
        assertCan(actor, 'cash.deposit', from.branchId);
        const bankId = await activeBankAccount(tx, input.bankAccountId);
        await lockAccounts(tx, [from.id, bankId]);
        assertTreasuryCounted({ ...from, branchId: from.branchId });
        assertCovers(await accountBalance(tx, from.id), amountMinor, 'treasury');
        const transferId = await postTransfer(tx, {
          merchantId: actor.merchantId,
          fromAccountId: from.id,
          toAccountId: bankId,
          amountMinor,
          origin: 'deposit',
          note: input.note,
          reference: input.reference,
          idempotencyKey: input.idempotencyKey,
          userId: actor.userId,
        });
        await this.record(tx, actor, 'cash.deposit.created', transferId, ip, {
          from: from.id,
          bank: bankId,
          amount: decimal(amountMinor),
          reference: input.reference,
        });
        return transferId;
      });
      return this.cash.transferById(actor, id);
    } catch (error) {
      if (isUniqueViolation(error, 'cash_transfers_idempotency_key')) {
        const [existing] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
          tx
            .select({ id: cashTransfers.id })
            .from(cashTransfers)
            .where(eq(cashTransfers.idempotencyKey, input.idempotencyKey)),
        );
        if (existing) return this.cash.transferById(actor, existing.id);
      }
      throw error;
    }
  }

  // ------------------------------------------------------------ branch transfers
  async listBranchTransfers(actor: MerchantActor, query: BranchTransferQuery) {
    const from = branchScope(actor, 'cash.custody', query.branchId, sql`t.from_branch_id`);
    const to = branchScope(actor, 'cash.custody', query.branchId, sql`t.to_branch_id`);
    const filters: SQL[] = [from && to ? sql`(${from} or ${to})` : sql`true`];
    if (query.status) filters.push(sql`t.status = ${query.status}`);
    const where = sql.join(filters, sql` and `);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [count] = (
        await tx.execute(sql`select count(*)::int as n from cash_branch_transfers t where ${where}`)
      ).rows as { n: number }[];
      return {
        transfers: await this.branchTransferRows(
          tx,
          where,
          sql`limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`,
        ),
        total: count?.n ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  /** Sends cash from one branch treasury: it waits in transit until the other branch counts it. */
  async sendBranchTransfer(
    actor: MerchantActor,
    input: SendInput,
    ip: string,
  ): Promise<CashBranchTransfer> {
    assertCan(actor, 'cash.custody', input.fromBranchId);
    const amountMinor = positive(input.amount, 'amount');
    try {
      const id = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [done] = await tx
          .select({ id: cashBranchTransfers.id })
          .from(cashBranchTransfers)
          .where(eq(cashBranchTransfers.idempotencyKey, input.idempotencyKey));
        if (done) return done.id;
        const [target] = await tx
          .select({ status: branches.status })
          .from(branches)
          .where(eq(branches.id, input.toBranchId));
        if (!target) throw AppError.notFound('Branch not found.');
        if (target.status !== 'active')
          throw new AppError(409, 'BRANCH_INACTIVE', 'The receiving branch is inactive.');
        const source = await branchTreasury(tx, input.fromBranchId);
        const destination = await branchTreasury(tx, input.toBranchId);
        const transit = await inTransitAccount(tx, actor.merchantId);
        await lockAccounts(tx, [source.id, transit]);
        assertTreasuryCounted(source);
        assertCovers(await accountBalance(tx, source.id), amountMinor, 'treasury');
        const transferId = newId();
        await tx.insert(cashBranchTransfers).values({
          id: transferId,
          merchantId: actor.merchantId,
          number: await nextDocumentNumber(tx, actor.merchantId, 'cash_branch_transfer', 'CT'),
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          fromAccountId: source.id,
          toAccountId: destination.id,
          amountSentMinor: amountMinor,
          sendNote: input.note,
          idempotencyKey: input.idempotencyKey,
          sentByUserId: actor.userId,
        });
        await postTransfer(tx, {
          merchantId: actor.merchantId,
          fromAccountId: source.id,
          toAccountId: transit,
          amountMinor,
          origin: 'branch_transfer',
          branchTransferId: transferId,
          note: input.note,
          userId: actor.userId,
        });
        await this.record(tx, actor, 'cash.branch_transfer.sent', transferId, ip, {
          from: input.fromBranchId,
          to: input.toBranchId,
          amount: decimal(amountMinor),
        });
        return transferId;
      });
      return this.branchTransferById(actor, id);
    } catch (error) {
      if (isUniqueViolation(error, 'cash_branch_transfers_idempotency_key')) {
        const [existing] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
          tx
            .select({ id: cashBranchTransfers.id })
            .from(cashBranchTransfers)
            .where(eq(cashBranchTransfers.idempotencyKey, input.idempotencyKey)),
        );
        if (existing) return this.branchTransferById(actor, existing.id);
      }
      throw error;
    }
  }

  /**
   * The receiving branch confirms the amount it counted. A difference from what was sent is
   * booked on the transfer (in transit), so the in-transit account returns to zero for it.
   */
  async receiveBranchTransfer(
    actor: MerchantActor,
    id: string,
    input: ReceiveInput,
    ip: string,
  ): Promise<CashBranchTransfer> {
    const receivedMinor = parseAmount(input.receivedAmount, 'receivedAmount');
    if (receivedMinor < 0n)
      throw AppError.validation([
        { path: 'receivedAmount', code: 'too_small', message: 'Amount cannot be negative.' },
      ]);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const transfer = await this.lockPending(tx, id, input.version);
      assertCan(actor, 'cash.custody', transfer.toBranchId);
      const difference = receivedMinor - transfer.amountSentMinor;
      if (difference !== 0n && !input.note)
        throw AppError.validation([
          { path: 'note', code: 'required', message: 'Explain the difference.' },
        ]);
      const transit = await inTransitAccount(tx, actor.merchantId);
      await lockAccounts(tx, [transit, transfer.toAccountId]);
      await postEntries(tx, [
        {
          merchantId: actor.merchantId,
          accountId: transit,
          amountMinor: difference,
          entryType: 'adjustment',
          sourceType: 'branch_transfer_difference',
          sourceId: transfer.id,
          description: input.note,
          createdByUserId: actor.userId,
        },
      ]);
      if (receivedMinor > 0n)
        await postTransfer(tx, {
          merchantId: actor.merchantId,
          fromAccountId: transit,
          toAccountId: transfer.toAccountId,
          amountMinor: receivedMinor,
          origin: 'branch_transfer',
          branchTransferId: transfer.id,
          note: input.note,
          userId: actor.userId,
        });
      await tx
        .update(cashBranchTransfers)
        .set({
          status: 'received',
          amountReceivedMinor: receivedMinor,
          receiveNote: input.note,
          receivedByUserId: actor.userId,
          receivedAt: sql`now()`,
          version: transfer.version + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(cashBranchTransfers.id, transfer.id));
      await this.record(tx, actor, 'cash.branch_transfer.received', transfer.id, ip, {
        sent: decimal(transfer.amountSentMinor),
        received: decimal(receivedMinor),
        difference: decimal(difference),
      });
    });
    return this.branchTransferById(actor, id);
  }

  /** The sender takes back a transfer that has not been received. */
  async cancelBranchTransfer(
    actor: MerchantActor,
    id: string,
    input: CancelInput,
    ip: string,
  ): Promise<CashBranchTransfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const transfer = await this.lockPending(tx, id, input.version);
      assertCan(actor, 'cash.custody', transfer.fromBranchId);
      const transit = await inTransitAccount(tx, actor.merchantId);
      await lockAccounts(tx, [transit, transfer.fromAccountId]);
      await postTransfer(tx, {
        merchantId: actor.merchantId,
        fromAccountId: transit,
        toAccountId: transfer.fromAccountId,
        amountMinor: transfer.amountSentMinor,
        origin: 'branch_transfer',
        branchTransferId: transfer.id,
        note: input.note,
        userId: actor.userId,
      });
      await tx
        .update(cashBranchTransfers)
        .set({
          status: 'cancelled',
          cancelNote: input.note,
          cancelledByUserId: actor.userId,
          cancelledAt: sql`now()`,
          version: transfer.version + 1,
          updatedAt: sql`now()`,
        })
        .where(eq(cashBranchTransfers.id, transfer.id));
      await this.record(tx, actor, 'cash.branch_transfer.cancelled', transfer.id, ip, {
        amount: decimal(transfer.amountSentMinor),
        note: input.note,
      });
    });
    return this.branchTransferById(actor, id);
  }

  // ------------------------------------------------------------ POS pickers
  async posBankAccounts(actor: MerchantActor): Promise<{ accounts: BankAccountOption[] }> {
    if (!actor.boundBranchId) throw AppError.forbidden();
    assertCan(actor, 'cash.deposit', actor.boundBranchId);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      accounts: await tx
        .select({
          id: financialAccounts.id,
          nameEn: financialAccounts.nameEn,
          nameAr: financialAccounts.nameAr,
        })
        .from(financialAccounts)
        .where(and(eq(financialAccounts.kind, 'bank'), eq(financialAccounts.status, 'active')))
        .orderBy(financialAccounts.createdAt),
    }));
  }

  async posSuppliers(actor: MerchantActor): Promise<SupplierOptions> {
    if (!actor.boundBranchId) throw AppError.forbidden();
    assertCan(actor, 'cash.move', actor.boundBranchId);
    return this.supplierOptions(actor);
  }

  /** Manager pickers: bank accounts (deposits), suppliers and their payable orders. */
  async bankAccounts(actor: MerchantActor): Promise<{ accounts: BankAccountOption[] }> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      accounts: await tx
        .select({
          id: financialAccounts.id,
          nameEn: financialAccounts.nameEn,
          nameAr: financialAccounts.nameAr,
        })
        .from(financialAccounts)
        .where(and(eq(financialAccounts.kind, 'bank'), eq(financialAccounts.status, 'active')))
        .orderBy(financialAccounts.createdAt),
    }));
  }

  async payableOrders(actor: MerchantActor, supplierId: string) {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      orders: await tx
        .select({ id: purchaseOrders.id, number: purchaseOrders.number })
        .from(purchaseOrders)
        .where(
          and(
            eq(purchaseOrders.supplierId, supplierId),
            sql`${purchaseOrders.status} not in ('draft', 'cancelled')`,
          ),
        )
        .orderBy(sql`${purchaseOrders.createdAt} desc`)
        .limit(50),
    }));
  }

  async supplierOptions(actor: MerchantActor): Promise<SupplierOptions> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      suppliers: await tx
        .select({
          id: suppliers.id,
          code: suppliers.code,
          nameEn: suppliers.nameEn,
          nameAr: suppliers.nameAr,
        })
        .from(suppliers)
        .where(eq(suppliers.status, 'active'))
        .orderBy(suppliers.nameEn, suppliers.nameAr)
        .limit(500),
    }));
  }

  // ------------------------------------------------------------ helpers
  private async lockPending(tx: Transaction, id: string, version: number) {
    const [transfer] = await tx
      .select()
      .from(cashBranchTransfers)
      .where(eq(cashBranchTransfers.id, id))
      .for('update');
    if (!transfer) throw AppError.notFound('Transfer not found.');
    if (transfer.status !== 'in_transit')
      throw new AppError(409, 'INVALID_STATE', 'This transfer is no longer in transit.');
    if (transfer.version !== version)
      throw new AppError(409, 'VERSION_CONFLICT', 'The transfer changed. Reload and try again.');
    return transfer;
  }

  private async byKey(actor: MerchantActor, key: string): Promise<string | null> {
    const [row] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      tx
        .select({ id: cashDisbursements.id })
        .from(cashDisbursements)
        .where(eq(cashDisbursements.idempotencyKey, key)),
    );
    return row?.id ?? null;
  }

  async disbursementById(actor: MerchantActor, id: string): Promise<CashDisbursement> {
    const [row] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      this.disbursementRows(tx, sql`d.id = ${id}`, sql`limit 1`),
    );
    if (!row) throw AppError.notFound();
    return row;
  }

  private async disbursementRows(
    tx: Transaction,
    where: SQL,
    page: SQL,
  ): Promise<CashDisbursement[]> {
    const rows = (
      await tx.execute(sql`
        select d.id, d.number, d.kind, d.category, d.supplier_id, d.purchase_order_id,
               d.branch_id, d.source_account_id, d.shift_id, d.amount_minor::text as amount,
               d.description, d.receipt_reference, d.reverses_id, d.created_at,
               s.name_en as s_en, s.name_ar as s_ar, po.number as po_number,
               b.name_en as b_en, b.name_ar as b_ar,
               a.kind as a_kind, a.name_en as a_en, a.name_ar as a_ar, u.full_name,
               (select r.id from cash_disbursements r where r.reverses_id = d.id) as reversed_by
        from cash_disbursements d
        join branches b on b.id = d.branch_id
        join financial_accounts a on a.id = d.source_account_id
        join users u on u.id = d.created_by_user_id
        left join suppliers s on s.id = d.supplier_id
        left join purchase_orders po on po.id = d.purchase_order_id
        where ${where}
        order by d.created_at desc, d.id desc
        ${page}`)
    ).rows as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r['id'] as string,
      number: r['number'] as string,
      kind: r['kind'] as CashDisbursement['kind'],
      category: str(r['category']) as CashDisbursement['category'],
      supplier: r['supplier_id']
        ? { id: r['supplier_id'] as string, nameEn: str(r['s_en']), nameAr: str(r['s_ar']) }
        : null,
      purchaseOrder: r['purchase_order_id']
        ? { id: r['purchase_order_id'] as string, number: r['po_number'] as string }
        : null,
      branch: { id: r['branch_id'] as string, nameEn: str(r['b_en']), nameAr: str(r['b_ar']) },
      source: {
        accountId: r['source_account_id'] as string,
        kind: r['a_kind'] as 'register' | 'treasury',
        nameEn: str(r['a_en']),
        nameAr: str(r['a_ar']),
      },
      shiftId: str(r['shift_id']),
      amount: money(BigInt(r['amount'] as string)),
      description: str(r['description']),
      receiptReference: str(r['receipt_reference']),
      reversesId: str(r['reverses_id']),
      reversedById: str(r['reversed_by']),
      createdBy: r['full_name'] as string,
      createdAt: iso(r['created_at'] as string)!,
    }));
  }

  private async branchTransferById(actor: MerchantActor, id: string): Promise<CashBranchTransfer> {
    const [row] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      this.branchTransferRows(tx, sql`t.id = ${id}`, sql`limit 1`),
    );
    if (!row) throw AppError.notFound();
    return row;
  }

  private async branchTransferRows(
    tx: Transaction,
    where: SQL,
    page: SQL,
  ): Promise<CashBranchTransfer[]> {
    const rows = (
      await tx.execute(sql`
        select t.*, t.amount_sent_minor::text as sent, t.amount_received_minor::text as received,
               fb.name_en as fb_en, fb.name_ar as fb_ar, tb.name_en as tb_en, tb.name_ar as tb_ar,
               su.full_name as sent_by, ru.full_name as received_by, cu.full_name as cancelled_by
        from cash_branch_transfers t
        join branches fb on fb.id = t.from_branch_id
        join branches tb on tb.id = t.to_branch_id
        join users su on su.id = t.sent_by_user_id
        left join users ru on ru.id = t.received_by_user_id
        left join users cu on cu.id = t.cancelled_by_user_id
        where ${where}
        order by t.created_at desc, t.id desc
        ${page}`)
    ).rows as Record<string, unknown>[];
    return rows.map((r) => {
      const sent = BigInt(r['sent'] as string);
      const received = r['received'] == null ? null : BigInt(r['received'] as string);
      return {
        id: r['id'] as string,
        number: r['number'] as string,
        fromBranch: {
          id: r['from_branch_id'] as string,
          nameEn: str(r['fb_en']),
          nameAr: str(r['fb_ar']),
        },
        toBranch: {
          id: r['to_branch_id'] as string,
          nameEn: str(r['tb_en']),
          nameAr: str(r['tb_ar']),
        },
        amountSent: money(sent),
        amountReceived: received === null ? null : money(received),
        difference: received === null ? null : money(received - sent),
        status: r['status'] as CashBranchTransfer['status'],
        sendNote: str(r['send_note']),
        receiveNote: str(r['receive_note']),
        cancelNote: str(r['cancel_note']),
        sentBy: r['sent_by'] as string,
        sentAt: iso(r['created_at'] as string)!,
        receivedBy: str(r['received_by']),
        receivedAt: iso(r['received_at'] as string | null),
        cancelledBy: str(r['cancelled_by']),
        cancelledAt: iso(r['cancelled_at'] as string | null),
        version: r['version'] as number,
      };
    });
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    targetId: string,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: action.startsWith('cash.disbursement')
        ? 'cash_disbursement'
        : action.startsWith('cash.branch_transfer')
          ? 'cash_branch_transfer'
          : 'cash_transfer',
      targetId,
      ip,
      details,
    });
  }
}

function positive(amount: string, path: string): bigint {
  const minor = parseAmount(amount, path);
  if (minor <= 0n)
    throw AppError.validation([
      { path, code: 'too_small', message: 'Amount must be greater than zero.' },
    ]);
  return minor;
}

/** A supplier payment needs an active supplier and, if named, an order of that supplier. */
export async function assertPayable(
  tx: Transaction,
  supplierId: string,
  purchaseOrderId: string | null,
) {
  const [supplier] = await tx
    .select({ status: suppliers.status })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId));
  if (!supplier) throw AppError.notFound('Supplier not found.');
  if (supplier.status !== 'active')
    throw new AppError(409, 'SUPPLIER_INACTIVE', 'This supplier is inactive.');
  if (!purchaseOrderId) return;
  const [order] = await tx
    .select({ supplierId: purchaseOrders.supplierId, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, purchaseOrderId));
  if (!order || order.supplierId !== supplierId)
    throw AppError.validation([
      {
        path: 'purchaseOrderId',
        code: 'invalid',
        message: 'Choose a purchase order of this supplier.',
      },
    ]);
  if (order.status === 'draft' || order.status === 'cancelled')
    throw new AppError(409, 'INVALID_STATE', 'This purchase order cannot be paid.');
}

/** SQL filter for the branches where the actor holds a branch-scoped permission. */
export function branchScope(
  actor: MerchantActor,
  permission: PermissionKey,
  branchId: string | undefined,
  column: SQL,
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
