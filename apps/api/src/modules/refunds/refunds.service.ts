import type {
  Refund,
  RefundActivity,
  RefundPreview,
  RefundReceipt,
  RefundableSale,
  Sale,
  createRefundSchema,
  exchangeSchema,
  refundActivityQuerySchema,
  refundListQuerySchema,
  refundPreviewRequestSchema,
  voidSaleSchema,
} from '@arabat/contracts';
import { Money, divideHalfUp, formatQuantity, parseQuantity } from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, asc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { addDays, merchantTimezone, todayIn, withinLocalDays } from '../../kernel/time/period.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { type Entry, postEntries, registerAccount } from '../payments/cash-ledger.js';
import { parseAmount } from '../payments/payments.service.js';
import { ShiftsService } from '../registers/shifts.service.js';
import { shifts } from '../registers/registers.schema.js';
import { SalesService } from '../sales/sales.service.js';
import { refundLines, refundPayments, refunds } from './refunds.schema.js';

type CreateInput = z.output<typeof createRefundSchema>;
type VoidInput = z.output<typeof voidSaleSchema>;
type ExchangeInput = z.output<typeof exchangeSchema>;
type ListQuery = z.output<typeof refundListQuerySchema>;
type ActivityQuery = z.output<typeof refundActivityQuerySchema>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
/** Refund statuses that hold (reserve) quantities and amounts of the sale. */
const ACTIVE = sql`('pending_approval', 'processing', 'completed')`;

interface SaleState {
  id: string;
  branchId: string;
  shiftId: string;
  /** Cashier who rang the sale up (own-sale refunds wait for a second person, BR-180). */
  userId: string | null;
  customerId: string | null;
  receiptNumber: string;
  createdAt: Date;
  totalMinor: bigint;
  lines: {
    position: number;
    variantId: string;
    nameEn: string | null;
    nameAr: string | null;
    variantNameEn: string | null;
    variantNameAr: string | null;
    sku: string | null;
    soldMilli: bigint;
    netMinor: bigint;
    unitCostMinor: bigint | null;
    trackInventory: boolean;
    refundedMilli: bigint;
    refundedMinor: bigint;
  }[];
  payments: {
    id: string;
    kind: string;
    methodId: string | null;
    nameEn: string | null;
    nameAr: string | null;
    amountMinor: bigint;
    refundedMinor: bigint;
    verification: string;
    financialAccountId: string | null;
    /** Exchange credit: the refund that funded it (traced back to its tenders, BR-180). */
    refundId: string | null;
    feeMinor: bigint;
  }[];
  activeRefunds: number;
}

/** A pay-back row to write: the tender it goes back to and where the money leaves. */
interface Payout {
  payment: SaleState['payments'][number];
  amountMinor: bigint;
  reference: string | null;
  /** Set when exchange credit was traced back to an original tender. */
  via?: {
    kind: string;
    methodId: string | null;
    nameEn: string | null;
    nameAr: string | null;
    financialAccountId: string | null;
    verification: string;
  };
}

interface Computed {
  lines: {
    position: number;
    variantId: string;
    quantityMilli: bigint;
    amountMinor: bigint;
    restock: boolean;
    unitCostMinor: bigint | null;
    trackInventory: boolean;
  }[];
  totalMinor: bigint;
}

/**
 * Returns, refunds, voids and exchanges (Prompt 11). A refund is a new record linked to
 * the original sale, which is never changed. Per sale, refunds are serialized with a
 * transaction-scoped advisory lock; refundable quantities and amounts include pending
 * requests, so no combination of requests can exceed the sale. Line amounts are computed
 * cumulatively — round(net × refunded-so-far / sold) — so partial refunds of every unit
 * add up to the line's net amount exactly.
 */
