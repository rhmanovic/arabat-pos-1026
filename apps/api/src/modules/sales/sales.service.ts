import type {
  DiscountInput,
  Receipt,
  Sale,
  SaleSummary,
  SalesSettings,
  SuspendedOrder,
  checkoutSchema,
  saleListQuerySchema,
  suspendOrderSchema,
  updateSalesSettingsSchema,
} from '@arabat/contracts';
import {
  type Discount,
  Money,
  PricingError,
  exceedsDiscountLimit,
  formatQuantity,
  parseQuantity,
  priceCart,
  processingFee,
  type FeeType,
} from '@arabat/money';
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
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { financialAccountEntries } from '../payments/payments.schema.js';
import { parseAmount } from '../payments/payments.service.js';
import { ShiftsService } from '../registers/shifts.service.js';
import {
  orderLines,
  orders,
  payments,
  saleLineModifiers,
  saleLines,
  sales,
  salesSettings,
} from './sales.schema.js';
import { consumptionCosts, stockConsumption } from '../inventory/consumption.js';

type CheckoutInput = z.output<typeof checkoutSchema>;
type SuspendInput = z.output<typeof suspendOrderSchema>;
type CartLine = CheckoutInput['lines'][number];
type ListQuery = z.output<typeof saleListQuerySchema>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => new Date(v as string).toISOString();
const customerOf = (r: Record<string, unknown>) =>
  r['customer_id']
    ? {
        id: r['customer_id'] as string,
        code: r['customer_code'] as string,
        fullName: r['customer_name'] as string,
      }
    : null;

/**
 * Customer for a sale or held order: must exist and be active, and the cashier needs
 * `customers.read` at the branch to pick one (BR-110). `inherited` (exchanges) skips both
 * checks: the new sale belongs to the original sale's customer.
 */
export async function resolveSaleCustomer(
  tx: Transaction,
  actor: MerchantActor,
  branchId: string,
  customerId: string | null,
  inherited = false,
): Promise<string | null> {
  if (!customerId) return null;
  if (!inherited) assertCan(actor, 'customers.read', branchId);
  const [row] = (await tx.execute(sql`select status from customers where id = ${customerId}`))
    .rows as { status: string }[];
  if (!row) throw AppError.notFound('Customer not found.');
  if (!inherited && row.status !== 'active')
    throw new AppError(409, 'CUSTOMER_INACTIVE', 'This customer record is inactive.');
  return customerId;
}

export interface ParsedLine {
  variantId: string;
  quantityMilli: bigint;
  priceOverrideMinor: bigint | null;
  discount: Discount | null;
  input: CartLine;
  /** Restaurant modifiers: their prices are added to the unit price (Prompt 15). */
  modifiers: { id: string; nameEn: string | null; nameAr: string | null; priceMinor: bigint }[];
}

const extraOf = (l: ParsedLine) => l.modifiers.reduce((s, m) => s + m.priceMinor, 0n);

function toDiscount(d: DiscountInput | null, path: string): Discount | null {
  if (!d) return null;
  return d.type === 'percent'
    ? { type: 'percent', percent: d.value }
    : { type: 'amount', amountMinor: parseAmount(d.value, path) };
}

/** "12.50" → "12.5", "10.00" → "10", "10" → "10" (exact string formatting). */
function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

function fromStored(type: string | null, value: string | null): DiscountInput | null {
  if (!type || value === null) return null;
  return { type: type as 'percent' | 'amount', value };
}

