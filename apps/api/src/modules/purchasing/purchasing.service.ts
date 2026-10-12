import type {
  PurchaseOrder,
  Supplier,
  purchaseOrderListQuerySchema,
  receivePurchaseSchema,
  savePurchaseOrderSchema,
  saveSupplierSchema,
} from '@arabat/contracts';
import { Money, formatQuantity, parseQuantity, quantityValue } from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, and, asc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { parseAmount } from '../payments/payments.service.js';
import {
  purchaseOrderLines,
  purchaseOrders,
  purchaseReceiptLines,
  purchaseReceipts,
  suppliers,
} from './purchasing.schema.js';

type SaveSupplier = z.output<typeof saveSupplierSchema>;
type SaveOrder = z.output<typeof savePurchaseOrderSchema>;
type ReceiveInput = z.output<typeof receivePurchaseSchema>;
type ListQuery = z.output<typeof purchaseOrderListQuerySchema>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Loads stock-tracked, active variants for document lines; refuses anything else. */
export async function assertStockItems(tx: Transaction, variantIds: string[]) {
  const unique = [...new Set(variantIds)];
  const rows = (
    await tx.execute(sql`
      select v.id from product_variants v join products p on p.id = v.product_id
      where v.id in (${sql.join(
        unique.map((id) => sql`${id}`),
        sql`, `,
      )}) and p.track_inventory and v.status = 'active' and p.status = 'active'`)
  ).rows as { id: string }[];
  const found = new Set(rows.map((r) => r.id));
  const issues = variantIds.flatMap((id, i) =>
    found.has(id)
      ? []
      : [
          {
            path: `lines.${i}.variantId`,
            code: 'not_tracked',
            message: 'Not an active stock item.',
          },
        ],
  );
  if (issues.length)
    throw new AppError(409, 'NOT_STOCK_TRACKED', 'Some items are not active stock items.', issues);
}