@Injectable()
export class RefundsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedgerService,
    private readonly shiftsService: ShiftsService,
    private readonly sales: SalesService,
  ) {}

  // ------------------------------------------------------------ state
  private async lockSale(tx: Transaction, saleId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${saleId}, 0))`);
  }

  private async saleState(tx: Transaction, saleId: string): Promise<SaleState> {
    const [s] = (await tx.execute(sql`select * from sales where id = ${saleId}`)).rows as Record<
      string,
      unknown
    >[];
    if (!s) throw AppError.notFound('Sale not found.');
    const lines = (
      await tx.execute(sql`
        select l.*, l.quantity::text as qty,
               coalesce((select sum(rl.quantity) from refund_lines rl join refunds r on r.id = rl.refund_id
                         where r.sale_id = l.sale_id and rl.sale_position = l.position and r.status in ${ACTIVE}), 0)::text as refunded_qty,
               coalesce((select sum(rl.amount_minor) from refund_lines rl join refunds r on r.id = rl.refund_id
                         where r.sale_id = l.sale_id and rl.sale_position = l.position and r.status in ${ACTIVE}), 0)::text as refunded_amount
        from sale_lines l where l.sale_id = ${saleId} order by l.position`)
    ).rows as Record<string, unknown>[];
    const pays = (
      await tx.execute(sql`
        select p.*, coalesce((select sum(rp.amount_minor) from refund_payments rp join refunds r on r.id = rp.refund_id
                              where rp.original_payment_id = p.id and r.status in ${ACTIVE}), 0)::text as refunded
        from payments p where p.sale_id = ${saleId} and p.status = 'succeeded' order by p.created_at, p.id`)
    ).rows as Record<string, unknown>[];
    const [count] = (
      await tx.execute(
        sql`select count(*)::int as n from refunds where sale_id = ${saleId} and status in ${ACTIVE}`,
      )
    ).rows as { n: number }[];
    return {
      id: saleId,
      branchId: s['branch_id'] as string,
      shiftId: s['shift_id'] as string,
      userId: (s['user_id'] as string | null) ?? null,
      customerId: (s['customer_id'] as string | null) ?? null,
      receiptNumber: s['receipt_number'] as string,
      createdAt: new Date(s['created_at'] as string),
      totalMinor: BigInt(s['total_minor'] as string),
      lines: lines.map((l) => ({
        position: l['position'] as number,
        variantId: l['variant_id'] as string,
        nameEn: (l['name_en'] as string | null) ?? null,
        nameAr: (l['name_ar'] as string | null) ?? null,
        variantNameEn: (l['variant_name_en'] as string | null) ?? null,
        variantNameAr: (l['variant_name_ar'] as string | null) ?? null,
        sku: (l['sku'] as string | null) ?? null,
        soldMilli: parseQuantity(l['qty'] as string),
        netMinor: BigInt(l['net_minor'] as string),
        unitCostMinor:
          l['unit_cost_minor'] === null ? null : BigInt(l['unit_cost_minor'] as string),
        trackInventory: l['track_inventory'] as boolean,
        refundedMilli: parseQuantity(l['refunded_qty'] as string),
        refundedMinor: BigInt(l['refunded_amount'] as string),
      })),
      payments: pays.map((p) => ({
        id: p['id'] as string,
        kind: p['method_kind'] as string,
        methodId: (p['payment_method_id'] as string | null) ?? null,
        nameEn: (p['method_name_en'] as string | null) ?? null,
        nameAr: (p['method_name_ar'] as string | null) ?? null,
        amountMinor: BigInt(p['amount_minor'] as string),
        refundedMinor: BigInt(p['refunded'] as string),
        verification: p['verification'] as string,
        financialAccountId: (p['financial_account_id'] as string | null) ?? null,
        refundId: (p['refund_id'] as string | null) ?? null,
        feeMinor: BigInt((p['fee_minor'] as string | null) ?? '0'),
      })),
      activeRefunds: count?.n ?? 0,
    };
  }

  /**
   * Exchange credit paid back goes to the tenders of the sale the credit came from, pro rata,
   * never to cash by default (BR-180, FND-504). Nested credit is followed up to three steps;
   * whatever cannot be traced is paid in cash.
   */
  private async creditOrigins(
    tx: Transaction,
    refundId: string | null,
    amountMinor: bigint,
    depth = 0,
  ): Promise<NonNullable<Payout['via']>[] & { amountMinor: bigint }[]> {
    type Via = NonNullable<Payout['via']> & { amountMinor: bigint };
    const cash = async (): Promise<Via[]> => {
      const [m] = (
        await tx.execute(sql`select id, name_en, name_ar from payment_methods where kind = 'cash'`)
      ).rows as Record<string, string | null>[];
      return [
        {
          kind: 'cash',
          methodId: m?.['id'] ?? null,
          nameEn: m?.['name_en'] ?? 'Cash',
          nameAr: m?.['name_ar'] ?? null,
          financialAccountId: null,
          verification: 'manual',
          amountMinor,
        },
      ];
    };
    if (!refundId || depth >= 3) return cash();
    const origins = (
      await tx.execute(sql`
        select p.id, p.method_kind, p.payment_method_id, p.method_name_en, p.method_name_ar,
               p.amount_minor::text as amount, p.financial_account_id, p.verification, p.refund_id
        from payments p join refunds r on r.id = ${refundId}
        where p.sale_id = r.sale_id and p.status = 'succeeded' order by p.created_at, p.id`)
    ).rows as Record<string, unknown>[];
    if (origins.length === 0) return cash();
    const shares = Money.ofMinor(amountMinor, CURRENCY)
      .allocate(origins.map((o) => BigInt(o['amount'] as string)))
      .map((m) => m.minor);
    const result: Via[] = [];
    for (const [i, o] of origins.entries()) {
      if (shares[i]! === 0n) continue;
      if (o['method_kind'] === 'exchange') {
        result.push(
          ...(await this.creditOrigins(tx, o['refund_id'] as string, shares[i]!, depth + 1)),
        );
        continue;
      }
      result.push({
        kind: o['method_kind'] as string,
        methodId: (o['payment_method_id'] as string | null) ?? null,
        nameEn: (o['method_name_en'] as string | null) ?? null,
        nameAr: (o['method_name_ar'] as string | null) ?? null,
        financialAccountId: (o['financial_account_id'] as string | null) ?? null,
        verification: o['verification'] as string,
        amountMinor: shares[i]!,
      });
    }
    return result;
  }

  private compute(
    state: SaleState,
    input: { position: number; quantity: string; restock?: boolean }[],
    reason?: string,
  ): Computed {
    // Damaged and defective goods stay out of sellable stock unless the cashier says otherwise (BR-175).
    const restockDefault = !(reason === 'damaged' || reason === 'defective');
    const lines = input.map((l, i) => {
      const line = state.lines.find((x) => x.position === l.position);
      if (!line)
        throw AppError.validation([
          { path: `lines.${i}.position`, code: 'not_found', message: 'Item not on the sale.' },
        ]);
      const quantityMilli = parseQuantity(l.quantity);
      if (quantityMilli <= 0n)
        throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive.', [
          { path: `lines.${i}.quantity`, code: 'too_small', message: 'Quantity must be positive.' },
        ]);
      const refundable = line.soldMilli - line.refundedMilli;
      if (quantityMilli > refundable)
        throw new AppError(
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
      // Cumulative rounding: all partial refunds of a line add up to its net amount exactly.
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
    return { lines, totalMinor: lines.reduce((s, l) => s + l.amountMinor, 0n) };
  }

  /** Suggested pay-back: proportional to what each original payment can still refund. */
  private suggest(state: SaleState, totalMinor: bigint) {
    const open = state.payments.filter((p) => p.amountMinor - p.refundedMinor > 0n);
    if (totalMinor === 0n || open.length === 0) return [];
    const shares = Money.ofMinor(totalMinor, CURRENCY)
      .allocate(open.map((p) => p.amountMinor - p.refundedMinor))
      .map((m) => m.minor);
    return open
      .map((p, i) => ({ payment: p, amountMinor: shares[i]!, reference: null as string | null }))
      .filter((a) => a.amountMinor > 0n);
  }

  private allocation(state: SaleState, totalMinor: bigint, custom: CreateInput['allocation']) {
    if (!custom) return this.suggest(state, totalMinor);
    let sum = 0n;
    const result = custom.map((a, i) => {
      const payment = state.payments.find((p) => p.id === a.paymentId);
      if (!payment)
        throw new AppError(400, 'REFUND_ALLOCATION_INVALID', 'Unknown payment.', [
          { path: `allocation.${i}`, code: 'not_found', message: 'Not a payment of this sale.' },
        ]);
      const amountMinor = parseAmount(a.amount, `allocation.${i}.amount`);
      if (amountMinor <= 0n || amountMinor > payment.amountMinor - payment.refundedMinor)
        throw new AppError(400, 'REFUND_ALLOCATION_INVALID', 'More than this payment can refund.', [
          {
            path: `allocation.${i}.amount`,
            code: 'too_big',
            message: Money.ofMinor(
              payment.amountMinor - payment.refundedMinor,
              CURRENCY,
            ).toDecimalString(),
          },
        ]);
      sum += amountMinor;
      return { payment, amountMinor, reference: a.reference };
    });
    if (new Set(custom.map((a) => a.paymentId)).size !== custom.length)
      throw new AppError(400, 'REFUND_ALLOCATION_INVALID', 'Each payment may appear only once.');
    if (sum !== totalMinor)
      throw new AppError(
        400,
        'REFUND_ALLOCATION_INVALID',
        'The allocation must equal the refund total.',
      );
    return result;
  }

  /**
   * Why a refund must wait for a second person (BR-180): above the limit, outside the window,
   * or a sale the requester rang up themselves. Holding the approve right no longer exempts
   * anyone from their own refunds (FND-502); only the owner may complete such a refund directly,
   * flagged as an owner override (D3).
   */
  private async approvalReasons(
    tx: Transaction,
    actor: MerchantActor,
    state: SaleState,
    totalMinor: bigint,
  ): Promise<string[]> {
    const settings = await this.sales.getSettingsInTx(tx, actor.merchantId);
    const reasons: string[] = [];
    if (totalMinor > settings.refundApprovalLimitMinor) reasons.push('over_limit');
    const ageDays = (Date.now() - state.createdAt.getTime()) / 86_400_000;
    if (ageDays > settings.refundWindowDays) reasons.push('outside_window');
    if (settings.refundOwnSalesNeedApproval && state.userId === actor.userId)
      reasons.push('own_sale');
    return reasons;
  }

  /** Non-cash pay-backs need their terminal / transfer reference when the company says so (BR-181). */
  private async assertReferences(tx: Transaction, merchantId: string, allocation: Payout[]) {
    const settings = await this.sales.getSettingsInTx(tx, merchantId);
    if (!settings.requireTenderReference) return;
    const missing = allocation.findIndex(
      (a) => a.payment.kind !== 'cash' && a.payment.kind !== 'exchange' && !a.reference,
    );
    if (missing >= 0)
      throw new AppError(
        400,
        'REFERENCE_REQUIRED',
        'Enter the reference of each card or transfer pay-back.',
        [{ path: `allocation.${missing}.reference`, code: 'required', message: 'Required.' }],
      );
  }

  // ------------------------------------------------------------ POS reads
  async lookup(actor: MerchantActor, receipt: string): Promise<RefundableSale> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'refunds.create', branchId);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [s] = (
        await tx.execute(
          sql`select id from sales where upper(receipt_number) = upper(${receipt.trim()}) and branch_id = ${branchId}`,
        )
      ).rows as { id: string }[];
      if (!s) throw AppError.notFound('No sale with this receipt number at this branch.');
      return this.refundable(tx, actor, s.id);
    });
  }

  private async refundable(
    tx: Transaction,
    actor: MerchantActor,
    saleId: string,
  ): Promise<RefundableSale> {
    const state = await this.saleState(tx, saleId);
    const settings = await this.sales.getSettingsInTx(tx, actor.merchantId);
    const [cashier] = (
      await tx.execute(
        sql`select coalesce(u.full_name, '') as full_name from sales s left join users u on u.id = s.user_id where s.id = ${saleId}`,
      )
    ).rows as { full_name: string }[];
    const [own] = (
      await tx.execute(
        sql`select id from shifts where membership_id = ${actor.membershipId} and status = 'open'`,
      )
    ).rows as { id: string }[];
    const refundedMinor = state.lines.reduce((t, l) => t + l.refundedMinor, 0n);
    return {
      saleId,
      receiptNumber: state.receiptNumber,
      createdAt: state.createdAt.toISOString(),
      branchId: state.branchId,
      cashierName: cashier?.full_name ?? '',
      total: money(state.totalMinor),
      refunded: money(refundedMinor),
      refundable: money(state.totalMinor - refundedMinor),
      withinWindow:
        (Date.now() - state.createdAt.getTime()) / 86_400_000 <= settings.refundWindowDays,
      voidable: Boolean(own && own.id === state.shiftId && state.activeRefunds === 0),
      lines: state.lines.map((l) => ({
        position: l.position,
        variantId: l.variantId,
        nameEn: l.nameEn,
        nameAr: l.nameAr,
        variantNameEn: l.variantNameEn,
        variantNameAr: l.variantNameAr,
        sku: l.sku,
        soldQuantity: formatQuantity(l.soldMilli),
        refundedQuantity: formatQuantity(l.refundedMilli),
        refundableQuantity: formatQuantity(l.soldMilli - l.refundedMilli),
        net: money(l.netMinor),
        trackInventory: l.trackInventory,
      })),
      payments: state.payments.map((p) => ({
        paymentId: p.id,
        kind: p.kind,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        amount: money(p.amountMinor),
        refunded: money(p.refundedMinor),
        refundable: money(p.amountMinor - p.refundedMinor),
        verification: p.verification as 'manual',
      })),
    };
  }

  async preview(
    actor: MerchantActor,
    input: z.output<typeof refundPreviewRequestSchema>,
  ): Promise<RefundPreview> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'refunds.create', branchId);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const state = await this.saleState(tx, input.saleId);
      if (state.branchId !== branchId) throw AppError.notFound('Sale not found.');
      const computed = this.compute(state, input.lines);
      const reasons = await this.approvalReasons(tx, actor, state, computed.totalMinor);
      const settings = await this.sales.getSettingsInTx(tx, actor.merchantId);
      return {
        lines: computed.lines.map((l) => ({
          position: l.position,
          quantity: formatQuantity(l.quantityMilli),
          amount: money(l.amountMinor),
        })),
        total: money(computed.totalMinor),
        allocation: this.suggest(state, computed.totalMinor).map((a) => ({
          paymentId: a.payment.id,
          kind: a.payment.kind,
          amount: money(a.amountMinor),
          referenceRequired:
            settings.requireTenderReference &&
            a.payment.kind !== 'cash' &&
            a.payment.kind !== 'exchange',
        })),
        // The owner completes directly (flagged as an override); everyone else waits.
        approvalRequired: reasons.length > 0 && !actor.access.isOwner,
        approvalReasons: reasons,
      };
    });
  }

  // ------------------------------------------------------------ writes
  private posBranch(actor: MerchantActor): string {
    if (!actor.boundBranchId) throw AppError.forbidden();
    return actor.boundBranchId;
  }

  private hash(input: object): string {
    return createHash('sha256')
      .update(JSON.stringify({ ...input, idempotencyKey: undefined }))
      .digest('hex');
  }

  private async replay(actor: MerchantActor, key: string, hash: string): Promise<Refund | null> {
    const [row] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      tx
        .select({ id: refunds.id, hash: refunds.requestHash })
        .from(refunds)
        .where(eq(refunds.idempotencyKey, key)),
    );
    if (!row) return null;
    if (row.hash !== hash)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used for a different refund.',
      );
    return this.get(actor, row.id, 'pos');
  }

  async create(actor: MerchantActor, input: CreateInput, ip: string): Promise<Refund> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'refunds.create', branchId);
    const hash = this.hash(input);
    const replay = await this.replay(actor, input.idempotencyKey, hash);
    if (replay) return replay;
    const refundId = newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const shift = await this.shiftsService.lockOwnShift(tx, actor);
        await this.lockSale(tx, input.saleId);
        const state = await this.saleState(tx, input.saleId);
        if (state.branchId !== branchId) throw AppError.notFound('Sale not found.');
        const computed = this.compute(state, input.lines, input.reason);
        const allocation = this.allocation(state, computed.totalMinor, input.allocation);
        await this.assertReferences(tx, actor.merchantId, allocation);
        const reasons = await this.approvalReasons(tx, actor, state, computed.totalMinor);
        const ownerOverride = reasons.length > 0 && actor.access.isOwner;
        const waits = reasons.length > 0 && !ownerOverride;
        await this.insertRefund(tx, actor, shift, state, {
          refundId,
          kind: 'refund',
          status: waits ? 'pending_approval' : 'processing',
          reason: input.reason,
          note: input.note,
          computed,
          approvalReasons: reasons,
          ownerOverride,
          customerContact: input.customerContact,
          idempotency: { key: input.idempotencyKey, hash },
          exchange: null,
        });
        // Payment allocation is stored with the request so an approver pays out exactly this.
        await this.insertPayments(tx, actor, refundId, shift.id, allocation, 'planned');
        if (!waits) await this.execute(tx, actor, refundId, ip);
        await this.record(
          tx,
          actor,
          waits ? 'refund.requested' : 'refund.completed',
          refundId,
          ip,
          {
            saleId: state.id,
            total: Money.ofMinor(computed.totalMinor, CURRENCY).toDecimalString(),
            approvalReasons: reasons,
            ownerOverride,
            customerContact: input.customerContact,
          },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'refunds_idempotency_key')) {
        const again = await this.replay(actor, input.idempotencyKey, hash);
        if (again) return again;
      }
      throw error;
    }
    return this.get(actor, refundId, 'pos');
  }

  /** Cancels a completed sale of the cashier's own open shift (full refund, restock all). */
  async voidSale(
    actor: MerchantActor,
    saleId: string,
    input: VoidInput,
    ip: string,
  ): Promise<Refund> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'sales.void', branchId);
    const hash = this.hash({ ...input, saleId });
    const replay = await this.replay(actor, input.idempotencyKey, hash);
    if (replay) return replay;
    const refundId = newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const shift = await this.shiftsService.lockOwnShift(tx, actor);
        await this.lockSale(tx, saleId);
        const state = await this.saleState(tx, saleId);
        if (state.branchId !== branchId) throw AppError.notFound('Sale not found.');
        if (state.shiftId !== shift.id || state.activeRefunds > 0)
          throw new AppError(
            409,
            'NOT_VOIDABLE',
            'Only sales of your open shift without refunds can be cancelled.',
          );
        const computed = this.compute(
          state,
          state.lines.map((l) => ({
            position: l.position,
            quantity: formatQuantity(l.soldMilli),
            restock: true,
          })),
        );
        await this.insertRefund(tx, actor, shift, state, {
          refundId,
          kind: 'void',
          status: 'processing',
          reason: input.reason,
          note: input.note,
          computed,
          approvalReasons: [],
          ownerOverride: false,
          customerContact: null,
          idempotency: { key: input.idempotencyKey, hash },
          exchange: null,
        });
        await this.insertPayments(
          tx,
          actor,
          refundId,
          shift.id,
          this.suggest(state, computed.totalMinor),
          'planned',
        );
        await this.execute(tx, actor, refundId, ip);
        await this.record(tx, actor, 'sale.voided', refundId, ip, {
          saleId,
          receiptNumber: state.receiptNumber,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'refunds_idempotency_key')) {
        const again = await this.replay(actor, input.idempotencyKey, hash);
        if (again) return again;
      }
      throw error;
    }
    return this.get(actor, refundId, 'pos');
  }

  /**
   * Exchange: returns items and sells new ones in one transaction. The refund credit pays
   * for the new sale first; any amount still due is paid normally, any credit left over is
   * paid back to the original payments.
   */
  async exchange(
    actor: MerchantActor,
    input: ExchangeInput,
    ip: string,
  ): Promise<{ refund: Refund; sale: Sale }> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'refunds.create', branchId);
    assertCan(actor, 'sales.create', branchId);
    const hash = this.hash(input);
    const replay = await this.replay(actor, input.idempotencyKey, hash);
    if (replay)
      return {
        refund: replay,
        sale: await this.sales.getSale(actor, replay.exchangeSaleId!, 'pos'),
      };
    const refundId = newId();
    const saleId = newId();
    const { lines, orderDiscount } = this.sales.parseCart(actor, input);
    const expectedTotalMinor = parseAmount(input.expectedTotal, 'expectedTotal');
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const shift = await this.shiftsService.lockOwnShift(tx, actor);
        await this.lockSale(tx, input.saleId);
        const state = await this.saleState(tx, input.saleId);
        if (state.branchId !== branchId) throw AppError.notFound('Sale not found.');
        const computed = this.compute(state, input.returnLines, input.reason);
        const reasons = await this.approvalReasons(tx, actor, state, computed.totalMinor);
        const ownerOverride = reasons.length > 0 && actor.access.isOwner;
        if (reasons.length && !ownerOverride)
          throw new AppError(
            403,
            'APPROVAL_REQUIRED',
            'This exchange needs a supervisor.',
            reasons.map((r) => ({ path: 'returnLines', code: r, message: r })),
          );
        const creditApplied =
          computed.totalMinor < expectedTotalMinor ? computed.totalMinor : expectedTotalMinor;
        await this.insertRefund(tx, actor, shift, state, {
          refundId,
          kind: 'exchange',
          status: 'processing',
          reason: input.reason,
          note: input.note,
          computed,
          approvalReasons: reasons,
          ownerOverride,
          customerContact: null,
          idempotency: { key: input.idempotencyKey, hash },
          exchange: { saleId, creditMinor: creditApplied },
        });
        // Credit beyond the new total goes back to the original payments.
        const leftover = computed.totalMinor - creditApplied;
        await this.insertPayments(
          tx,
          actor,
          refundId,
          shift.id,
          this.suggest(state, leftover),
          'planned',
        );
        if (creditApplied > 0n)
          await tx.insert(refundPayments).values({
            id: newId(),
            merchantId: actor.merchantId,
            refundId,
            originalPaymentId: null,
            paymentMethodId: null,
            methodKind: 'exchange',
            methodNameEn: 'Exchange credit',
            methodNameAr: 'رصيد استبدال',
            amountMinor: creditApplied,
            shiftId: shift.id,
            status: 'succeeded',
            verification: 'internal',
          });
        await this.sales.completeSaleInTx(tx, actor, shift, {
          saleId,
          lines,
          orderDiscount,
          orderDiscountInput: input.orderDiscount,
          payments: input.payments,
          expectedTotalMinor,
          orderId: null,
          idempotency: null,
          exchange: { refundId, creditMinor: creditApplied },
          customer: { id: state.customerId, inherited: true },
          ip,
        });
        await this.execute(tx, actor, refundId, ip);
        await this.record(tx, actor, 'refund.exchange', refundId, ip, {
          saleId: state.id,
          newSaleId: saleId,
          credit: Money.ofMinor(computed.totalMinor, CURRENCY).toDecimalString(),
          approvalReasons: reasons,
          ownerOverride,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'refunds_idempotency_key')) {
        const again = await this.replay(actor, input.idempotencyKey, hash);
        if (again)
          return {
            refund: again,
            sale: await this.sales.getSale(actor, again.exchangeSaleId!, 'pos'),
          };
      }
      throw error;
    }
    return {
      refund: await this.get(actor, refundId, 'pos'),
      sale: await this.sales.getSale(actor, saleId, 'pos'),
    };
  }

  async approve(
    actor: MerchantActor,
    refundId: string,
    note: string | null,
    ip: string,
  ): Promise<Refund> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const refund = await this.lockPending(tx, refundId);
      assertCan(actor, 'refunds.approve', refund.branchId);
      if (refund.userId === actor.userId)
        throw new AppError(403, 'SELF_APPROVAL', 'You cannot approve your own refund request.');
      await this.lockSale(tx, refund.saleId);
      // The request outlives the requester's shift (BR-180, FND-509): when that shift is
      // closed and cash is owed, the approver pays it from their own open shift at the branch.
      const paidFrom = await this.repointShift(tx, actor, refund);
      await tx
        .update(refunds)
        .set({
          status: 'processing',
          decidedByUserId: actor.userId,
          decidedAt: sql`now()`,
          decisionNote: note,
          version: sql`${refunds.version} + 1`,
        })
        .where(eq(refunds.id, refundId));
      await this.execute(tx, actor, refundId, ip);
      await this.record(tx, actor, 'refund.approved', refundId, ip, {
        requestedBy: refund.userId,
        ...(paidFrom ? { paidFromShiftId: paidFrom } : {}),
      });
    });
    return this.get(actor, refundId, actor.interface);
  }

  async reject(
    actor: MerchantActor,
    refundId: string,
    note: string | null,
    ip: string,
  ): Promise<Refund> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const refund = await this.lockPending(tx, refundId);
      assertCan(actor, 'refunds.approve', refund.branchId);
      await tx
        .update(refunds)
        .set({
          status: 'rejected',
          decidedByUserId: actor.userId,
          decidedAt: sql`now()`,
          decisionNote: note,
          version: sql`${refunds.version} + 1`,
        })
        .where(eq(refunds.id, refundId));
      await this.record(tx, actor, 'refund.rejected', refundId, ip, { note });
    });
    return this.get(actor, refundId, actor.interface);
  }

  /** The requester withdraws a pending request (unfinalized: nothing was paid or restocked). */
  async cancel(actor: MerchantActor, refundId: string, ip: string): Promise<Refund> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const refund = await this.lockPending(tx, refundId);
      if (refund.userId !== actor.userId && !can(actor.access, 'refunds.approve', refund.branchId))
        throw AppError.forbidden();
      await tx
        .update(refunds)
        .set({
          status: 'cancelled',
          decidedByUserId: actor.userId,
          decidedAt: sql`now()`,
          version: sql`${refunds.version} + 1`,
        })
        .where(eq(refunds.id, refundId));
      await this.record(tx, actor, 'refund.cancelled', refundId, ip);
    });
    return this.get(actor, refundId, actor.interface);
  }

  /** Moves a pending cash refund to the approver's open shift when the requester's shift closed. */
  private async repointShift(
    tx: Transaction,
    actor: MerchantActor,
    refund: typeof refunds.$inferSelect,
  ): Promise<string | null> {
    const [cash] = (
      await tx.execute(
        sql`select count(*)::int as n from refund_payments where refund_id = ${refund.id} and method_kind = 'cash' and status = 'pending'`,
      )
    ).rows as { n: number }[];
    if ((cash?.n ?? 0) === 0) return null;
    const [requesterShift] = await tx
      .select({ status: shifts.status })
      .from(shifts)
      .where(eq(shifts.id, refund.shiftId));
    if (requesterShift?.status === 'open') return null;
    if (actor.boundBranchId !== refund.branchId)
      throw new AppError(
        409,
        'SHIFT_REQUIRED',
        'The requesting cashier’s shift is closed: approve this refund from an open shift at the branch so the cash can be paid out.',
      );
    const own = await this.shiftsService.lockOwnShift(tx, actor);
    await tx
      .update(refunds)
      .set({ shiftId: own.id, registerId: own.registerId })
      .where(eq(refunds.id, refund.id));
    await tx
      .update(refundPayments)
      .set({ shiftId: own.id })
      .where(eq(refundPayments.refundId, refund.id));
    return own.id;
  }

  private async lockPending(tx: Transaction, refundId: string) {
    const [row] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
    if (!row) throw AppError.notFound();
    if (row.status !== 'pending_approval')
      throw new AppError(
        409,
        'REFUND_NOT_PENDING',
        'This refund is no longer waiting for a decision.',
      );
    return row;
  }

  private async insertRefund(
    tx: Transaction,
    actor: MerchantActor,
    shift: { id: string; registerId: string },
    state: SaleState,
    r: {
      refundId: string;
      kind: 'refund' | 'void' | 'exchange';
      status: 'pending_approval' | 'processing';
      reason: string;
      note: string | null;
      computed: Computed;
      approvalReasons: string[];
      ownerOverride: boolean;
      customerContact: string | null;
      idempotency: { key: string; hash: string };
      exchange: { saleId: string; creditMinor: bigint } | null;
    },
  ) {
    const [n] = (
      await tx.execute(sql`select count(*)::int as n from refunds where sale_id = ${state.id}`)
    ).rows as { n: number }[];
    await tx.insert(refunds).values({
      id: r.refundId,
      merchantId: actor.merchantId,
      saleId: state.id,
      branchId: state.branchId,
      registerId: shift.registerId,
      shiftId: shift.id,
      membershipId: actor.membershipId,
      userId: actor.userId,
      refundNumber: `${state.receiptNumber}-R${(n?.n ?? 0) + 1}`,
      kind: r.kind,
      status: r.status,
      reason: r.reason,
      note: r.note,
      totalMinor: r.computed.totalMinor,
      exchangeCreditMinor: r.exchange?.creditMinor ?? 0n,
      exchangeSaleId: r.exchange?.saleId ?? null,
      approvalReasons: r.approvalReasons,
      ownerOverride: r.ownerOverride,
      customerContact: r.customerContact,
      idempotencyKey: r.idempotency.key,
      requestHash: r.idempotency.hash,
    });
    await tx.insert(refundLines).values(
      r.computed.lines.map((l) => ({
        merchantId: actor.merchantId,
        refundId: r.refundId,
        salePosition: l.position,
        variantId: l.variantId,
        quantity: formatQuantity(l.quantityMilli),
        amountMinor: l.amountMinor,
        restock: l.restock && l.trackInventory,
        unitCostMinor: l.unitCostMinor,
      })),
    );
  }

  /** Planned payouts: rows are inserted as `pending` and settled by `execute`. */
  private async insertPayments(
    tx: Transaction,
    actor: MerchantActor,
    refundId: string,
    shiftId: string,
    allocation: Payout[],
    _state: 'planned',
  ) {
    if (allocation.length === 0) return;
    // Exchange credit goes back to the tenders it came from, pro rata (BR-180, FND-504).
    const rows: Payout[] = [];
    for (const a of allocation) {
      if (a.payment.kind !== 'exchange') {
        rows.push(a);
        continue;
      }
      for (const via of await this.creditOrigins(tx, a.payment.refundId, a.amountMinor))
        rows.push({ payment: a.payment, amountMinor: via.amountMinor, reference: null, via });
    }
    await tx.insert(refundPayments).values(
      rows.map((a) => ({
        id: newId(),
        merchantId: actor.merchantId,
        refundId,
        originalPaymentId: a.payment.id,
        paymentMethodId: a.via ? a.via.methodId : a.payment.methodId,
        methodKind: a.via ? a.via.kind : a.payment.kind,
        methodNameEn: a.via ? a.via.nameEn : a.payment.nameEn,
        methodNameAr: a.via ? a.via.nameAr : a.payment.nameAr,
        amountMinor: a.amountMinor,
        shiftId,
        status: 'pending',
        verification:
          (a.via ? a.via.verification : a.payment.verification) === 'gateway'
            ? 'gateway'
            : 'manual',
        reference: a.reference,
        financialAccountId: a.via ? a.via.financialAccountId : a.payment.financialAccountId,
      })),
    );
  }

  /**
   * Pays out and restocks a refund. Manual tenders (cash from the requester's drawer, card
   * terminal, transfer) are settled at once; a refund to a gateway payment stays `pending`
   * and the refund stays `processing` until the gateway confirms it (never "completed"
   * on assumption).
   */
  private async execute(tx: Transaction, actor: MerchantActor, refundId: string, _ip: string) {
    const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId));
    const pays = await tx
      .select()
      .from(refundPayments)
      .where(eq(refundPayments.refundId, refundId));
    const cashMinor = pays
      .filter((p) => p.methodKind === 'cash' && p.status === 'pending')
      .reduce((s, p) => s + p.amountMinor, 0n);
    if (cashMinor > 0n) {
      const [shift] = await tx
        .select()
        .from(shifts)
        .where(eq(shifts.id, refund!.shiftId))
        .for('update');
      if (!shift || shift.status !== 'open')
        throw new AppError(
          409,
          'SHIFT_REQUIRED',
          'The cash refund needs the requesting cashier’s open shift.',
        );
      if (cashMinor > (await this.shiftsService.drawerCash(tx, shift)))
        throw new AppError(
          409,
          'INSUFFICIENT_CASH',
          'The drawer does not hold enough cash for this refund.',
        );
    }
    let waiting = false;
    for (const p of pays.filter((x) => x.status === 'pending')) {
      if (p.verification === 'gateway') {
        waiting = true;
        continue;
      }
      const entry: Entry = {
        merchantId: actor.merchantId,
        accountId: '',
        amountMinor: -p.amountMinor,
        entryType: 'refund',
        sourceType: 'refund_payment',
        sourceId: p.id,
        description: refund!.refundNumber,
        createdByUserId: actor.userId,
      };
      let feeReversedMinor = 0n;
      if (p.methodKind === 'cash') {
        // Cash leaves the drawer of the shift paying it out, whichever register took the
        // sale (ADR-0090).
        const [payer] = await tx
          .select({ registerId: shifts.registerId })
          .from(shifts)
          .where(eq(shifts.id, refund!.shiftId));
        const drawer = await registerAccount(tx, payer!.registerId);
        await postEntries(tx, [{ ...entry, accountId: drawer.id, shiftId: refund!.shiftId }]);
      } else {
        // Non-cash money always leaves a settlement account (BR-181, FND-506).
        const [orig] = p.originalPaymentId
          ? ((
              await tx.execute(sql`
                select p.financial_account_id, p.amount_minor::text as amount, p.fee_minor::text as fee,
                       p.method_kind, m.refund_fee_policy
                from payments p left join payment_methods m on m.id = p.payment_method_id
                where p.id = ${p.originalPaymentId}`)
            ).rows as Record<string, string | null>[])
          : [];
        const accountId = p.financialAccountId ?? orig?.['financial_account_id'] ?? null;
        if (!accountId)
          throw new AppError(
            409,
            'SETTLEMENT_ACCOUNT_REQUIRED',
            'This tender has no settlement account to pay back from.',
          );
        const entries = [{ ...entry, accountId }];
        // The provider's fee comes back pro rata when the method says so (D6); traced exchange
        // credit carries no fee of its own.
        if (
          orig &&
          orig['method_kind'] === p.methodKind &&
          orig['refund_fee_policy'] === 'reverse' &&
          BigInt(orig['fee'] ?? '0') > 0n
        ) {
          feeReversedMinor = divideHalfUp(
            BigInt(orig['fee']!) * p.amountMinor,
            BigInt(orig['amount']!),
          );
          if (feeReversedMinor > 0n)
            entries.push({ ...entry, accountId, entryType: 'fee', amountMinor: feeReversedMinor });
        }
        await postEntries(tx, entries);
      }
      await tx
        .update(refundPayments)
        .set({ status: 'succeeded', feeReversedMinor })
        .where(eq(refundPayments.id, p.id));
    }
    const lines = await tx.select().from(refundLines).where(eq(refundLines.refundId, refundId));
    // Returned goods kept out of stock get a custody record until they are disposed of (BR-175).
    await tx.execute(sql`
      insert into damaged_returns (id, merchant_id, refund_id, position, branch_id, variant_id, quantity, unit_cost_minor, reason)
      select gen_random_uuid(), rl.merchant_id, rl.refund_id, rl.sale_position, ${refund!.branchId}, rl.variant_id,
             rl.quantity, rl.unit_cost_minor, ${refund!.reason}
      from refund_lines rl join product_variants v on v.id = rl.variant_id join products p on p.id = v.product_id
      where rl.refund_id = ${refundId} and not rl.restock and p.track_inventory
      on conflict do nothing`);
    const restock = lines.filter((l) => l.restock);
    if (restock.length > 0) {
      // Stock comes back at the cost it left with; the average cost is updated accordingly.
      await this.ledger.apply(
        tx,
        {
          merchantId: actor.merchantId,
          branchId: refund!.branchId,
          movementType: 'refund',
          reason: refund!.kind,
          sourceType: 'refund',
          sourceId: refundId,
          userId: actor.userId,
        },
        restock.map((l) => ({
          variantId: l.variantId,
          mode: 'delta' as const,
          quantityMilli: parseQuantity(l.quantity),
          unitCostMinor: l.unitCostMinor,
        })),
      );
    }
    await tx
      .update(refunds)
      .set({
        status: waiting ? 'processing' : 'completed',
        completedAt: waiting ? null : sql`now()`,
        version: sql`${refunds.version} + 1`,
      })
      .where(eq(refunds.id, refundId));
  }

  // ------------------------------------------------------------ reads
  async get(actor: MerchantActor, id: string, view: 'pos' | 'manager'): Promise<Refund> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [r] = (
        await tx.execute(sql`
          select r.*, s.receipt_number, u.full_name as requested_by, d.full_name as decided_by
          from refunds r join sales s on s.id = r.sale_id join users u on u.id = r.user_id
          left join users d on d.id = r.decided_by_user_id where r.id = ${id}`)
      ).rows as Record<string, unknown>[];
      if (!r) throw AppError.notFound();
      if (view === 'pos') {
        if (r['branch_id'] !== actor.boundBranchId) throw AppError.notFound();
      } else assertCan(actor, 'sales.read', r['branch_id'] as string);
      const ls = (
        await tx.execute(sql`
          select rl.*, rl.quantity::text as qty, sl.name_en, sl.name_ar from refund_lines rl
          join sale_lines sl on sl.sale_id = ${r['sale_id'] as string} and sl.position = rl.sale_position
          where rl.refund_id = ${id} order by rl.sale_position`)
      ).rows as Record<string, unknown>[];
      const ps = await tx
        .select()
        .from(refundPayments)
        .where(eq(refundPayments.refundId, id))
        .orderBy(asc(refundPayments.createdAt), asc(refundPayments.id));
      return {
        id,
        refundNumber: r['refund_number'] as string,
        saleId: r['sale_id'] as string,
        receiptNumber: r['receipt_number'] as string,
        branchId: r['branch_id'] as string,
        kind: r['kind'] as Refund['kind'],
        status: r['status'] as Refund['status'],
        reason: r['reason'] as string,
        note: (r['note'] as string | null) ?? null,
        total: money(r['total_minor'] as string),
        exchangeCredit: money(r['exchange_credit_minor'] as string),
        exchangeSaleId: (r['exchange_sale_id'] as string | null) ?? null,
        approvalReasons: (r['approval_reasons'] as string[] | null) ?? [],
        requestedBy: r['requested_by'] as string,
        decidedBy: (r['decided_by'] as string | null) ?? null,
        decisionNote: (r['decision_note'] as string | null) ?? null,
        ownerOverride: Boolean(r['owner_override']),
        customerContact: (r['customer_contact'] as string | null) ?? null,
        createdAt: iso(r['created_at'])!,
        completedAt: iso(r['completed_at']),
        lines: ls.map((l) => ({
          position: l['sale_position'] as number,
          variantId: l['variant_id'] as string,
          nameEn: (l['name_en'] as string | null) ?? null,
          nameAr: (l['name_ar'] as string | null) ?? null,
          quantity: formatQuantity(parseQuantity(l['qty'] as string)),
          amount: money(l['amount_minor'] as string),
          restock: l['restock'] as boolean,
        })),
        payments: ps.map((p) => ({
          id: p.id,
          kind: p.methodKind,
          nameEn: p.methodNameEn,
          nameAr: p.methodNameAr,
          amount: money(p.amountMinor),
          status: p.status as 'succeeded',
          verification: p.verification as 'manual',
          reference: p.reference,
          feeReversed: money(p.feeReversedMinor),
        })),
        version: r['version'] as number,
      };
    });
  }

  async receipt(actor: MerchantActor, id: string): Promise<RefundReceipt> {
    const refund = await this.get(actor, id, actor.interface);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [info] = (
        await tx.execute(sql`
          select m.display_name_en, m.display_name_ar, b.name_en, b.name_ar, b.receipt_footer
          from refunds r join merchants m on m.id = r.merchant_id join branches b on b.id = r.branch_id where r.id = ${id}`)
      ).rows as Record<string, string | null>[];
      return {
        refund,
        merchant: {
          nameEn: info!['display_name_en'] ?? null,
          nameAr: info!['display_name_ar'] ?? null,
        },
        branch: {
          nameEn: info!['name_en'] ?? null,
          nameAr: info!['name_ar'] ?? null,
          receiptFooter: info!['receipt_footer'] ?? null,
        },
        cashierName: refund.requestedBy,
      };
    });
  }

  private scope(actor: MerchantActor, branchId: string | undefined, column: SQL): SQL {
    if (branchId) {
      assertCan(actor, 'sales.read', branchId);
      return sql`${column} = ${branchId}`;
    }
    const s = permissionBranchScope(actor.access, 'sales.read');
    if (s.all) return sql`true`;
    if (s.branchIds.length === 0) throw AppError.forbidden();
    return sql`${column} in (${sql.join(
      s.branchIds.map((b) => sql`${b}`),
      sql`, `,
    )})`;
  }

  private tz(tx: Transaction, merchantId: string) {
    return merchantTimezone(tx, merchantId);
  }

  /**
   * Refund register (BR-184): the period is cut on the refund's business date, its completion
   * time once completed, otherwise its request time, in the merchant's time zone.
   */
  async list(actor: MerchantActor, query: ListQuery) {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const tz = await this.tz(tx, actor.merchantId);
      const c: SQL[] = [this.scope(actor, query.branchId, sql`r.branch_id`)];
      if (query.status) c.push(sql`r.status = ${query.status}`);
      if (query.kind) c.push(sql`r.kind = ${query.kind}`);
      if (query.saleId) c.push(sql`r.sale_id = ${query.saleId}`);
      const businessDate = sql`coalesce(r.completed_at, r.created_at)`;
      c.push(withinLocalDays(tz, businessDate, query.from, query.to));
      const where = sql.join(c, sql` and `);
      const [total] = (
        await tx.execute(sql`select count(*)::int as n,
            count(*) filter (where r.status = 'completed')::int as completed,
            coalesce(sum(r.total_minor) filter (where r.status = 'completed'), 0)::text as amount
          from refunds r where ${where}`)
      ).rows as { n: number; completed: number; amount: string }[];
      const ids = (
        await tx.execute(sql`select r.id from refunds r where ${where}
                             order by ${businessDate} desc, r.id desc
                             limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as { id: string }[];
      const rows = [];
      for (const { id } of ids) {
        const { lines: _l, payments: _p, ...rest } = await this.get(actor, id, 'manager');
        rows.push(rest);
      }
      return {
        refunds: rows,
        total: total?.n ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        totals: {
          count: total?.n ?? 0,
          completedCount: total?.completed ?? 0,
          amount: money(total?.amount ?? '0'),
        },
      };
    });
  }

  /**
   * Unusual refund activity: refund rate per employee against their own sales. The threshold
   * and the default window are company policy (BR-186); dates given win over the window.
   */
  async activity(actor: MerchantActor, query: ActivityQuery): Promise<RefundActivity> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const tz = await this.tz(tx, actor.merchantId);
      const policy = await this.sales.getSettingsInTx(tx, actor.merchantId);
      const to = query.to ?? todayIn(tz);
      const from = query.from ?? (query.to ? to : addDays(to, -(policy.unusualActivityDays - 1)));
      const range = (col: SQL) => withinLocalDays(tz, col, from, to);
      const threshold = policy.unusualRefundRatePercent;
      const rScope = this.scope(actor, query.branchId, sql`r.branch_id`);
      const sScope = this.scope(actor, query.branchId, sql`s.branch_id`);
      const rows = (
        await tx.execute(sql`
          with s as (
            select s.membership_id, count(*)::int as n, sum(s.total_minor) as amount from sales s
            where ${sScope} and ${range(sql`s.created_at`)} group by s.membership_id),
          r as (
            select r.membership_id, count(*) filter (where r.kind <> 'void')::int as refunds,
                   count(*) filter (where r.kind = 'void')::int as voids,
                   coalesce(sum(r.total_minor), 0) as amount,
                   count(*) filter (where 'outside_window' = any(r.approval_reasons))::int as outside,
                   count(*) filter (where r.kind <> 'void'
                     and r.user_id = (select os.user_id from sales os where os.id = r.sale_id))::int as own_sale
            from refunds r where r.status = 'completed' and ${rScope} and ${range(sql`r.completed_at`)}
            group by r.membership_id)
          select m.id as membership_id, u.full_name, coalesce(s.n, 0) as sales, coalesce(s.amount, 0)::text as sales_amount,
                 coalesce(r.refunds, 0) as refunds, coalesce(r.voids, 0) as voids, coalesce(r.amount, 0)::text as refund_amount,
                 coalesce(r.outside, 0) as outside, coalesce(r.own_sale, 0) as own_sale
          from memberships m join users u on u.id = m.user_id
          left join s on s.membership_id = m.id left join r on r.membership_id = m.id
          where s.membership_id is not null or r.membership_id is not null
          order by coalesce(r.amount, 0) desc`)
      ).rows as Record<string, unknown>[];
      // Threshold in hundredths of a percent, exact ("12.5" → 1250).
      const [whole, frac = ''] = threshold.split('.');
      const thresholdBp = BigInt(whole!) * 100n + BigInt((frac + '00').slice(0, 2));
      return {
        flagThresholdPercent: threshold,
        period: { from, to, timezone: tz },
        byEmployee: rows.map((x) => {
          const salesAmount = BigInt(x['sales_amount'] as string);
          const refundAmount = BigInt(x['refund_amount'] as string);
          // Rate in hundredths of a percent, exact.
          const rateBp =
            salesAmount === 0n
              ? refundAmount > 0n
                ? 1000000n
                : 0n
              : divideHalfUp(refundAmount * 10000n, salesAmount);
          const rate = `${rateBp / 100n}.${(rateBp % 100n).toString().padStart(2, '0')}`;
          return {
            membershipId: x['membership_id'] as string,
            employeeName: x['full_name'] as string,
            sales: x['sales'] as number,
            salesAmount: money(salesAmount),
            refunds: x['refunds'] as number,
            voids: x['voids'] as number,
            refundAmount: money(refundAmount),
            refundRate: rate,
            outsideWindow: x['outside'] as number,
            ownSaleRefunds: x['own_sale'] as number,
            flagged: rateBp > thresholdBp || (x['outside'] as number) > 0,
          };
        }),
      };
    });
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    refundId: string,
    ip: string,
    details: Record<string, unknown> = {},
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'refund',
      targetId: refundId,
      ip,
      details,
    });
  }
}