/**
 * The checkout engine (Prompt 10). One PostgreSQL transaction per sale:
 * lock the cashier's open shift → re-price every line from the catalog (never trusting
 * client prices) → check discount and price-override rights → verify that the payments
 * add up exactly → number the receipt → deduct stock through the inventory ledger →
 * write the order, the immutable sale, its lines, the payments and balance entries →
 * audit. Any failure rolls everything back. A client-generated idempotency key makes
 * network retries return the first sale instead of creating another.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedgerService,
    private readonly shifts: ShiftsService,
  ) {}

  // ------------------------------------------------------------ settings
  async getSettings(actor: MerchantActor): Promise<SalesSettings> {
    return this.database.withMerchantTx(actor.merchantId, (tx) =>
      this.settings(tx, actor.merchantId),
    );
  }

  private async settings(tx: Transaction, merchantId: string): Promise<SalesSettings> {
    const [row] = await tx
      .select()
      .from(salesSettings)
      .where(eq(salesSettings.merchantId, merchantId));
    return {
      maxDiscountPercent: trimDecimal(row?.maxDiscountPercent ?? '10'),
      refundWindowDays: row?.refundWindowDays ?? 30,
      refundApprovalLimit: money(row?.refundApprovalLimitMinor ?? 20000n),
      version: row?.version ?? 1,
    };
  }

  async updateSettings(
    actor: MerchantActor,
    input: z.output<typeof updateSalesSettingsSchema>,
    ip: string,
  ): Promise<SalesSettings> {
    assertCan(actor, 'merchant.settings.update', null);
    const limitMinor = parseAmount(input.refundApprovalLimit, 'refundApprovalLimit');
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(salesSettings)
        .where(eq(salesSettings.merchantId, actor.merchantId))
        .for('update');
      if ((row?.version ?? 1) !== input.version) throw versionConflict();
      if (row) {
        await tx
          .update(salesSettings)
          .set({
            maxDiscountPercent: input.maxDiscountPercent,
            refundWindowDays: input.refundWindowDays,
            refundApprovalLimitMinor: limitMinor,
            version: sql`${salesSettings.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(salesSettings.merchantId, actor.merchantId));
      } else {
        await tx.insert(salesSettings).values({
          merchantId: actor.merchantId,
          maxDiscountPercent: input.maxDiscountPercent,
          refundWindowDays: input.refundWindowDays,
          refundApprovalLimitMinor: limitMinor,
          version: 2,
        });
      }
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'sales.settings_updated',
        targetType: 'merchant',
        targetId: actor.merchantId,
        ip,
        details: {
          maxDiscountPercent: {
            from: row?.maxDiscountPercent ?? '10',
            to: input.maxDiscountPercent,
          },
          refundWindowDays: { from: row?.refundWindowDays ?? 30, to: input.refundWindowDays },
          refundApprovalLimit: {
            from: (row?.refundApprovalLimitMinor ?? 20000n).toString(),
            to: limitMinor.toString(),
          },
        },
      });
      return this.settings(tx, actor.merchantId);
    });
  }

  /** Raw refund policy for the refunds module (exact minor units). */
  async getSettingsInTx(tx: Transaction, merchantId: string) {
    const [row] = await tx
      .select()
      .from(salesSettings)
      .where(eq(salesSettings.merchantId, merchantId));
    return {
      refundWindowDays: row?.refundWindowDays ?? 30,
      refundApprovalLimitMinor: row?.refundApprovalLimitMinor ?? 20000n,
    };
  }

  /** Parses and permission-checks cart lines (shared with exchanges). */
  parseCart(
    actor: MerchantActor,
    input: { lines: CartLine[]; orderDiscount: DiscountInput | null },
  ) {
    return this.parseLines(actor, input);
  }

  // ------------------------------------------------------------ checkout
  private parseLines(
    actor: MerchantActor,
    input: { lines: CartLine[]; orderDiscount: DiscountInput | null },
  ) {
    const branchId = actor.boundBranchId!;
    const lines: ParsedLine[] = input.lines.map((l, i) => ({
      variantId: l.variantId,
      quantityMilli: parseQuantity(l.quantity),
      priceOverrideMinor:
        l.priceOverride === null ? null : parseAmount(l.priceOverride, `lines.${i}.priceOverride`),
      discount: toDiscount(l.discount, `lines.${i}.discount`),
      input: l,
      modifiers: [],
    }));
    const orderDiscount = toDiscount(input.orderDiscount, 'orderDiscount');
    lines.forEach((l, i) => {
      if (l.quantityMilli <= 0n)
        throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive.', [
          { path: `lines.${i}.quantity`, code: 'too_small', message: 'Quantity must be positive.' },
        ]);
    });
    if (
      (orderDiscount || lines.some((l) => l.discount)) &&
      !can(actor.access, 'sales.discount', branchId)
    )
      throw new AppError(403, 'DISCOUNT_LIMIT_EXCEEDED', 'You are not allowed to give discounts.');
    if (
      lines.some((l) => l.priceOverrideMinor !== null) &&
      !can(actor.access, 'sales.price_override', branchId)
    )
      throw new AppError(403, 'PRICE_OVERRIDE_DENIED', 'You are not allowed to change prices.');
    return { lines, orderDiscount };
  }

  async checkout(actor: MerchantActor, input: CheckoutInput, ip: string): Promise<Sale> {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    assertCan(actor, 'sales.create', branchId);
    const { lines, orderDiscount } = this.parseLines(actor, input);
    const expectedTotalMinor = parseAmount(input.expectedTotal, 'expectedTotal');
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...input, idempotencyKey: undefined }))
      .digest('hex');

    const replay = await this.replay(actor, input.idempotencyKey, requestHash);
    if (replay) return replay;

    const saleId = newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        // 1. The cashier's own open shift at this branch, locked: one checkout at a time per shift.
        const shift = await this.shifts.lockOwnShift(tx, actor);
        await this.completeSaleInTx(tx, actor, shift, {
          saleId,
          lines,
          orderDiscount,
          orderDiscountInput: input.orderDiscount,
          payments: input.payments,
          expectedTotalMinor,
          orderId: input.orderId ?? null,
          idempotency: { key: input.idempotencyKey, hash: requestHash },
          exchange: null,
          customer: { id: input.customerId, inherited: false },
          ip,
        });
      });
    } catch (error) {
      // A concurrent retry with the same key committed first: return its sale.
      if (isUniqueViolation(error, 'orders_idempotency_key')) {
        const again = await this.replay(actor, input.idempotencyKey, requestHash);
        if (again) return again;
      }
      throw error;
    }
    return this.getSale(actor, saleId, 'pos');
  }

  /**
   * Steps 2–9 of a checkout inside the caller's transaction (the shift is already locked).
   * Used by the POS checkout and by exchanges, where part of the total is paid with the
   * credit of the linked refund.
   */
  async completeSaleInTx(
    tx: Transaction,
    actor: MerchantActor,
    shift: { id: string; registerId: string; branchId: string },
    args: {
      saleId: string;
      lines: ParsedLine[];
      orderDiscount: Discount | null;
      orderDiscountInput: DiscountInput | null;
      payments: CheckoutInput['payments'];
      expectedTotalMinor: bigint;
      orderId: string | null;
      idempotency: { key: string; hash: string } | null;
      exchange: { refundId: string; creditMinor: bigint } | null;
      customer: { id: string | null; inherited: boolean };
      /** Restaurant bill: the order it pays and its service type. */
      restaurant?: { orderId: string; serviceType: string } | null;
      ip: string;
    },
  ): Promise<{ totalMinor: bigint; receiptNumber: string }> {
    const { saleId, lines, orderDiscount, ip } = args;
    const branchId = shift.branchId;
    const customerId = await resolveSaleCustomer(
      tx,
      actor,
      branchId,
      args.customer.id,
      args.customer.inherited,
    );
    // 2. Authoritative prices and availability from the catalog.
    const items = await this.loadItems(
      tx,
      branchId,
      lines.map((l) => l.variantId),
    );
    const unavailable = lines.flatMap((l, i) =>
      items.has(l.variantId)
        ? []
        : [
            {
              path: `lines.${i}.variantId`,
              code: 'unavailable',
              message: 'This item cannot be sold here.',
            },
          ],
    );
    if (unavailable.length)
      throw new AppError(
        409,
        'ITEM_UNAVAILABLE',
        'Some items are not available at this branch.',
        unavailable,
      );

    let priced;
    try {
      priced = priceCart(
        lines.map((l) => ({
          unitPriceMinor: (l.priceOverrideMinor ?? items.get(l.variantId)!.priceMinor) + extraOf(l),
          quantityMilli: l.quantityMilli,
          discount: l.discount,
        })),
        orderDiscount,
      );
    } catch (error) {
      if (error instanceof PricingError)
        throw new AppError(400, error.code, error.message, [
          {
            path: error.line === null ? 'orderDiscount' : `lines.${error.line}`,
            code: 'invalid',
            message: error.message,
          },
        ]);
      throw error;
    }

    // 3. Discount limit (exact comparison) unless the cashier may exceed it.
    const { maxDiscountPercent } = await this.settings(tx, actor.merchantId);
    if (!can(actor.access, 'sales.discount.override_limit', branchId)) {
      const overLine = priced.lines.findIndex((p) =>
        exceedsDiscountLimit(p.lineDiscountMinor, p.grossMinor, maxDiscountPercent),
      );
      const orderBase = priced.subtotalMinor - priced.lineDiscountsMinor;
      if (
        overLine >= 0 ||
        exceedsDiscountLimit(priced.orderDiscountMinor, orderBase, maxDiscountPercent)
      )
        throw new AppError(
          403,
          'DISCOUNT_LIMIT_EXCEEDED',
          `Discounts above ${maxDiscountPercent}% need a manager.`,
        );
    }

    // 4. The total the cashier saw must still be right.
    if (priced.totalMinor !== args.expectedTotalMinor)
      throw new AppError(409, 'TOTAL_CHANGED', 'Prices changed. Review the cart and try again.');

    // 5. Payments must cover the total exactly.
    const creditMinor = args.exchange
      ? args.exchange.creditMinor < priced.totalMinor
        ? args.exchange.creditMinor
        : priced.totalMinor
      : 0n;
    const paid = await this.preparePayments(tx, args.payments, priced.totalMinor - creditMinor);

    // 6. The order: complete a suspended one, or create it completed.
    const orderId = await this.completeOrder(tx, actor, shift, { ...args, customerId });

    // 7. Receipt number (gap-free per branch, atomic increment).
    const receiptNumber = await this.nextReceiptNumber(tx, actor.merchantId, branchId);

    // 8. Stock: one ledger movement per consumed item (the item itself, or its recipe
    // ingredients and modifier ingredients), all-or-nothing, only here (ADR-0074).
    const consumption = await stockConsumption(
      tx,
      lines.map((l) => ({
        variantId: l.variantId,
        quantityMilli: l.quantityMilli,
        modifierIds: l.modifiers.map((m) => m.id),
      })),
    );
    const applied = await this.ledger.apply(
      tx,
      {
        merchantId: actor.merchantId,
        branchId,
        movementType: 'sale',
        sourceType: 'sale',
        sourceId: saleId,
        userId: actor.userId,
      },
      consumption.map((c) => ({
        variantId: c.variantId,
        mode: 'delta' as const,
        quantityMilli: -c.quantityMilli,
      })),
    );
    const costs = consumptionCosts(
      lines.length,
      consumption,
      applied,
      (i) => items.get(lines[i]!.variantId)!.costMinor,
    );

    // 9. The immutable sale with snapshots, payments and balance entries.
    let costMinor: bigint | null = 0n;
    const lineRows = lines.map((l, i) => {
      const item = items.get(l.variantId)!;
      const p = priced.lines[i]!;
      const lineCost = costs.total[i]!;
      if (lineCost === null) costMinor = null;
      else if (costMinor !== null) costMinor += lineCost;
      // Unit cost of the item itself (used when it is restocked), or the recipe cost per unit.
      const unitCost =
        costs.own[i] ??
        (lineCost === null
          ? null
          : (2n * lineCost * 1000n + l.quantityMilli) / (2n * l.quantityMilli));
      const extra = extraOf(l);
      return {
        merchantId: actor.merchantId,
        saleId,
        position: i,
        variantId: l.variantId,
        productId: item.productId,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        variantNameEn: item.variantNameEn,
        variantNameAr: item.variantNameAr,
        sku: item.sku,
        quantity: formatQuantity(l.quantityMilli),
        listUnitPriceMinor: item.priceMinor + extra,
        unitPriceMinor: (l.priceOverrideMinor ?? item.priceMinor) + extra,
        priceOverridden: l.priceOverrideMinor !== null && l.priceOverrideMinor !== item.priceMinor,
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
    const totals = paid.reduce(
      (t, p) => ({ change: t.change + p.changeMinor, fees: t.fees + p.feeMinor }),
      { change: 0n, fees: 0n },
    );
    await tx.insert(sales).values({
      id: saleId,
      merchantId: actor.merchantId,
      orderId,
      branchId,
      registerId: shift.registerId,
      shiftId: shift.id,
      membershipId: actor.membershipId,
      userId: actor.userId,
      receiptNumber,
      customerId,
      restaurantOrderId: args.restaurant?.orderId ?? null,
      serviceType: args.restaurant?.serviceType ?? null,
      subtotalMinor: priced.subtotalMinor,
      lineDiscountsMinor: priced.lineDiscountsMinor,
      orderDiscountMinor: priced.orderDiscountMinor,
      totalMinor: priced.totalMinor,
      paidMinor: priced.totalMinor,
      changeMinor: totals.change,
      feesMinor: totals.fees,
      costMinor,
    });
    await tx.insert(saleLines).values(lineRows);
    const modifierRows = lines.flatMap((l, position) =>
      l.modifiers.map((m) => ({
        merchantId: actor.merchantId,
        saleId,
        position,
        modifierId: m.id,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        priceMinor: m.priceMinor,
      })),
    );
    if (modifierRows.length) await tx.insert(saleLineModifiers).values(modifierRows);
    if (creditMinor > 0n)
      await tx.insert(payments).values({
        id: newId(),
        merchantId: actor.merchantId,
        saleId,
        branchId,
        shiftId: shift.id,
        paymentMethodId: null,
        methodKind: 'exchange',
        methodNameEn: 'Exchange credit',
        methodNameAr: 'رصيد استبدال',
        amountMinor: creditMinor,
        refundId: args.exchange!.refundId,
        status: 'succeeded',
        verification: 'internal',
      });
    if (paid.length > 0) {
      await tx.insert(payments).values(
        paid.map((p) => ({
          id: p.id,
          merchantId: actor.merchantId,
          saleId,
          branchId,
          shiftId: shift.id,
          paymentMethodId: p.method.id,
          methodKind: p.method.kind,
          methodNameEn: p.method.nameEn,
          methodNameAr: p.method.nameAr,
          amountMinor: p.amountMinor,
          tenderedMinor: p.tenderedMinor,
          changeMinor: p.changeMinor,
          feeMinor: p.feeMinor,
          status: 'succeeded',
          verification: 'manual',
          reference: p.reference,
          financialAccountId: p.method.financialAccountId,
        })),
      );
      const entries = paid.flatMap((p) =>
        p.method.financialAccountId
          ? [
              { entryType: 'payment', amountMinor: p.amountMinor, p },
              ...(p.feeMinor > 0n ? [{ entryType: 'fee', amountMinor: -p.feeMinor, p }] : []),
            ]
          : [],
      );
      if (entries.length)
        await tx.insert(financialAccountEntries).values(
          entries.map((e) => ({
            id: newId(),
            merchantId: actor.merchantId,
            accountId: e.p.method.financialAccountId!,
            amountMinor: e.amountMinor,
            entryType: e.entryType,
            sourceType: 'payment',
            sourceId: e.p.id,
            description: receiptNumber,
            createdByUserId: actor.userId,
          })),
        );
    }
    await this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action: args.exchange ? 'sale.completed_exchange' : 'sale.completed',
      targetType: 'sale',
      targetId: saleId,
      ip,
      details: {
        receiptNumber,
        total: Money.ofMinor(priced.totalMinor, CURRENCY).toDecimalString(),
        customerId,
        shiftId: shift.id,
        registerId: shift.registerId,
        priceOverrides: lineRows
          .filter((l) => l.priceOverridden)
          .map((l) => ({
            variantId: l.variantId,
            from: Money.ofMinor(l.listUnitPriceMinor, CURRENCY).toDecimalString(),
            to: Money.ofMinor(l.unitPriceMinor, CURRENCY).toDecimalString(),
          })),
        discounts: Money.ofMinor(
          priced.lineDiscountsMinor + priced.orderDiscountMinor,
          CURRENCY,
        ).toDecimalString(),
      },
    });
    return { totalMinor: priced.totalMinor, receiptNumber };
  }

  /**
   * Online store sale (Prompt 16): the paid online order becomes an immutable sale with
   * the same stock consumption, receipt numbering, fee calculation and balance entries as a
   * POS sale, but without register, shift or cashier (`channel = 'online'`). Prices are the
   * ones the customer saw at checkout. Consumes the order's own stock reservation.
   */
  async completeOnlineSaleInTx(
    tx: Transaction,
    merchantId: string,
    args: {
      saleId: string;
      branchId: string;
      onlineOrderId: string;
      orderNumber: string;
      customerId: string | null;
      lines: {
        variantId: string;
        productId: string;
        quantityMilli: bigint;
        unitPriceMinor: bigint;
        nameEn: string | null;
        nameAr: string | null;
        variantNameEn: string | null;
        variantNameAr: string | null;
        sku: string | null;
      }[];
      payment: { methodId: string; amountMinor: bigint; providerReference: string };
    },
  ): Promise<{ receiptNumber: string; totalMinor: bigint }> {
    const { saleId, branchId, lines } = args;
    // Same lock order as a POS checkout: receipt sequence before stock (no deadlock).
    const receiptNumber = await this.nextReceiptNumber(tx, merchantId, branchId);
    const consumption = await stockConsumption(
      tx,
      lines.map((l) => ({
        variantId: l.variantId,
        quantityMilli: l.quantityMilli,
        modifierIds: [],
      })),
    );
    const applied = await this.ledger.apply(
      tx,
      {
        merchantId,
        branchId,
        movementType: 'sale',
        sourceType: 'sale',
        sourceId: saleId,
        userId: null,
        reservationOrderId: args.onlineOrderId,
      },
      consumption.map((c) => ({
        variantId: c.variantId,
        mode: 'delta' as const,
        quantityMilli: -c.quantityMilli,
      })),
    );
    const catalogCosts = new Map(
      (
        (
          await tx.execute(
            sql`select id, cost_minor::text as cost from product_variants where id in (${sql.join(
              lines.map((l) => sql`${l.variantId}`),
              sql`, `,
            )})`,
          )
        ).rows as { id: string; cost: string | null }[]
      ).map((r) => [r.id, r.cost === null ? null : BigInt(r.cost)]),
    );
    const costs = consumptionCosts(
      lines.length,
      consumption,
      applied,
      (i) => catalogCosts.get(lines[i]!.variantId) ?? null,
    );
    const priced = priceCart(
      lines.map((l) => ({
        unitPriceMinor: l.unitPriceMinor,
        quantityMilli: l.quantityMilli,
        discount: null,
      })),
      null,
    );
    if (priced.totalMinor !== args.payment.amountMinor)
      throw new AppError(
        409,
        'PAYMENT_TOTAL_MISMATCH',
        'The payment does not match the order total.',
      );
    const [method] = (
      await tx.execute(sql`select * from payment_methods where id = ${args.payment.methodId}`)
    ).rows as Record<string, unknown>[];
    if (!method) throw AppError.notFound('Payment method not found.');
    const feeMinor = processingFee(priced.totalMinor, {
      type: method['fee_type'] as FeeType,
      fixedMinor: BigInt(method['fee_fixed_minor'] as string),
      percent: method['fee_percent'] as string,
    });
    let costMinor: bigint | null = 0n;
    const lineRows = lines.map((l, i) => {
      const lineCost = costs.total[i]!;
      if (lineCost === null) costMinor = null;
      else if (costMinor !== null) costMinor += lineCost;
      const unitCost =
        costs.own[i] ??
        (lineCost === null
          ? null
          : (2n * lineCost * 1000n + l.quantityMilli) / (2n * l.quantityMilli));
      const p = priced.lines[i]!;
      return {
        merchantId,
        saleId,
        position: i,
        variantId: l.variantId,
        productId: l.productId,
        nameEn: l.nameEn,
        nameAr: l.nameAr,
        variantNameEn: l.variantNameEn,
        variantNameAr: l.variantNameAr,
        sku: l.sku,
        quantity: formatQuantity(l.quantityMilli),
        listUnitPriceMinor: l.unitPriceMinor,
        unitPriceMinor: l.unitPriceMinor,
        priceOverridden: false,
        grossMinor: p.grossMinor,
        discountType: null,
        discountValue: null,
        lineDiscountMinor: 0n,
        orderDiscountMinor: 0n,
        netMinor: p.netMinor,
        trackInventory: costs.tracked[i]!,
        unitCostMinor: unitCost,
      };
    });
    await tx.insert(sales).values({
      id: saleId,
      merchantId,
      channel: 'online',
      onlineOrderId: args.onlineOrderId,
      branchId,
      receiptNumber,
      customerId: args.customerId,
      subtotalMinor: priced.subtotalMinor,
      lineDiscountsMinor: 0n,
      orderDiscountMinor: 0n,
      totalMinor: priced.totalMinor,
      paidMinor: priced.totalMinor,
      changeMinor: 0n,
      feesMinor: feeMinor,
      costMinor,
    });
    await tx.insert(saleLines).values(lineRows);
    const paymentId = newId();
    const accountId = (method['financial_account_id'] as string | null) ?? null;
    await tx.insert(payments).values({
      id: paymentId,
      merchantId,
      saleId,
      branchId,
      shiftId: null,
      paymentMethodId: args.payment.methodId,
      methodKind: method['kind'] as string,
      methodNameEn: (method['name_en'] as string | null) ?? null,
      methodNameAr: (method['name_ar'] as string | null) ?? null,
      amountMinor: priced.totalMinor,
      feeMinor,
      status: 'succeeded',
      verification: 'gateway',
      reference: args.payment.providerReference,
      financialAccountId: accountId,
    });
    if (accountId)
      await tx.insert(financialAccountEntries).values([
        {
          id: newId(),
          merchantId,
          accountId,
          amountMinor: priced.totalMinor,
          entryType: 'payment',
          sourceType: 'payment',
          sourceId: paymentId,
          description: receiptNumber,
          createdByUserId: null,
        },
        ...(feeMinor > 0n
          ? [
              {
                id: newId(),
                merchantId,
                accountId,
                amountMinor: -feeMinor,
                entryType: 'fee',
                sourceType: 'payment',
                sourceId: paymentId,
                description: receiptNumber,
                createdByUserId: null,
              },
            ]
          : []),
      ]);
    await this.audit.recordIn(tx, {
      merchantId,
      actorType: 'system',
      action: 'sale.completed_online',
      targetType: 'sale',
      targetId: saleId,
      details: {
        receiptNumber,
        onlineOrder: args.orderNumber,
        total: Money.ofMinor(priced.totalMinor, CURRENCY).toDecimalString(),
        providerReference: args.payment.providerReference,
      },
    });
    return { receiptNumber, totalMinor: priced.totalMinor };
  }

  async replay(actor: MerchantActor, key: string, requestHash: string): Promise<Sale | null> {
    const [order] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      tx
        .select({ id: orders.id, hash: orders.requestHash, status: orders.status })
        .from(orders)
        .where(eq(orders.idempotencyKey, key)),
    );
    if (!order) return null;
    if (order.hash !== requestHash)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This checkout key was already used for a different cart.',
      );
    const [sale] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.orderId, order.id)),
    );
    return sale ? this.getSale(actor, sale.id, 'pos') : null;
  }

  /** Sellable variants at a branch with their current price and cost. */
  async loadItems(tx: Transaction, branchId: string, variantIds: string[]) {
    const rows = (
      await tx.execute(sql`
        select v.id, v.price_minor::text as price, v.cost_minor::text as cost, v.name_en as variant_name_en,
               v.name_ar as variant_name_ar, v.sku, p.id as product_id, p.name_en, p.name_ar
        from product_variants v join products p on p.id = v.product_id
        where v.id in (${sql.join(
          [...new Set(variantIds)].map((id) => sql`${id}`),
          sql`, `,
        )})
          and v.status = 'active' and p.status = 'active'
          and (p.available_in_all_branches or exists (
            select 1 from product_branch_availability a where a.product_id = p.id and a.branch_id = ${branchId}))`)
    ).rows as Record<string, string | null>[];
    return new Map(
      rows.map((r) => [
        r['id']!,
        {
          productId: r['product_id']!,
          priceMinor: BigInt(r['price']!),
          costMinor: r['cost'] === null ? null : BigInt(r['cost']!),
          nameEn: r['name_en'] ?? null,
          nameAr: r['name_ar'] ?? null,
          variantNameEn: r['variant_name_en'] ?? null,
          variantNameAr: r['variant_name_ar'] ?? null,
          sku: r['sku'] ?? null,
        },
      ]),
    );
  }

  private async preparePayments(
    tx: Transaction,
    input: CheckoutInput['payments'],
    totalMinor: bigint,
  ) {
    if (input.length === 0) {
      if (totalMinor === 0n) return [];
      throw new AppError(400, 'PAYMENT_TOTAL_MISMATCH', 'Add a payment.');
    }
    const ids = [...new Set(input.map((p) => p.methodId))];
    const methods = (
      await tx.execute(
        sql`select * from payment_methods where id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
    ).rows as Record<string, unknown>[];
    const byId = new Map(methods.map((m) => [m['id'] as string, m]));
    let sum = 0n;
    const prepared = input.map((p, i) => {
      const m = byId.get(p.methodId);
      if (!m || m['status'] !== 'active' || !m['available_in_pos'])
        throw new AppError(
          409,
          'PAYMENT_METHOD_UNAVAILABLE',
          'This payment method is not available.',
          [{ path: `payments.${i}.methodId`, code: 'unavailable', message: 'Unavailable.' }],
        );
      // No gateway is integrated yet: a gateway payment can never be confirmed here.
      if (m['gateway_provider'])
        throw new AppError(
          409,
          'PAYMENT_NOT_VERIFIED',
          'This payment needs gateway verification, which is not available.',
        );
      const amountMinor = parseAmount(p.amount, `payments.${i}.amount`);
      if (amountMinor <= 0n)
        throw new AppError(400, 'PAYMENT_TOTAL_MISMATCH', 'Payment amounts must be positive.');
      let tenderedMinor: bigint | null = null;
      let changeMinor = 0n;
      if (p.tendered !== null) {
        if (m['kind'] !== 'cash')
          throw new AppError(
            400,
            'PAYMENT_TOTAL_MISMATCH',
            'Only cash can be tendered with change.',
          );
        tenderedMinor = parseAmount(p.tendered, `payments.${i}.tendered`);
        if (tenderedMinor < amountMinor)
          throw new AppError(
            400,
            'PAYMENT_TOTAL_MISMATCH',
            'Cash tendered is less than the amount.',
          );
        changeMinor = tenderedMinor - amountMinor;
      }
      sum += amountMinor;
      const feeMinor = processingFee(amountMinor, {
        type: m['fee_type'] as FeeType,
        fixedMinor: BigInt(m['fee_fixed_minor'] as string),
        percent: m['fee_percent'] as string,
      });
      return {
        id: newId(),
        method: {
          id: m['id'] as string,
          kind: m['kind'] as string,
          nameEn: (m['name_en'] as string | null) ?? null,
          nameAr: (m['name_ar'] as string | null) ?? null,
          financialAccountId: (m['financial_account_id'] as string | null) ?? null,
        },
        amountMinor,
        tenderedMinor,
        changeMinor,
        feeMinor,
        reference: p.reference,
      };
    });
    if (sum !== totalMinor)
      throw new AppError(
        400,
        'PAYMENT_TOTAL_MISMATCH',
        'The payments do not add up to the total.',
        [
          {
            path: 'payments',
            code: 'mismatch',
            message: `total=${Money.ofMinor(totalMinor, CURRENCY).toDecimalString()} paid=${Money.ofMinor(sum, CURRENCY).toDecimalString()}`,
          },
        ],
      );
    return prepared;
  }

  private async completeOrder(
    tx: Transaction,
    actor: MerchantActor,
    shift: { id: string; registerId: string; branchId: string },
    args: {
      lines: ParsedLine[];
      orderDiscountInput: DiscountInput | null;
      orderId: string | null;
      idempotency: { key: string; hash: string } | null;
      customerId: string | null;
    },
  ): Promise<string> {
    const { lines } = args;
    const lineValues = (orderId: string) =>
      lines.map((l, i) => ({
        merchantId: actor.merchantId,
        orderId,
        position: i,
        variantId: l.variantId,
        quantity: formatQuantity(l.quantityMilli),
        priceOverrideMinor: l.priceOverrideMinor,
        discountType: l.input.discount?.type ?? null,
        discountValue: l.input.discount?.value ?? null,
      }));
    if (args.orderId) {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, args.orderId))
        .for('update');
      if (!order || order.branchId !== shift.branchId) throw AppError.notFound('Order not found.');
      if (order.status !== 'suspended')
        throw new AppError(
          409,
          'ORDER_NOT_SUSPENDED',
          'This order was already completed or cancelled.',
        );
      await tx.delete(orderLines).where(eq(orderLines.orderId, order.id));
      await tx.insert(orderLines).values(lineValues(order.id));
      await tx
        .update(orders)
        .set({
          status: 'completed',
          customerId: args.customerId,
          idempotencyKey: args.idempotency?.key ?? null,
          requestHash: args.idempotency?.hash ?? null,
          orderDiscountType: args.orderDiscountInput?.type ?? null,
          orderDiscountValue: args.orderDiscountInput?.value ?? null,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
          version: sql`${orders.version} + 1`,
        })
        .where(eq(orders.id, order.id));
      return order.id;
    }
    const orderId = newId();
    await tx.insert(orders).values({
      id: orderId,
      merchantId: actor.merchantId,
      branchId: shift.branchId,
      registerId: shift.registerId,
      shiftId: shift.id,
      membershipId: actor.membershipId,
      userId: actor.userId,
      status: 'completed',
      customerId: args.customerId,
      orderDiscountType: args.orderDiscountInput?.type ?? null,
      orderDiscountValue: args.orderDiscountInput?.value ?? null,
      idempotencyKey: args.idempotency?.key ?? null,
      requestHash: args.idempotency?.hash ?? null,
      completedAt: sql`now()`,
    });
    await tx.insert(orderLines).values(lineValues(orderId));
    return orderId;
  }

  private async nextReceiptNumber(
    tx: Transaction,
    merchantId: string,
    branchId: string,
  ): Promise<string> {
    const [row] = (
      await tx.execute(sql`
        insert into receipt_sequences (merchant_id, branch_id, last_number) values (${merchantId}, ${branchId}, 1)
        on conflict (merchant_id, branch_id) do update set last_number = receipt_sequences.last_number + 1
        returning last_number, (select code from branches where id = ${branchId}) as code`)
    ).rows as { last_number: string; code: string }[];
    return `${row!.code}-${String(row!.last_number).padStart(6, '0')}`;
  }

  // ------------------------------------------------------------ suspended carts
  async suspend(actor: MerchantActor, input: SuspendInput, ip: string): Promise<SuspendedOrder> {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    assertCan(actor, 'sales.create', branchId);
    const { lines } = this.parseLines(actor, input);
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const shift = await this.shifts.lockOwnShift(tx, actor);
      const items = await this.loadItems(
        tx,
        branchId,
        lines.map((l) => l.variantId),
      );
      if (lines.some((l) => !items.has(l.variantId)))
        throw new AppError(409, 'ITEM_UNAVAILABLE', 'Some items are not available at this branch.');
      const customerId = await resolveSaleCustomer(tx, actor, branchId, input.customerId);
      await tx.insert(orders).values({
        id,
        merchantId: actor.merchantId,
        branchId,
        registerId: shift.registerId,
        shiftId: shift.id,
        membershipId: actor.membershipId,
        userId: actor.userId,
        status: 'suspended',
        label: input.label,
        customerId,
        orderDiscountType: input.orderDiscount?.type ?? null,
        orderDiscountValue: input.orderDiscount?.value ?? null,
      });
      await tx.insert(orderLines).values(
        lines.map((l, i) => ({
          merchantId: actor.merchantId,
          orderId: id,
          position: i,
          variantId: l.variantId,
          quantity: formatQuantity(l.quantityMilli),
          priceOverrideMinor: l.priceOverrideMinor,
          discountType: l.input.discount?.type ?? null,
          discountValue: l.input.discount?.value ?? null,
        })),
      );
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'order.suspended',
        targetType: 'order',
        targetId: id,
        ip,
      });
    });
    return (await this.suspended(actor)).find((o) => o.id === id)!;
  }

  /** Suspended carts at the POS branch (any cashier there may resume them). */
  async suspended(actor: MerchantActor): Promise<SuspendedOrder[]> {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select o.*, u.full_name, c.code as customer_code, c.full_name as customer_name
          from orders o join users u on u.id = o.user_id left join customers c on c.id = o.customer_id
          where o.branch_id = ${branchId} and o.status = 'suspended' order by o.created_at`)
      ).rows as Record<string, unknown>[];
      const result: SuspendedOrder[] = [];
      for (const o of rows) {
        const ls = await tx
          .select()
          .from(orderLines)
          .where(eq(orderLines.orderId, o['id'] as string))
          .orderBy(asc(orderLines.position));
        result.push({
          id: o['id'] as string,
          label: (o['label'] as string | null) ?? null,
          createdAt: iso(o['created_at']),
          cashierName: o['full_name'] as string,
          lineCount: ls.length,
          lines: ls.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            priceOverride: l.priceOverrideMinor === null ? null : money(l.priceOverrideMinor),
            discount: fromStored(l.discountType, l.discountValue),
          })),
          orderDiscount: fromStored(
            o['order_discount_type'] as string | null,
            o['order_discount_value'] as string | null,
          ),
          customer: customerOf(o),
          version: o['version'] as number,
        });
      }
      return result;
    });
  }

  async cancelSuspended(actor: MerchantActor, orderId: string, ip: string): Promise<void> {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    assertCan(actor, 'sales.create', branchId);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!order || order.branchId !== branchId) throw AppError.notFound();
      if (order.status !== 'suspended')
        throw new AppError(
          409,
          'ORDER_NOT_SUSPENDED',
          'This order was already completed or cancelled.',
        );
      await tx
        .update(orders)
        .set({
          status: 'cancelled',
          cancelledAt: sql`now()`,
          updatedAt: sql`now()`,
          version: sql`${orders.version} + 1`,
        })
        .where(eq(orders.id, orderId));
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'order.cancelled',
        targetType: 'order',
        targetId: orderId,
        ip,
      });
    });
  }

  // ------------------------------------------------------------ reading
  async getSale(actor: MerchantActor, id: string, view: 'pos' | 'manager'): Promise<Sale> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [s] = (
        await tx.execute(
          sql`select s.*, u.full_name,
                     (select coalesce(sum(r.total_minor), 0) from refunds r
                      where r.sale_id = s.id and r.status = 'completed')::text as refunded,
                     c.code as customer_code, c.full_name as customer_name
              from sales s left join users u on u.id = s.user_id left join customers c on c.id = s.customer_id
              where s.id = ${id}`,
        )
      ).rows as Record<string, unknown>[];
      if (!s) throw AppError.notFound();
      if (view === 'pos') {
        if (s['branch_id'] !== actor.boundBranchId) throw AppError.notFound();
      } else assertCan(actor, 'sales.read', s['branch_id'] as string);
      const ls = await tx
        .select()
        .from(saleLines)
        .where(eq(saleLines.saleId, id))
        .orderBy(asc(saleLines.position));
      const ps = await tx
        .select()
        .from(payments)
        .where(eq(payments.saleId, id))
        .orderBy(asc(payments.createdAt), asc(payments.id));
      const mods = await tx
        .select()
        .from(saleLineModifiers)
        .where(eq(saleLineModifiers.saleId, id))
        .orderBy(asc(saleLineModifiers.position), asc(saleLineModifiers.nameEn));
      const manager = view === 'manager';
      return {
        id,
        orderId: (s['order_id'] as string | null) ?? null,
        receiptNumber: s['receipt_number'] as string,
        branchId: s['branch_id'] as string,
        registerId: (s['register_id'] as string | null) ?? null,
        shiftId: (s['shift_id'] as string | null) ?? null,
        cashierName: (s['full_name'] as string | null) ?? '',
        channel: s['channel'] as 'pos' | 'online',
        createdAt: iso(s['created_at']),
        subtotal: money(s['subtotal_minor'] as string),
        lineDiscounts: money(s['line_discounts_minor'] as string),
        orderDiscount: money(s['order_discount_minor'] as string),
        total: money(s['total_minor'] as string),
        paid: money(s['paid_minor'] as string),
        change: money(s['change_minor'] as string),
        refunded: money(s['refunded'] as string),
        customer: customerOf(s),
        serviceType: (s['service_type'] as Sale['serviceType']) ?? null,
        restaurantOrderId: (s['restaurant_order_id'] as string | null) ?? null,
        lines: ls.map((l) => ({
          position: l.position,
          variantId: l.variantId,
          productId: l.productId,
          nameEn: l.nameEn,
          nameAr: l.nameAr,
          variantNameEn: l.variantNameEn,
          variantNameAr: l.variantNameAr,
          sku: l.sku,
          quantity: l.quantity,
          listUnitPrice: money(l.listUnitPriceMinor),
          unitPrice: money(l.unitPriceMinor),
          priceOverridden: l.priceOverridden,
          gross: money(l.grossMinor),
          discount: fromStored(l.discountType, l.discountValue),
          lineDiscount: money(l.lineDiscountMinor),
          orderDiscount: money(l.orderDiscountMinor),
          net: money(l.netMinor),
          modifiers: mods
            .filter((m) => m.position === l.position)
            .map((m) => ({ nameEn: m.nameEn, nameAr: m.nameAr, price: money(m.priceMinor) })),
        })),
        payments: ps.map((p) => ({
          id: p.id,
          methodId: p.paymentMethodId,
          kind: p.methodKind,
          nameEn: p.methodNameEn,
          nameAr: p.methodNameAr,
          amount: money(p.amountMinor),
          tendered: p.tenderedMinor === null ? null : money(p.tenderedMinor),
          change: money(p.changeMinor),
          status: p.status as 'succeeded',
          verification: p.verification as 'manual' | 'gateway',
          reference: p.reference,
          ...(manager ? { fee: money(p.feeMinor) } : {}),
        })),
        ...(manager
          ? {
              fees: money(s['fees_minor'] as string),
              ...(can(actor.access, 'catalog.prices.manage', null) ||
              can(actor.access, 'reports.financial', s['branch_id'] as string)
                ? { cost: s['cost_minor'] === null ? null : money(s['cost_minor'] as string) }
                : {}),
            }
          : {}),
      };
    });
  }

  async receipt(actor: MerchantActor, id: string, view: 'pos' | 'manager'): Promise<Receipt> {
    const sale = await this.getSale(actor, id, view);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [info] = (
        await tx.execute(sql`
          select m.display_name_en, m.display_name_ar, b.name_en as b_en, b.name_ar as b_ar, b.phone, b.address,
                 b.receipt_header, b.receipt_footer, r.code, r.name_en as r_en, r.name_ar as r_ar
          from sales s join merchants m on m.id = s.merchant_id join branches b on b.id = s.branch_id
          left join registers r on r.id = s.register_id where s.id = ${id}`)
      ).rows as Record<string, string | null>[];
      return {
        sale: {
          ...sale,
          fees: undefined,
          cost: undefined,
          payments: sale.payments.map(({ fee: _f, ...p }) => p),
        },
        merchant: {
          nameEn: info!['display_name_en'] ?? null,
          nameAr: info!['display_name_ar'] ?? null,
        },
        branch: {
          nameEn: info!['b_en'] ?? null,
          nameAr: info!['b_ar'] ?? null,
          phone: info!['phone'] ?? null,
          address: info!['address'] ?? null,
          receiptHeader: info!['receipt_header'] ?? null,
          receiptFooter: info!['receipt_footer'] ?? null,
        },
        register: {
          code: info!['code'] ?? 'ONLINE',
          nameEn: info!['r_en'] ?? null,
          nameAr: info!['r_ar'] ?? null,
        },
      };
    });
  }

  /** POS: sales of the cashier's current shift (newest first). */
  async recent(actor: MerchantActor): Promise<SaleSummary[]> {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [shift] = (
        await tx.execute(sql`select id from shifts where membership_id = ${actor.membershipId} and status = 'open'
                             and branch_id = ${branchId}`)
      ).rows as { id: string }[];
      if (!shift) return [];
      return this.summaries(tx, sql`s.shift_id = ${shift.id}`, 50, 0);
    });
  }

  /**
   * Sales history. `permission` decides the visible branches: `sales.read` for the sales
   * pages, `customers.read` for a customer's purchase history.
   */
  async list(
    actor: MerchantActor,
    query: ListQuery,
    permission: 'sales.read' | 'customers.read' = 'sales.read',
  ) {
    let scope: SQL | undefined;
    if (query.branchId) {
      assertCan(actor, permission, query.branchId);
      scope = sql`s.branch_id = ${query.branchId}`;
    } else {
      const s = permissionBranchScope(actor.access, permission);
      if (!s.all) {
        if (s.branchIds.length === 0) throw AppError.forbidden();
        scope = sql`s.branch_id in (${sql.join(
          s.branchIds.map((b) => sql`${b}`),
          sql`, `,
        )})`;
      }
    }
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [m] = (
        await tx.execute(sql`select timezone from merchants where id = ${actor.merchantId}`)
      ).rows as { timezone: string }[];
      const tz = m?.timezone ?? 'Asia/Kuwait';
      const conditions: SQL[] = [scope ?? sql`true`];
      if (query.shiftId) conditions.push(sql`s.shift_id = ${query.shiftId}`);
      if (query.customerId) conditions.push(sql`s.customer_id = ${query.customerId}`);
      if (query.channel) conditions.push(sql`s.channel = ${query.channel}`);
      if (query.serviceType)
        conditions.push(
          query.serviceType === 'retail'
            ? sql`s.service_type is null`
            : sql`s.service_type = ${query.serviceType}`,
        );
      if (query.q)
        conditions.push(
          sql`s.receipt_number ilike ${`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`,
        );
      if (query.from)
        conditions.push(sql`s.created_at >= (${query.from}::date)::timestamp at time zone ${tz}`);
      if (query.to)
        conditions.push(
          sql`s.created_at < ((${query.to}::date + 1)::timestamp at time zone ${tz})`,
        );
      const where = sql.join(conditions, sql` and `);
      const [agg] = (
        await tx.execute(
          sql`select count(*)::int as n, coalesce(sum(total_minor), 0)::text as amount,
                     coalesce((select sum(r.total_minor) from refunds r
                               where r.status = 'completed' and r.sale_id in (select s.id from sales s where ${where})), 0)::text as refunded
              from sales s where ${where}`,
        )
      ).rows as { n: number; amount: string; refunded: string }[];
      const rows = await this.summaries(
        tx,
        where,
        query.pageSize,
        (query.page - 1) * query.pageSize,
      );
      return {
        sales: rows,
        total: agg!.n,
        page: query.page,
        pageSize: query.pageSize,
        totals: {
          count: agg!.n,
          amount: money(agg!.amount),
          refunded: money(agg!.refunded),
          net: money(BigInt(agg!.amount) - BigInt(agg!.refunded)),
        },
      };
    });
  }

  private async summaries(
    tx: Transaction,
    where: SQL,
    limit: number,
    offset: number,
  ): Promise<SaleSummary[]> {
    const rows = (
      await tx.execute(sql`
        select s.id, s.receipt_number, s.branch_id, s.created_at, s.total_minor::text as total, u.full_name,
               s.service_type, s.channel,
               (select coalesce(sum(l.quantity), 0)::text from sale_lines l where l.sale_id = s.id) as items,
               (select coalesce(array_agg(distinct p.method_kind), '{}') from payments p where p.sale_id = s.id) as kinds,
               (select coalesce(sum(r.total_minor), 0) from refunds r
                where r.sale_id = s.id and r.status = 'completed')::text as refunded,
               c.full_name as customer_name
        from sales s left join users u on u.id = s.user_id left join customers c on c.id = s.customer_id
        where ${where}
        order by s.created_at desc, s.id desc limit ${limit} offset ${offset}`)
    ).rows as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r['id'] as string,
      receiptNumber: r['receipt_number'] as string,
      branchId: r['branch_id'] as string,
      cashierName: (r['full_name'] as string | null) ?? '',
      createdAt: iso(r['created_at']),
      total: money(r['total'] as string),
      itemCount: formatQuantity(parseQuantity(r['items'] as string)),
      paymentKinds: r['kinds'] as string[],
      refunded: money(r['refunded'] as string),
      customerName: (r['customer_name'] as string | null) ?? null,
      serviceType: (r['service_type'] as SaleSummary['serviceType']) ?? null,
      channel: r['channel'] as SaleSummary['channel'],
    }));
  }
}