/**
 * Suppliers and purchase orders (Prompt 12). Receiving goes through the inventory ledger
 * (`purchase_receipt` movements at the order's cost, updating the weighted average). The
 * order row is locked while receiving, and received quantities are derived from the
 * receipts, so partial deliveries can never exceed the order or be counted twice.
 */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedgerService,
  ) {}

  // ------------------------------------------------------------ suppliers
  async listSuppliers(actor: MerchantActor): Promise<Supplier[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select s.*,
                 (select count(*)::int from purchase_orders o where o.supplier_id = s.id and o.status <> 'cancelled') as order_count,
                 (select coalesce(sum(round(rl.quantity * rl.unit_cost_minor)), 0)
                  from purchase_receipt_lines rl join purchase_receipts r on r.id = rl.receipt_id
                  join purchase_orders o on o.id = r.purchase_order_id where o.supplier_id = s.id)::text as purchased
          from suppliers s order by coalesce(lower(s.name_en), s.name_ar)`)
      ).rows as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r['id'] as string,
        code: (r['code'] as string | null) ?? null,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        contactName: (r['contact_name'] as string | null) ?? null,
        phone: (r['phone'] as string | null) ?? null,
        email: (r['email'] as string | null) ?? null,
        address: (r['address'] as string | null) ?? null,
        taxNumber: (r['tax_number'] as string | null) ?? null,
        paymentTerms: (r['payment_terms'] as string | null) ?? null,
        notes: (r['notes'] as string | null) ?? null,
        status: r['status'] as Supplier['status'],
        orderCount: r['order_count'] as number,
        purchasedTotal: money(r['purchased'] as string),
        version: r['version'] as number,
      }));
    });
  }

  async saveSupplier(
    actor: MerchantActor,
    id: string | null,
    input: SaveSupplier,
    ip: string,
  ): Promise<Supplier> {
    assertCan(actor, 'purchasing.manage', null);
    const supplierId = id ?? newId();
    const { version, ...fields } = input;
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        if (id) {
          if (!version)
            throw AppError.validation([
              { path: 'version', code: 'required', message: 'version is required' },
            ]);
          const [row] = await tx
            .update(suppliers)
            .set({ ...fields, version: sql`${suppliers.version} + 1`, updatedAt: sql`now()` })
            .where(and(eq(suppliers.id, id), eq(suppliers.version, version)))
            .returning({ id: suppliers.id });
          if (!row) {
            const [exists] = await tx
              .select({ id: suppliers.id })
              .from(suppliers)
              .where(eq(suppliers.id, id));
            if (!exists) throw AppError.notFound();
            throw versionConflict();
          }
        } else {
          await tx
            .insert(suppliers)
            .values({ id: supplierId, merchantId: actor.merchantId, ...fields });
        }
        await this.record(
          tx,
          actor,
          id ? 'supplier.updated' : 'supplier.created',
          'supplier',
          supplierId,
          ip,
          {
            status: fields.status,
          },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'suppliers_code_key'))
        throw new AppError(409, 'DUPLICATE_CODE', 'A supplier with this code already exists.');
      throw error;
    }
    return (await this.listSuppliers(actor)).find((s) => s.id === supplierId)!;
  }

  // ------------------------------------------------------------ purchase orders
  private scope(actor: MerchantActor, branchId?: string): SQL {
    if (branchId) {
      assertCan(actor, 'purchasing.read', branchId);
      return sql`o.branch_id = ${branchId}`;
    }
    const s = permissionBranchScope(actor.access, 'purchasing.read');
    if (s.all) return sql`true`;
    if (s.branchIds.length === 0) throw AppError.forbidden();
    return sql`o.branch_id in (${sql.join(
      s.branchIds.map((b) => sql`${b}`),
      sql`, `,
    )})`;
  }

  async listOrders(actor: MerchantActor, query: ListQuery) {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const c: SQL[] = [this.scope(actor, query.branchId)];
      if (query.supplierId) c.push(sql`o.supplier_id = ${query.supplierId}`);
      if (query.status) c.push(sql`o.status = ${query.status}`);
      const where = sql.join(c, sql` and `);
      const [total] = (
        await tx.execute(sql`select count(*)::int as n from purchase_orders o where ${where}`)
      ).rows as { n: number }[];
      const ids = (
        await tx.execute(sql`select o.id from purchase_orders o where ${where} order by o.created_at desc, o.id desc
                             limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as { id: string }[];
      const orders = [];
      for (const { id } of ids) {
        const { lines: _l, receipts: _r, ...rest } = await this.loadOrder(tx, id);
        orders.push(rest);
      }
      return { orders, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async getOrder(actor: MerchantActor, id: string): Promise<PurchaseOrder> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const order = await this.loadOrder(tx, id);
      assertCan(actor, 'purchasing.read', order.branchId);
      return order;
    });
  }

  private parseLines(lines: SaveOrder['lines']) {
    return lines.map((l, i) => {
      const quantityMilli = parseQuantity(l.quantity);
      if (quantityMilli <= 0n)
        throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive.', [
          { path: `lines.${i}.quantity`, code: 'too_small', message: 'Quantity must be positive.' },
        ]);
      return {
        variantId: l.variantId,
        quantityMilli,
        unitCostMinor: parseAmount(l.unitCost, `lines.${i}.unitCost`),
      };
    });
  }

  async createOrder(actor: MerchantActor, input: SaveOrder, ip: string): Promise<PurchaseOrder> {
    assertCan(actor, 'purchasing.manage', input.branchId);
    const lines = this.parseLines(input.lines);
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.assertSupplierActive(tx, input.supplierId);
      await this.assertBranch(tx, input.branchId);
      await assertStockItems(
        tx,
        lines.map((l) => l.variantId),
      );
      const number = await nextDocumentNumber(tx, actor.merchantId, 'purchase_order', 'PO');
      await tx.insert(purchaseOrders).values({
        id,
        merchantId: actor.merchantId,
        number,
        supplierId: input.supplierId,
        branchId: input.branchId,
        expectedDate: input.expectedDate,
        note: input.note,
        createdByUserId: actor.userId,
      });
      await this.insertLines(tx, actor.merchantId, id, lines);
      await this.record(tx, actor, 'purchase_order.created', 'purchase_order', id, ip, { number });
    });
    return this.getOrder(actor, id);
  }

  async updateOrder(
    actor: MerchantActor,
    id: string,
    input: SaveOrder,
    ip: string,
  ): Promise<PurchaseOrder> {
    const lines = this.parseLines(input.lines);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const order = await this.lock(tx, id, input.version);
      assertCan(actor, 'purchasing.manage', order.branchId);
      assertCan(actor, 'purchasing.manage', input.branchId);
      if (order.status !== 'draft') throw this.state('Only draft orders can be edited.');
      await this.assertSupplierActive(tx, input.supplierId);
      await this.assertBranch(tx, input.branchId);
      await assertStockItems(
        tx,
        lines.map((l) => l.variantId),
      );
      await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
      await this.insertLines(tx, actor.merchantId, id, lines);
      await tx
        .update(purchaseOrders)
        .set({
          supplierId: input.supplierId,
          branchId: input.branchId,
          expectedDate: input.expectedDate,
          note: input.note,
          version: sql`${purchaseOrders.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(purchaseOrders.id, id));
      await this.record(tx, actor, 'purchase_order.updated', 'purchase_order', id, ip);
    });
    return this.getOrder(actor, id);
  }

  async transition(
    actor: MerchantActor,
    id: string,
    action: 'submit' | 'approve' | 'cancel' | 'close',
    version: number,
    reason: string | null,
    ip: string,
  ): Promise<PurchaseOrder> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const order = await this.lock(tx, id, version);
      const set: Partial<typeof purchaseOrders.$inferInsert> = {};
      if (action === 'submit') {
        assertCan(actor, 'purchasing.manage', order.branchId);
        if (order.status !== 'draft') throw this.state('Only drafts can be submitted.');
        Object.assign(set, { status: 'submitted', submittedAt: sql`now()` });
      } else if (action === 'approve') {
        assertCan(actor, 'purchasing.approve', order.branchId);
        if (order.status !== 'submitted')
          throw this.state('Only submitted orders can be approved.');
        if (order.createdByUserId === actor.userId && !actor.access.isOwner)
          throw new AppError(
            403,
            'SELF_APPROVAL',
            'Another person must approve your purchase order.',
          );
        Object.assign(set, {
          status: 'approved',
          approvedByUserId: actor.userId,
          approvedAt: sql`now()`,
        });
      } else if (action === 'cancel') {
        if (
          !can(actor.access, 'purchasing.manage', order.branchId) &&
          !can(actor.access, 'purchasing.approve', order.branchId)
        )
          throw AppError.forbidden();
        if (!['draft', 'submitted', 'approved'].includes(order.status))
          throw this.state('Orders with deliveries cannot be cancelled; close them instead.');
        Object.assign(set, {
          status: 'cancelled',
          closedByUserId: actor.userId,
          closedAt: sql`now()`,
          closeReason: reason,
        });
      } else {
        assertCan(actor, 'purchasing.approve', order.branchId);
        if (order.status !== 'partially_received')
          throw this.state('Only partially received orders can be closed.');
        if (!reason)
          throw AppError.validation([
            { path: 'reason', code: 'required', message: 'A reason is required.' },
          ]);
        Object.assign(set, {
          status: 'closed',
          closedByUserId: actor.userId,
          closedAt: sql`now()`,
          closeReason: reason,
        });
      }
      await tx
        .update(purchaseOrders)
        .set({ ...set, version: sql`${purchaseOrders.version} + 1`, updatedAt: sql`now()` })
        .where(eq(purchaseOrders.id, id));
      await this.record(
        tx,
        actor,
        `purchase_order.${action === 'submit' ? 'submitted' : action === 'approve' ? 'approved' : action === 'cancel' ? 'cancelled' : 'closed'}`,
        'purchase_order',
        id,
        ip,
        { reason },
      );
    });
    return this.getOrder(actor, id);
  }

  async receive(
    actor: MerchantActor,
    id: string,
    input: ReceiveInput,
    ip: string,
  ): Promise<PurchaseOrder> {
    const hash = createHash('sha256')
      .update(JSON.stringify({ ...input, idempotencyKey: undefined, id }))
      .digest('hex');
    const replay = await this.receiptReplay(actor, input.idempotencyKey, hash);
    if (replay) return this.getOrder(actor, replay);
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        // The order row lock serializes deliveries: received quantities cannot be counted twice.
        const order = await this.lock(tx, id, null);
        assertCan(actor, 'purchasing.receive', order.branchId);
        if (!['approved', 'partially_received'].includes(order.status))
          throw this.state('Only approved orders can be received.');
        const state = await this.lineState(tx, id);
        const lines = input.lines.map((l, i) => {
          const line = state.find((s) => s.position === l.position);
          if (!line)
            throw AppError.validation([
              { path: `lines.${i}.position`, code: 'not_found', message: 'Not an order line.' },
            ]);
          const q = parseQuantity(l.quantity);
          if (q <= 0n) throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive.');
          if (q > line.orderedMilli - line.receivedMilli)
            throw new AppError(
              409,
              'RECEIVE_EXCEEDS_ORDER',
              'More than is still open on the order.',
              [
                {
                  path: `lines.${i}.quantity`,
                  code: 'too_big',
                  message: `remaining=${formatQuantity(line.orderedMilli - line.receivedMilli)}`,
                },
              ],
            );
          return { ...line, quantityMilli: q };
        });
        if (new Set(lines.map((l) => l.position)).size !== lines.length)
          throw AppError.validation([
            { path: 'lines', code: 'duplicate', message: 'Each line may appear only once.' },
          ]);
        const receiptId = newId();
        const number = await nextDocumentNumber(tx, actor.merchantId, 'purchase_receipt', 'GR');
        await tx.insert(purchaseReceipts).values({
          id: receiptId,
          merchantId: actor.merchantId,
          number,
          purchaseOrderId: id,
          branchId: order.branchId,
          note: input.note,
          supplierReference: input.supplierReference,
          idempotencyKey: input.idempotencyKey,
          requestHash: hash,
          receivedByUserId: actor.userId,
        });
        await tx.insert(purchaseReceiptLines).values(
          lines.map((l) => ({
            merchantId: actor.merchantId,
            receiptId,
            orderPosition: l.position,
            variantId: l.variantId,
            quantity: formatQuantity(l.quantityMilli),
            unitCostMinor: l.unitCostMinor,
          })),
        );
        // The one inventory engine: stock rises at the purchase cost.
        await this.ledger.apply(
          tx,
          {
            merchantId: actor.merchantId,
            branchId: order.branchId,
            movementType: 'purchase_receipt',
            sourceType: 'purchase_receipt',
            sourceId: receiptId,
            note: number,
            userId: actor.userId,
          },
          lines.map((l) => ({
            variantId: l.variantId,
            mode: 'delta' as const,
            quantityMilli: l.quantityMilli,
            unitCostMinor: l.unitCostMinor,
          })),
        );
        const after = await this.lineState(tx, id);
        const complete = after.every((l) => l.receivedMilli >= l.orderedMilli);
        await tx
          .update(purchaseOrders)
          .set({
            status: complete ? 'received' : 'partially_received',
            version: sql`${purchaseOrders.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(purchaseOrders.id, id));
        await this.record(tx, actor, 'purchase_order.received', 'purchase_order', id, ip, {
          receipt: number,
          lines: lines.map((l) => ({
            position: l.position,
            quantity: formatQuantity(l.quantityMilli),
          })),
          complete,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'purchase_receipts_idempotency_key')) {
        const again = await this.receiptReplay(actor, input.idempotencyKey, hash);
        if (again) return this.getOrder(actor, again);
      }
      throw error;
    }
    return this.getOrder(actor, id);
  }

  private async receiptReplay(
    actor: MerchantActor,
    key: string,
    hash: string,
  ): Promise<string | null> {
    const [row] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      tx
        .select({ orderId: purchaseReceipts.purchaseOrderId, hash: purchaseReceipts.requestHash })
        .from(purchaseReceipts)
        .where(eq(purchaseReceipts.idempotencyKey, key)),
    );
    if (!row) return null;
    if (row.hash !== hash)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This key was already used for another delivery.',
      );
    return row.orderId;
  }

  // ------------------------------------------------------------ helpers
  private state(message: string) {
    return new AppError(409, 'INVALID_STATE', message);
  }

  private async lock(tx: Transaction, id: string, version: number | null | undefined) {
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .for('update');
    if (!order) throw AppError.notFound();
    if (version !== null && version !== undefined && order.version !== version)
      throw versionConflict();
    return order;
  }

  private async assertSupplierActive(tx: Transaction, supplierId: string) {
    const [s] = await tx
      .select({ status: suppliers.status })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    if (!s) throw AppError.notFound('Supplier not found.');
    if (s.status !== 'active')
      throw new AppError(409, 'SUPPLIER_INACTIVE', 'This supplier is inactive.');
  }

  private async assertBranch(tx: Transaction, branchId: string) {
    const [b] = (await tx.execute(sql`select status from branches where id = ${branchId}`))
      .rows as { status: string }[];
    if (!b) throw AppError.notFound('Branch not found.');
    if (b.status !== 'active')
      throw new AppError(409, 'BRANCH_INACTIVE', 'This branch is inactive.');
  }

  private async insertLines(
    tx: Transaction,
    merchantId: string,
    orderId: string,
    lines: { variantId: string; quantityMilli: bigint; unitCostMinor: bigint }[],
  ) {
    await tx.insert(purchaseOrderLines).values(
      lines.map((l, position) => ({
        merchantId,
        purchaseOrderId: orderId,
        position,
        variantId: l.variantId,
        quantity: formatQuantity(l.quantityMilli),
        unitCostMinor: l.unitCostMinor,
      })),
    );
  }

  private async lineState(tx: Transaction, orderId: string) {
    const rows = (
      await tx.execute(sql`
        select l.position, l.variant_id, l.quantity::text as qty, l.unit_cost_minor::text as cost,
               coalesce((select sum(rl.quantity) from purchase_receipt_lines rl join purchase_receipts r on r.id = rl.receipt_id
                         where r.purchase_order_id = l.purchase_order_id and rl.order_position = l.position), 0)::text as received
        from purchase_order_lines l where l.purchase_order_id = ${orderId} order by l.position`)
    ).rows as Record<string, string | number>[];
    return rows.map((r) => ({
      position: r['position'] as number,
      variantId: r['variant_id'] as string,
      orderedMilli: parseQuantity(r['qty'] as string),
      receivedMilli: parseQuantity(r['received'] as string),
      unitCostMinor: BigInt(r['cost'] as string),
    }));
  }

  private async loadOrder(tx: Transaction, id: string): Promise<PurchaseOrder> {
    const [o] = (
      await tx.execute(sql`
        select o.*, s.name_en as s_en, s.name_ar as s_ar, cu.full_name as created_by, au.full_name as approved_by
        from purchase_orders o join suppliers s on s.id = o.supplier_id join users cu on cu.id = o.created_by_user_id
        left join users au on au.id = o.approved_by_user_id where o.id = ${id}`)
    ).rows as Record<string, unknown>[];
    if (!o) throw AppError.notFound();
    const state = await this.lineState(tx, id);
    const info = (
      await tx.execute(sql`
        select l.position, p.name_en, p.name_ar, v.name_en as v_en, v.name_ar as v_ar, v.sku
        from purchase_order_lines l join product_variants v on v.id = l.variant_id join products p on p.id = v.product_id
        where l.purchase_order_id = ${id}`)
    ).rows as Record<string, unknown>[];
    const byPos = new Map(info.map((r) => [r['position'] as number, r]));
    const receipts = (
      await tx.execute(sql`
        select r.id, r.number, r.created_at, r.supplier_reference, r.note, u.full_name
        from purchase_receipts r join users u on u.id = r.received_by_user_id
        where r.purchase_order_id = ${id} order by r.created_at, r.id`)
    ).rows as Record<string, unknown>[];
    const receiptLines = await tx
      .select()
      .from(purchaseReceiptLines)
      .innerJoin(purchaseReceipts, eq(purchaseReceipts.id, purchaseReceiptLines.receiptId))
      .where(eq(purchaseReceipts.purchaseOrderId, id))
      .orderBy(asc(purchaseReceiptLines.orderPosition));
    let total = 0n;
    let received = 0n;
    const lines = state.map((l) => {
      const lineTotal = quantityValue(l.orderedMilli, l.unitCostMinor);
      total += lineTotal;
      received += quantityValue(l.receivedMilli, l.unitCostMinor);
      const r = byPos.get(l.position)!;
      return {
        position: l.position,
        variantId: l.variantId,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        variantNameEn: (r['v_en'] as string | null) ?? null,
        variantNameAr: (r['v_ar'] as string | null) ?? null,
        sku: (r['sku'] as string | null) ?? null,
        quantity: formatQuantity(l.orderedMilli),
        receivedQuantity: formatQuantity(l.receivedMilli),
        remainingQuantity: formatQuantity(l.orderedMilli - l.receivedMilli),
        unitCost: money(l.unitCostMinor),
        total: money(lineTotal),
      };
    });
    return {
      id,
      number: o['number'] as string,
      supplierId: o['supplier_id'] as string,
      supplierName: {
        nameEn: (o['s_en'] as string | null) ?? null,
        nameAr: (o['s_ar'] as string | null) ?? null,
      },
      branchId: o['branch_id'] as string,
      status: o['status'] as PurchaseOrder['status'],
      expectedDate: o['expected_date'] ? String(o['expected_date']).slice(0, 10) : null,
      note: (o['note'] as string | null) ?? null,
      total: money(total),
      receivedValue: money(received),
      createdBy: o['created_by'] as string,
      approvedBy: (o['approved_by'] as string | null) ?? null,
      closeReason: (o['close_reason'] as string | null) ?? null,
      createdAt: iso(o['created_at'])!,
      lines,
      receipts: receipts.map((r) => ({
        id: r['id'] as string,
        number: r['number'] as string,
        receivedBy: r['full_name'] as string,
        createdAt: iso(r['created_at'])!,
        supplierReference: (r['supplier_reference'] as string | null) ?? null,
        note: (r['note'] as string | null) ?? null,
        lines: receiptLines
          .filter((x) => x.purchase_receipts.id === r['id'])
          .map((x) => ({
            position: x.purchase_receipt_lines.orderPosition,
            quantity: formatQuantity(parseQuantity(x.purchase_receipt_lines.quantity)),
          })),
      })),
      version: o['version'] as number,
    };
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
