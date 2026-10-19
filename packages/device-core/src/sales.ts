import type { DeviceRecord, DiscountInput, OverridablePermission } from '@arabat/contracts';
import {
  Money,
  MoneyError,
  type PricedCart,
  PricingError,
  QuantityError,
  formatQuantity,
  parseQuantity,
  priceCart,
} from '@arabat/money';
import {
  type CatalogPrice,
  type CheckedPayment,
  type PaymentInput,
  PosRuleError,
  type SaleLine,
  assertDifferentSupervisor,
  assertSellingRights,
  checkPayments,
  createRightCheck,
  evaluateSale,
  formatDeviceReceiptNumber,
  lendableRights,
  requiredSaleRights,
  toDiscount,
} from '@arabat/pos-core';
import type { BridgeDb, SqlStatement } from './bridge.js';
import type { Catalog, CatalogItem } from './catalog.js';
import { newId, nowIso } from './ids.js';
import { enqueueStatement } from './outbox.js';
import { META, getMeta } from './schema.js';
import {
  type DevicePaymentMethod,
  type LocalContext,
  type StaffMember,
  holds,
} from './snapshot.js';
import { type LocalShift, assertShiftUsable, getShift } from './shifts.js';

export type SaleRecord = Extract<DeviceRecord, { kind: 'sale' }>;

export interface CartLine {
  key: string;
  variantId: string;
  /** Decimal string, e.g. "2" or "1.250". */
  quantity: string;
  /** A changed price (KWD decimal string), or null for the list price. */
  priceOverride: string | null;
  priceOverrideReason: string | null;
  discount: DiscountInput | null;
}

export interface Cart {
  lines: CartLine[];
  orderDiscount: DiscountInput | null;
}

export const EMPTY_CART: Cart = { lines: [], orderDiscount: null };

const toMinor = (value: string) => Money.parse(value, 'KWD').minor;

function toSaleLines(cart: Cart): SaleLine[] {
  return cart.lines.map((l, i) => ({
    variantId: l.variantId,
    quantityMilli: parseQuantity(l.quantity),
    priceOverrideMinor: l.priceOverride === null ? null : toMinor(l.priceOverride),
    priceOverrideReason: l.priceOverrideReason,
    discount: toDiscount(l.discount, `lines.${i}.discount`),
    extraMinor: 0n,
  }));
}

function catalogPrices(catalog: Catalog): Map<string, CatalogPrice> {
  return new Map(
    [...catalog.items].map(([id, i]) => [id, { priceMinor: i.priceMinor, costMinor: i.costMinor }]),
  );
}

export type CartPricing =
  { ok: true; cart: PricedCart } | { ok: false; line: number | null; code: string };

/** Prices the cart for display with the shared function; refusals come later at checkout. */
export function priceCartLines(cart: Cart, catalog: Catalog): CartPricing {
  try {
    const lines = toSaleLines(cart);
    return {
      ok: true,
      cart: priceCart(
        lines.map((l) => ({
          unitPriceMinor: l.priceOverrideMinor ?? catalog.items.get(l.variantId)!.priceMinor,
          quantityMilli: l.quantityMilli,
          discount: l.discount,
        })),
        toDiscount(cart.orderDiscount, 'orderDiscount'),
      ),
    };
  } catch (error) {
    if (error instanceof PricingError) return { ok: false, line: error.line, code: error.code };
    if (error instanceof MoneyError || error instanceof PosRuleError)
      return { ok: false, line: null, code: 'INVALID_PRICE' };
    if (error instanceof QuantityError) return { ok: false, line: null, code: 'INVALID_QUANTITY' };
    throw error;
  }
}

/** The overridable rights the cart needs and the cashier lacks (ask a supervisor for these). */
export function missingRights(
  cart: Cart,
  catalog: Catalog,
  ctx: LocalContext,
  cashier: StaffMember,
): OverridablePermission[] {
  try {
    const needed =
      requiredSaleRights(
        toSaleLines(cart),
        toDiscount(cart.orderDiscount, 'orderDiscount'),
        catalogPrices(catalog),
        ctx.settings.maxDiscountPercent,
      ) ?? [];
    return needed.filter((r) => !holds(cashier, r));
  } catch {
    return [];
  }
}

/** The rights a supervisor present at the till can lend for this sale (BR-177). */
export function supervisorRights(
  supervisor: StaffMember,
  cashier: StaffMember,
): OverridablePermission[] {
  assertDifferentSupervisor(supervisor.userId, cashier.userId);
  return lendableRights(
    (p) => holds(supervisor, p),
    (p) => holds(cashier, p),
  );
}

export interface SaleInput {
  cart: Cart;
  payments: PaymentInput[];
  cashier: StaffMember;
  shift: LocalShift;
  /** A supervisor who typed their PIN, with the rights they lend and a note. */
  supervisor: { member: StaffMember; rights: OverridablePermission[]; note: string | null } | null;
  zeroTotalReason: string | null;
  requestRemotePrint?: boolean;
}

export interface PreparedSale {
  record: Omit<SaleRecord, 'receiptNumber'>;
  priced: PricedCart;
  payments: CheckedPayment[];
  items: CatalogItem[];
  changeMinor: bigint;
  cashierUserId: string;
}

/**
 * Decides the sale exactly as the server would (DEVICE_API.md §4–5): rights, prices and limits
 * with `@arabat/pos-core`, tenders with `checkPayments`. The device prices the sale itself, so
 * `expectedTotalMinor` is null. Nothing is written yet: see `commitSale`.
 */
export function prepareSale(
  input: SaleInput,
  ctx: LocalContext,
  catalog: Catalog,
  methods: readonly DevicePaymentMethod[],
  now: Date = new Date(),
): PreparedSale {
  const { cart, cashier } = input;
  if (!holds(cashier, 'pos.access') || !holds(cashier, 'sales.create'))
    throw new PosRuleError(403, 'FORBIDDEN', 'You are not allowed to sell.');
  if (input.shift.status !== 'open')
    throw new PosRuleError(409, 'SHIFT_REQUIRED', 'Open a shift first.');
  if (cart.lines.length === 0)
    throw PosRuleError.validation([
      { path: 'lines', code: 'empty', message: 'The cart is empty.' },
    ]);
  const lines = toSaleLines(cart);
  const orderDiscount = toDiscount(cart.orderDiscount, 'orderDiscount');
  const grant = input.supervisor
    ? supervisorRights(input.supervisor.member, cashier).filter((r) =>
        input.supervisor!.rights.includes(r),
      )
    : null;
  const { allowed, supplied } = createRightCheck((p) => holds(cashier, p), grant);
  assertSellingRights(lines, orderDiscount, allowed);
  const { priced, aboveLimit } = evaluateSale({
    lines,
    orderDiscount,
    catalog: catalogPrices(catalog),
    policy: ctx.settings,
    allowed,
    zeroTotalReason: input.zeroTotalReason,
    expectedTotalMinor: null,
  });
  const methodMap = new Map(
    methods.map((m) => [
      m.id,
      {
        ...m,
        feeFixedMinor: BigInt(m.feeFixedMinor),
      },
    ]),
  );
  const payments = checkPayments(
    input.payments,
    methodMap,
    priced.totalMinor,
    ctx.settings.requireTenderReference,
  );
  const items = lines.map((l) => catalog.items.get(l.variantId)!);
  const record: Omit<SaleRecord, 'receiptNumber'> = {
    kind: 'sale',
    id: newId(),
    occurredAt: nowIso(now),
    membershipId: cashier.membershipId,
    shiftId: input.shift.id,
    catalogVersion: ctx.catalogVersion,
    lines: lines.map((l, i) => {
      const p = priced.lines[i]!;
      const listUnit = items[i]!.priceMinor;
      return {
        variantId: l.variantId,
        quantity: formatQuantity(l.quantityMilli),
        listUnitPriceMinor: listUnit.toString(),
        unitPriceMinor: (l.priceOverrideMinor ?? listUnit).toString(),
        priceOverrideReason:
          l.priceOverrideMinor !== null && l.priceOverrideMinor !== listUnit
            ? l.priceOverrideReason
            : null,
        discount: cart.lines[i]!.discount,
        grossMinor: p.grossMinor.toString(),
        lineDiscountMinor: p.lineDiscountMinor.toString(),
        orderDiscountMinor: p.orderDiscountMinor.toString(),
        netMinor: p.netMinor.toString(),
      };
    }),
    orderDiscount: cart.orderDiscount,
    subtotalMinor: priced.subtotalMinor.toString(),
    lineDiscountsMinor: priced.lineDiscountsMinor.toString(),
    orderDiscountMinor: priced.orderDiscountMinor.toString(),
    totalMinor: priced.totalMinor.toString(),
    payments: payments.map((p) => ({
      id: newId(),
      methodId: p.method.id,
      amountMinor: p.amountMinor.toString(),
      tenderedMinor: p.tenderedMinor === null ? null : p.tenderedMinor.toString(),
      changeMinor: p.changeMinor.toString(),
      feeMinor: p.feeMinor.toString(),
      reference: p.reference,
    })),
    aboveLimit,
    zeroTotalReason: priced.totalMinor === 0n ? input.zeroTotalReason : null,
    override:
      input.supervisor && supplied.size > 0
        ? {
            approverMembershipId: input.supervisor.member.membershipId,
            rights: [...supplied],
            note: input.supervisor.note,
          }
        : null,
    requestRemotePrint: input.requestRemotePrint ?? false,
  };
  return {
    record,
    priced,
    payments,
    items,
    changeMinor: payments.reduce((s, p) => s + p.changeMinor, 0n),
    cashierUserId: cashier.userId,
  };
}

/** One sale is written at a time: the receipt counter is taken under this lock. */
let saleLock: Promise<unknown> = Promise.resolve();

export interface CommittedSale {
  saleId: string;
  receiptNumber: string;
  record: SaleRecord;
  changeMinor: bigint;
}

/**
 * Writes the sale, its lines, payments and outbox record and takes the next receipt number in
 * the SAME transaction (ADR-0112 §4): the counter row is updated only if it still holds the value
 * read, and the `guard` insert fails the transaction otherwise, so the series is gap-free even
 * when a statement fails or two sales race.
 */
export function commitSale(
  db: BridgeDb,
  prepared: PreparedSale,
  ctx: LocalContext,
  now: Date = new Date(),
): Promise<CommittedSale> {
  const run = async (): Promise<CommittedSale> => {
    // Nothing piles up behind a shift the server refused (amendment 3).
    const shift = await getShift(db, prepared.record.shiftId);
    if (!shift) throw new PosRuleError(409, 'SHIFT_REQUIRED', 'Open a shift first.');
    await assertShiftUsable(db, shift);
    const current = Number((await getMeta(db, META.receiptCounter)) ?? '0');
    const next = current + 1;
    const receiptNumber = formatDeviceReceiptNumber(ctx.branch.code, ctx.register.code, next);
    const record: SaleRecord = { ...prepared.record, receiptNumber };
    const at = nowIso(now);
    const r = record;
    const statements: SqlStatement[] = [
      {
        sql: `UPDATE meta SET value = ? WHERE key = ? AND value = ?`,
        params: [String(next), META.receiptCounter, String(current)],
      },
      // A counter that is not `next` now means another sale took the number: fail (CHECK x = 1).
      {
        sql: `INSERT INTO guard (x) SELECT 0 WHERE (SELECT value FROM meta WHERE key = ?) IS NOT ?`,
        params: [META.receiptCounter, String(next)],
      },
      {
        sql: `INSERT INTO sales (id, shift_id, membership_id, user_id, receipt_number, receipt_seq, occurred_at, subtotal_minor,
                line_discounts_minor, order_discount_minor, total_minor, change_minor, above_limit, catalog_version,
                zero_total_reason, supervisor_membership_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          r.id,
          r.shiftId,
          r.membershipId,
          prepared.cashierUserId,
          receiptNumber,
          next,
          r.occurredAt,
          r.subtotalMinor,
          r.lineDiscountsMinor,
          r.orderDiscountMinor,
          r.totalMinor,
          prepared.changeMinor.toString(),
          r.aboveLimit ? 1 : 0,
          r.catalogVersion,
          r.zeroTotalReason,
          r.override?.approverMembershipId ?? null,
        ],
      },
      ...r.lines.map((l, i) => {
        const item = prepared.items[i]!;
        return {
          sql: `INSERT INTO sale_lines (sale_id, position, variant_id, name_en, name_ar, variant_name_en, variant_name_ar, sku, quantity,
                  list_unit_price_minor, unit_price_minor, gross_minor, line_discount_minor, order_discount_minor, net_minor, track_inventory)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            r.id,
            i,
            l.variantId,
            item.nameEn,
            item.nameAr,
            item.variantNameEn,
            item.variantNameAr,
            item.sku,
            l.quantity,
            l.listUnitPriceMinor,
            l.unitPriceMinor,
            l.grossMinor,
            l.lineDiscountMinor,
            l.orderDiscountMinor,
            l.netMinor,
            item.trackInventory ? 1 : 0,
          ],
        };
      }),
      ...r.payments.map((p, i) => {
        const checked = prepared.payments[i]!;
        return {
          sql: `INSERT INTO payments (id, sale_id, method_id, method_kind, name_en, name_ar, amount_minor, tendered_minor, change_minor, fee_minor, reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            p.id,
            r.id,
            p.methodId,
            checked.method.kind,
            checked.method.nameEn,
            checked.method.nameAr,
            p.amountMinor,
            p.tenderedMinor,
            p.changeMinor,
            p.feeMinor,
            p.reference,
          ],
        };
      }),
      enqueueStatement(record, at),
    ];
    await db.transaction(statements);
    return { saleId: r.id, receiptNumber, record, changeMinor: prepared.changeMinor };
  };
  const next = saleLock.then(run, run);
  saleLock = next.catch(() => {});
  return next;
}

export interface LocalSale {
  id: string;
  shiftId: string;
  membershipId: string;
  userId: string;
  receiptNumber: string;
  occurredAt: string;
  subtotalMinor: bigint;
  lineDiscountsMinor: bigint;
  orderDiscountMinor: bigint;
  totalMinor: bigint;
  changeMinor: bigint;
  lines: {
    position: number;
    variantId: string;
    nameEn: string | null;
    nameAr: string | null;
    variantNameEn: string | null;
    variantNameAr: string | null;
    sku: string | null;
    quantity: string;
    listUnitPriceMinor: bigint;
    unitPriceMinor: bigint;
    grossMinor: bigint;
    lineDiscountMinor: bigint;
    netMinor: bigint;
    trackInventory: boolean;
  }[];
  payments: {
    id: string;
    methodId: string;
    kind: string;
    nameEn: string | null;
    nameAr: string | null;
    amountMinor: bigint;
    tenderedMinor: bigint | null;
    changeMinor: bigint;
  }[];
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function getSale(db: BridgeDb, saleId: string): Promise<LocalSale | null> {
  const [s] = await db.query(`SELECT * FROM sales WHERE id = ?`, [saleId]);
  if (!s) return null;
  const lines = await db.query(`SELECT * FROM sale_lines WHERE sale_id = ? ORDER BY position`, [
    saleId,
  ]);
  const payments = await db.query(`SELECT * FROM payments WHERE sale_id = ? ORDER BY rowid`, [
    saleId,
  ]);
  return {
    id: String(s['id']),
    shiftId: String(s['shift_id']),
    membershipId: String(s['membership_id']),
    userId: String(s['user_id']),
    receiptNumber: String(s['receipt_number']),
    occurredAt: String(s['occurred_at']),
    subtotalMinor: BigInt(String(s['subtotal_minor'])),
    lineDiscountsMinor: BigInt(String(s['line_discounts_minor'])),
    orderDiscountMinor: BigInt(String(s['order_discount_minor'])),
    totalMinor: BigInt(String(s['total_minor'])),
    changeMinor: BigInt(String(s['change_minor'])),
    lines: lines.map((l) => ({
      position: Number(l['position']),
      variantId: String(l['variant_id']),
      nameEn: str(l['name_en']),
      nameAr: str(l['name_ar']),
      variantNameEn: str(l['variant_name_en']),
      variantNameAr: str(l['variant_name_ar']),
      sku: str(l['sku']),
      quantity: String(l['quantity']),
      listUnitPriceMinor: BigInt(String(l['list_unit_price_minor'])),
      unitPriceMinor: BigInt(String(l['unit_price_minor'])),
      grossMinor: BigInt(String(l['gross_minor'])),
      lineDiscountMinor: BigInt(String(l['line_discount_minor'])),
      netMinor: BigInt(String(l['net_minor'])),
      trackInventory: l['track_inventory'] === 1,
    })),
    payments: payments.map((p) => ({
      id: String(p['id']),
      methodId: String(p['method_id']),
      kind: String(p['method_kind']),
      nameEn: str(p['name_en']),
      nameAr: str(p['name_ar']),
      amountMinor: BigInt(String(p['amount_minor'])),
      tenderedMinor: p['tendered_minor'] === null ? null : BigInt(String(p['tendered_minor'])),
      changeMinor: BigInt(String(p['change_minor'])),
    })),
  };
}

/** The device's recent sales (newest first), for the sales list and refunds. */
export async function listSales(
  db: BridgeDb,
  options: { shiftId?: string; search?: string; limit?: number } = {},
) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (options.shiftId) {
    where.push(`shift_id = ?`);
    params.push(options.shiftId);
  }
  if (options.search) {
    where.push(`upper(receipt_number) LIKE ?`);
    params.push(`%${options.search.toUpperCase()}%`);
  }
  params.push(options.limit ?? 50);
  const rows = await db.query(
    `SELECT s.id, s.receipt_number, s.occurred_at, s.total_minor, s.membership_id,
            (SELECT coalesce(sum(CAST(total_minor AS INTEGER)), 0) FROM refunds r WHERE r.sale_id = s.id) AS refunded
     FROM sales s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.receipt_seq DESC LIMIT ?`,
    params,
  );
  return rows.map((r) => ({
    id: String(r['id']),
    receiptNumber: String(r['receipt_number']),
    occurredAt: String(r['occurred_at']),
    totalMinor: BigInt(String(r['total_minor'])),
    refundedMinor: BigInt(String(r['refunded'])),
    membershipId: String(r['membership_id']),
  }));
}
