import type {
  Floor,
  KitchenBoard,
  KitchenTicket,
  OrderQuote,
  OrderSummary,
  RestaurantOrder,
  Sale,
  addOrderItemsSchema,
  cancelOrderItemSchema,
  createRestaurantOrderSchema,
  payOrderSchema,
  quoteOrderSchema,
  ticketStatusSchema,
} from '@arabat/contracts';
import {
  Money,
  PricingError,
  formatQuantity,
  parseQuantity,
  priceCart,
  quantityValue,
} from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { stockConsumption } from '../inventory/consumption.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { parseAmount } from '../payments/payments.service.js';
import { ShiftsService } from '../registers/shifts.service.js';
import { type ParsedLine, SalesService } from '../sales/sales.service.js';
import { RestaurantConfigService } from './restaurant-config.service.js';
import {
  kitchenTickets,
  restaurantOrderItemModifiers,
  restaurantOrderItems,
  restaurantOrders,
} from './restaurant.schema.js';

type Row = Record<string, unknown>;
const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const TICKET_ORDER = { new: 0, preparing: 1, ready: 2, completed: 3, cancelled: 4 } as const;
const ITEM_FOR_TICKET = { preparing: 'preparing', ready: 'ready', completed: 'served' } as const;

const invalidState = (message: string) => new AppError(409, 'INVALID_STATE', message);

/**
 * Restaurant orders (Prompt 15). An order is a mutable intent document; money is recorded
 * only when a bill is paid, by the checkout engine (one immutable sale per bill), and stock
 * moves only then (or when a prepared item is cancelled as waste). Kitchen updates touch
 * tickets and item statuses only — never sales, payments or stock (ADR-0073/0074).
 */
@Injectable()
export class RestaurantOrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: RestaurantConfigService,
    private readonly sales: SalesService,
    private readonly shifts: ShiftsService,
    private readonly ledger: StockLedgerService,
  ) {}

  private posBranch(
    actor: MerchantActor,
    permission: 'restaurant.orders' | 'kitchen.access' = 'restaurant.orders',
  ) {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    assertCan(actor, permission, branchId);
    return branchId;
  }

  // ------------------------------------------------------------ reading
  private async itemRows(tx: Transaction, where: ReturnType<typeof sql>) {
    return (
      await tx.execute(sql`
        select i.*, i.quantity::text as qty, v.product_id, v.price_minor::text as price,
               p.name_en, p.name_ar, v.name_en as vn_en, v.name_ar as vn_ar,
               coalesce((select sum(m.price_minor) from restaurant_order_item_modifiers m where m.item_id = i.id), 0)::text as extra
        from restaurant_order_items i join product_variants v on v.id = i.variant_id
        join products p on p.id = v.product_id
        where ${where} order by i.position`)
    ).rows as Row[];
  }

  private lineTotal(r: Row): bigint {
    return quantityValue(
      parseQuantity(r['qty'] as string),
      BigInt(r['price'] as string) + BigInt(r['extra'] as string),
    );
  }

  private async summaries(tx: Transaction, where: ReturnType<typeof sql>): Promise<OrderSummary[]> {
    const orders = (
      await tx.execute(sql`
        select o.*, t.code as table_code from restaurant_orders o left join dining_tables t on t.id = o.table_id
        where ${where} order by o.opened_at`)
    ).rows as Row[];
    if (!orders.length) return [];
    const items = await this.itemRows(
      tx,
      sql`i.order_id in (${sql.join(
        orders.map((o) => sql`${o['id'] as string}`),
        sql`, `,
      )})`,
    );
    return orders.map((o) => {
      const own = items.filter(
        (i) => i['order_id'] === o['id'] && i['kitchen_status'] !== 'cancelled',
      );
      const unpaid = own.filter((i) => i['sale_id'] === null);
      return {
        id: o['id'] as string,
        number: o['number'] as string,
        orderType: o['order_type'] as OrderSummary['orderType'],
        tableId: (o['table_id'] as string | null) ?? null,
        tableCode: (o['table_code'] as string | null) ?? null,
        label: (o['label'] as string | null) ?? null,
        guests: (o['guests'] as number | null) ?? null,
        openedAt: iso(o['opened_at'])!,
        itemCount: own.length,
        due: money(unpaid.reduce((s, i) => s + this.lineTotal(i), 0n)),
        pending: own.filter((i) => i['kitchen_status'] === 'pending').length,
        inKitchen: own.filter((i) =>
          ['queued', 'preparing'].includes(i['kitchen_status'] as string),
        ).length,
        ready: own.filter((i) => i['kitchen_status'] === 'ready').length,
      };
    });
  }

  async orderIn(tx: Transaction, id: string, branchId: string): Promise<RestaurantOrder> {
    const [summary] = await this.summaries(tx, sql`o.id = ${id} and o.branch_id = ${branchId}`);
    if (!summary) throw AppError.notFound('Order not found.');
    const [o] = (
      await tx.execute(
        sql`select o.*, u.full_name from restaurant_orders o join users u on u.id = o.opened_by_user_id where o.id = ${id}`,
      )
    ).rows as Row[];
    const items = await this.itemRows(tx, sql`i.order_id = ${id}`);
    const mods = (
      await tx.execute(sql`
        select m.* from restaurant_order_item_modifiers m join restaurant_order_items i on i.id = m.item_id
        where i.order_id = ${id} order by m.name_en`)
    ).rows as Row[];
    const bills = (
      await tx.execute(sql`
        select s.id, s.receipt_number, s.total_minor::text as total, s.created_at from sales s
        where s.restaurant_order_id = ${id} order by s.created_at`)
    ).rows as Row[];
    return {
      ...summary,
      branchId,
      note: (o!['note'] as string | null) ?? null,
      status: o!['status'] as RestaurantOrder['status'],
      openedBy: o!['full_name'] as string,
      closedAt: iso(o!['closed_at']),
      items: items.map((i) => {
        const unit = BigInt(i['price'] as string) + BigInt(i['extra'] as string);
        return {
          id: i['id'] as string,
          position: i['position'] as number,
          variantId: i['variant_id'] as string,
          productId: i['product_id'] as string,
          nameEn: (i['name_en'] as string | null) ?? null,
          nameAr: (i['name_ar'] as string | null) ?? null,
          variantNameEn: (i['vn_en'] as string | null) ?? null,
          variantNameAr: (i['vn_ar'] as string | null) ?? null,
          quantity: formatQuantity(parseQuantity(i['qty'] as string)),
          note: (i['note'] as string | null) ?? null,
          modifiers: mods
            .filter((m) => m['item_id'] === i['id'])
            .map((m) => ({
              id: m['modifier_id'] as string,
              nameEn: (m['name_en'] as string | null) ?? null,
              nameAr: (m['name_ar'] as string | null) ?? null,
              price: money(m['price_minor'] as string),
            })),
          unitPrice: money(unit),
          lineTotal: money(this.lineTotal(i)),
          kitchenStatus: i['kitchen_status'] as RestaurantOrder['items'][number]['kitchenStatus'],
          saleId: (i['sale_id'] as string | null) ?? null,
          cancelReason: (i['cancel_reason'] as string | null) ?? null,
          wasted: (i['wasted'] as boolean | null) ?? null,
          version: i['version'] as number,
        };
      }),
      bills: bills.map((b) => ({
        saleId: b['id'] as string,
        receiptNumber: b['receipt_number'] as string,
        total: money(b['total'] as string),
        createdAt: iso(b['created_at'])!,
      })),
      paid: money(bills.reduce((s, b) => s + BigInt(b['total'] as string), 0n)),
      version: o!['version'] as number,
    };
  }

  async get(actor: MerchantActor, id: string): Promise<RestaurantOrder> {
    const branchId = this.posBranch(actor);
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.orderIn(tx, id, branchId));
  }

  async floor(actor: MerchantActor): Promise<Floor> {
    const branchId = this.posBranch(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.config.assertEnabled(tx);
      const layout = await this.config.layoutIn(tx, branchId);
      const open = await this.summaries(tx, sql`o.branch_id = ${branchId} and o.status = 'open'`);
      return {
        areas: layout.areas
          .filter((a) => a.status === 'active')
          .map((a) => ({
            id: a.id,
            nameEn: a.nameEn,
            nameAr: a.nameAr,
            tables: layout.tables
              .filter((t) => t.areaId === a.id && t.status === 'active')
              .map((t) => ({
                id: t.id,
                code: t.code,
                seats: t.seats,
                order: open.find((o) => o.tableId === t.id) ?? null,
              })),
          })),
        queue: open.filter((o) => o.orderType !== 'dine_in'),
      };
    });
  }

  // ------------------------------------------------------------ order changes
  private async lockOrder(tx: Transaction, id: string, branchId: string) {
    const [order] = await tx
      .select()
      .from(restaurantOrders)
      .where(eq(restaurantOrders.id, id))
      .for('update');
    if (!order || order.branchId !== branchId) throw AppError.notFound('Order not found.');
    if (order.status !== 'open') throw invalidState('This order is already closed.');
    return order;
  }

  private async bump(tx: Transaction, id: string, version?: number) {
    const [row] = await tx
      .update(restaurantOrders)
      .set({ version: sql`${restaurantOrders.version} + 1` })
      .where(
        version === undefined
          ? eq(restaurantOrders.id, id)
          : sql`${restaurantOrders.id} = ${id} and ${restaurantOrders.version} = ${version}`,
      )
      .returning({ id: restaurantOrders.id });
    if (!row) throw versionConflict();
  }

  async create(
    actor: MerchantActor,
    input: z.output<typeof createRestaurantOrderSchema>,
    ip: string,
  ) {
    const branchId = this.posBranch(actor);
    const id = newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        await this.config.assertEnabled(tx);
        let tableId: string | null = null;
        if (input.orderType === 'dine_in') {
          const [table] = (
            await tx.execute(
              sql`select id, branch_id, status from dining_tables where id = ${input.tableId}`,
            )
          ).rows as { id: string; branch_id: string; status: string }[];
          if (!table || table.branch_id !== branchId || table.status !== 'active')
            throw AppError.notFound('Table not found.');
          tableId = table.id;
        }
        const number = await nextDocumentNumber(tx, actor.merchantId, 'restaurant_order', 'R');
        await tx.insert(restaurantOrders).values({
          id,
          merchantId: actor.merchantId,
          branchId,
          number,
          orderType: input.orderType,
          tableId,
          guests: input.guests,
          label: input.label,
          note: input.note,
          openedByUserId: actor.userId,
        });
        await this.config.record(tx, actor, 'restaurant.order_opened', id, ip, {
          number,
          orderType: input.orderType,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'restaurant_orders_open_table_key'))
        throw new AppError(409, 'TABLE_OCCUPIED', 'This table already has an open order.');
      throw error;
    }
    return this.get(actor, id);
  }

  async addItems(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof addOrderItemsSchema>,
    ip: string,
  ) {
    const branchId = this.posBranch(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.lockOrder(tx, id, branchId);
      await this.bump(tx, id, input.version);
      const items = await this.sales.loadItems(
        tx,
        branchId,
        input.items.map((i) => i.variantId),
      );
      const missing = input.items.findIndex((i) => !items.has(i.variantId));
      if (missing >= 0)
        throw new AppError(
          409,
          'ITEM_UNAVAILABLE',
          'Some items are not available at this branch.',
          [
            {
              path: `items.${missing}.variantId`,
              code: 'unavailable',
              message: 'This item cannot be sold here.',
            },
          ],
        );
      const groups = await this.config.groupsIn(tx, true);
      const links = (
        await tx.execute(sql`
          select pg.product_id, pg.group_id from product_modifier_groups pg
          where pg.product_id in (${sql.join(
            [...new Set([...items.values()].map((i) => i.productId))].map((p) => sql`${p}`),
            sql`, `,
          )})`)
      ).rows as { product_id: string; group_id: string }[];
      const [last] = (
        await tx.execute(
          sql`select coalesce(max(position), -1)::int as p from restaurant_order_items where order_id = ${id}`,
        )
      ).rows as { p: number }[];
      let position = last!.p;
      for (const [index, line] of input.items.entries()) {
        const qty = parseQuantity(line.quantity);
        if (qty <= 0n) throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive.');
        const productId = items.get(line.variantId)!.productId;
        const allowed = groups.filter((g) =>
          links.some((l) => l.product_id === productId && l.group_id === g.id),
        );
        const chosen = [...new Set(line.modifierIds)];
        // Every chosen modifier belongs to one of the item's groups; min/max per group hold.
        const issues: string[] = [];
        for (const m of chosen)
          if (!allowed.some((g) => g.modifiers.some((x) => x.id === m)))
            issues.push('A modifier does not belong to this item.');
        for (const g of allowed) {
          const n = g.modifiers.filter((m) => chosen.includes(m.id)).length;
          if (n < g.minSelect || n > g.maxSelect)
            issues.push(
              `${g.nameEn ?? g.nameAr}: choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}.`,
            );
        }
        if (issues.length)
          throw new AppError(
            400,
            'MODIFIER_INVALID',
            issues[0]!,
            issues.map((message) => ({
              path: `items.${index}.modifierIds`,
              code: 'invalid',
              message,
            })),
          );
        const itemId = newId();
        position += 1;
        await tx.insert(restaurantOrderItems).values({
          id: itemId,
          merchantId: actor.merchantId,
          orderId: id,
          position,
          variantId: line.variantId,
          quantity: formatQuantity(qty),
          note: line.note,
          addedByUserId: actor.userId,
        });
        const snapshot = allowed.flatMap((g) => g.modifiers).filter((m) => chosen.includes(m.id));
        if (snapshot.length)
          await tx.insert(restaurantOrderItemModifiers).values(
            snapshot.map((m) => ({
              merchantId: actor.merchantId,
              itemId,
              modifierId: m.id,
              nameEn: m.nameEn,
              nameAr: m.nameAr,
              priceMinor: Money.parse(m.price.amount, CURRENCY).minor,
            })),
          );
      }
      await this.config.record(tx, actor, 'restaurant.items_added', id, ip, {
        count: input.items.length,
      });
    });
    return this.get(actor, id);
  }

  /** Sends every not-yet-sent item to its station; repeating it sends nothing twice. */
  async send(actor: MerchantActor, id: string, ip: string) {
    const branchId = this.posBranch(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.lockOrder(tx, id, branchId);
      await this.sendIn(tx, actor, id, branchId, ip);
    });
    return this.get(actor, id);
  }

  private async sendIn(
    tx: Transaction,
    actor: MerchantActor,
    id: string,
    branchId: string,
    ip: string,
  ) {
    const pending = (
      await tx.execute(sql`
        select i.id, p.category_id from restaurant_order_items i
        join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id
        where i.order_id = ${id} and i.kitchen_status = 'pending' order by i.position`)
    ).rows as { id: string; category_id: string | null }[];
    if (!pending.length) return 0;
    const stations = (
      await tx.execute(sql`
        select s.id, s.is_default, c.category_id from kitchen_stations s
        left join kitchen_station_categories c on c.station_id = s.id
        where s.branch_id = ${branchId} and s.status = 'active'`)
    ).rows as { id: string; is_default: boolean; category_id: string | null }[];
    const fallback = stations.find((s) => s.is_default)?.id ?? null;
    const byStation = new Map<string, string[]>();
    for (const item of pending) {
      const station =
        stations.find((s) => s.category_id && s.category_id === item.category_id)?.id ?? fallback;
      if (!station)
        throw invalidState(
          'Set up a kitchen station (or a default station) for this branch first.',
        );
      byStation.set(station, [...(byStation.get(station) ?? []), item.id]);
    }
    for (const [stationId, itemIds] of byStation) {
      const ticketId = newId();
      await tx
        .insert(kitchenTickets)
        .values({ id: ticketId, merchantId: actor.merchantId, branchId, orderId: id, stationId });
      await tx
        .update(restaurantOrderItems)
        .set({
          kitchenStatus: 'queued',
          stationId,
          ticketId,
          version: sql`${restaurantOrderItems.version} + 1`,
        })
        .where(inArray(restaurantOrderItems.id, itemIds));
    }
    await this.bump(tx, id);
    await this.config.record(tx, actor, 'restaurant.sent_to_kitchen', id, ip, {
      items: pending.length,
      tickets: byStation.size,
    });
    return byStation.size;
  }

  async cancelItem(
    actor: MerchantActor,
    id: string,
    itemId: string,
    input: z.output<typeof cancelOrderItemSchema>,
    ip: string,
  ) {
    const branchId = this.posBranch(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const order = await this.lockOrder(tx, id, branchId);
      const [item] = await tx
        .select()
        .from(restaurantOrderItems)
        .where(eq(restaurantOrderItems.id, itemId))
        .for('update');
      if (!item || item.orderId !== id) throw AppError.notFound('Item not found.');
      if (item.kitchenStatus === 'cancelled') throw invalidState('This item is already cancelled.');
      if (item.saleId)
        throw new AppError(409, 'ITEM_ALREADY_PAID', 'This item is paid; use a refund instead.');
      const sent = item.kitchenStatus !== 'pending';
      if (sent) assertCan(actor, 'restaurant.void_item', branchId);
      const waste = sent && input.waste;
      if (waste) {
        // Prepared and thrown away: the ingredients are consumed now (BR-135).
        const mods = await tx
          .select()
          .from(restaurantOrderItemModifiers)
          .where(eq(restaurantOrderItemModifiers.itemId, itemId));
        const consumption = await stockConsumption(tx, [
          {
            variantId: item.variantId,
            quantityMilli: parseQuantity(item.quantity),
            modifierIds: mods.map((m) => m.modifierId),
          },
        ]);
        await this.ledger.apply(
          tx,
          {
            merchantId: actor.merchantId,
            branchId,
            movementType: 'adjustment',
            reason: 'restaurant_waste',
            sourceType: 'restaurant_item',
            sourceId: itemId,
            userId: actor.userId,
            note: input.reason,
          },
          consumption.map((c) => ({
            variantId: c.variantId,
            mode: 'delta' as const,
            quantityMilli: -c.quantityMilli,
          })),
        );
      }
      await tx
        .update(restaurantOrderItems)
        .set({
          kitchenStatus: 'cancelled',
          cancelledAt: sql`now()`,
          cancelReason: input.reason,
          wasted: waste,
          cancelledByUserId: actor.userId,
          version: sql`${restaurantOrderItems.version} + 1`,
        })
        .where(eq(restaurantOrderItems.id, itemId));
      if (item.ticketId)
        await tx.execute(sql`
          update kitchen_tickets set status = 'cancelled', version = version + 1
          where id = ${item.ticketId} and status in ('new', 'preparing', 'ready')
            and not exists (select 1 from restaurant_order_items i where i.ticket_id = ${item.ticketId} and i.kitchen_status <> 'cancelled')`);
      await this.bump(tx, id);
      await this.closeIfSettled(tx, order.id);
      await this.config.record(tx, actor, 'restaurant.item_cancelled', itemId, ip, {
        orderId: id,
        sent,
        waste,
        reason: input.reason,
      });
    });
    return this.get(actor, id);
  }

  async move(actor: MerchantActor, id: string, tableId: string, version: number, ip: string) {
    const branchId = this.posBranch(actor);
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const order = await this.lockOrder(tx, id, branchId);
        if (order.orderType !== 'dine_in')
          throw invalidState('Only dine-in orders sit at a table.');
        const [table] = (
          await tx.execute(
            sql`select id, branch_id, status from dining_tables where id = ${tableId}`,
          )
        ).rows as { id: string; branch_id: string; status: string }[];
        if (!table || table.branch_id !== branchId || table.status !== 'active')
          throw AppError.notFound('Table not found.');
        const [row] = await tx
          .update(restaurantOrders)
          .set({ tableId, version: sql`${restaurantOrders.version} + 1` })
          .where(sql`${restaurantOrders.id} = ${id} and ${restaurantOrders.version} = ${version}`)
          .returning({ id: restaurantOrders.id });
        if (!row) throw versionConflict();
        await this.config.record(tx, actor, 'restaurant.order_moved', id, ip, {
          from: order.tableId,
          to: tableId,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'restaurant_orders_open_table_key'))
        throw new AppError(409, 'TABLE_OCCUPIED', 'This table already has an open order.');
      throw error;
    }
    return this.get(actor, id);
  }

  /**
   * Moves the unpaid items (and kitchen tickets) of `sourceId` into `id`. Orders with paid
   * bills cannot be merged, so revenue is never moved or counted twice (BR-137).
   */
  async merge(actor: MerchantActor, id: string, sourceId: string, version: number, ip: string) {
    const branchId = this.posBranch(actor);
    if (id === sourceId) throw invalidState('Choose another order to combine.');
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      // Lock both in id order (no deadlock between two opposite merges).
      const [first, second] = [id, sourceId].sort();
      await this.lockOrder(tx, first!, branchId);
      await this.lockOrder(tx, second!, branchId);
      await this.bump(tx, id, version);
      const [paid] = (
        await tx.execute(
          sql`select count(*)::int as n from restaurant_order_items where order_id = ${sourceId} and sale_id is not null`,
        )
      ).rows as { n: number }[];
      if (paid!.n > 0)
        throw invalidState('This order already has a paid bill; settle it separately.');
      const [last] = (
        await tx.execute(
          sql`select coalesce(max(position), -1)::int as p from restaurant_order_items where order_id = ${id}`,
        )
      ).rows as { p: number }[];
      await tx.execute(sql`
        update restaurant_order_items i set order_id = ${id}, position = ${last!.p} + s.rn, version = i.version + 1
        from (select id, row_number() over (order by position)::int as rn from restaurant_order_items
              where order_id = ${sourceId} and kitchen_status <> 'cancelled') s
        where i.id = s.id`);
      await tx.execute(
        sql`update kitchen_tickets set order_id = ${id}, version = version + 1 where order_id = ${sourceId}`,
      );
      await tx
        .update(restaurantOrders)
        .set({
          status: 'merged',
          mergedIntoId: id,
          closedAt: sql`now()`,
          version: sql`${restaurantOrders.version} + 1`,
        })
        .where(eq(restaurantOrders.id, sourceId));
      await this.config.record(tx, actor, 'restaurant.orders_merged', id, ip, { sourceId });
    });
    return this.get(actor, id);
  }

  async cancel(actor: MerchantActor, id: string, version: number, ip: string) {
    const branchId = this.posBranch(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.lockOrder(tx, id, branchId);
      const [counts] = (
        await tx.execute(sql`
          select count(*) filter (where sale_id is not null)::int as paid,
                 count(*) filter (where kitchen_status not in ('pending', 'cancelled'))::int as sent
          from restaurant_order_items where order_id = ${id}`)
      ).rows as { paid: number; sent: number }[];
      if (counts!.paid > 0)
        throw invalidState('This order has paid bills and cannot be cancelled.');
      if (counts!.sent > 0)
        throw invalidState('Cancel the items already sent to the kitchen first.');
      await tx.execute(sql`
        update restaurant_order_items set kitchen_status = 'cancelled', cancelled_at = now(), cancel_reason = 'order cancelled',
               wasted = false, cancelled_by_user_id = ${actor.userId}, version = version + 1
        where order_id = ${id} and kitchen_status = 'pending'`);
      const [row] = await tx
        .update(restaurantOrders)
        .set({
          status: 'cancelled',
          closedAt: sql`now()`,
          version: sql`${restaurantOrders.version} + 1`,
        })
        .where(sql`${restaurantOrders.id} = ${id} and ${restaurantOrders.version} = ${version}`)
        .returning({ id: restaurantOrders.id });
      if (!row) throw versionConflict();
      await this.config.record(tx, actor, 'restaurant.order_cancelled', id, ip);
    });
  }

  /** Closes an order once every remaining item is paid (and at least one bill exists). */
  private async closeIfSettled(tx: Transaction, id: string) {
    await tx.execute(sql`
      update restaurant_orders set status = 'closed', closed_at = now(), version = version + 1
      where id = ${id} and status = 'open'
        and exists (select 1 from restaurant_order_items where order_id = ${id} and sale_id is not null)
        and not exists (select 1 from restaurant_order_items where order_id = ${id} and sale_id is null and kitchen_status <> 'cancelled')`);
  }

  // ------------------------------------------------------------ bills
  private async billLines(
    tx: Transaction,
    actor: MerchantActor,
    orderId: string,
    itemIds: string[],
    discount: z.output<typeof quoteOrderSchema>['orderDiscount'],
  ) {
    const unique = [...new Set(itemIds)];
    const rows = await tx
      .select()
      .from(restaurantOrderItems)
      .where(inArray(restaurantOrderItems.id, unique));
    if (rows.length !== unique.length || rows.some((r) => r.orderId !== orderId))
      throw AppError.notFound('Item not found.');
    if (rows.some((r) => r.kitchenStatus === 'cancelled'))
      throw invalidState('Cancelled items cannot be billed.');
    if (rows.some((r) => r.saleId))
      throw new AppError(409, 'ITEM_ALREADY_PAID', 'Some items are already paid.');
    rows.sort((a, b) => a.position - b.position);
    const parsed = this.sales.parseCart(actor, {
      lines: rows.map((r) => ({
        variantId: r.variantId,
        quantity: r.quantity,
        priceOverride: null,
        priceOverrideReason: null,
        discount: null,
      })),
      orderDiscount: discount,
    });
    const mods = await tx
      .select()
      .from(restaurantOrderItemModifiers)
      .where(inArray(restaurantOrderItemModifiers.itemId, unique));
    const lines: ParsedLine[] = parsed.lines.map((l, i) => ({
      ...l,
      modifiers: mods
        .filter((m) => m.itemId === rows[i]!.id)
        .map((m) => ({
          id: m.modifierId,
          nameEn: m.nameEn,
          nameAr: m.nameAr,
          priceMinor: m.priceMinor,
        })),
    }));
    return { rows, lines, orderDiscount: parsed.orderDiscount };
  }

  async quote(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof quoteOrderSchema>,
  ): Promise<OrderQuote> {
    const branchId = this.posBranch(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [order] = await tx.select().from(restaurantOrders).where(eq(restaurantOrders.id, id));
      if (!order || order.branchId !== branchId) throw AppError.notFound('Order not found.');
      const { lines, orderDiscount } = await this.billLines(
        tx,
        actor,
        id,
        input.itemIds,
        input.orderDiscount,
      );
      const items = await this.sales.loadItems(
        tx,
        branchId,
        lines.map((l) => l.variantId),
      );
      try {
        const priced = priceCart(
          lines.map((l) => ({
            unitPriceMinor:
              items.get(l.variantId)!.priceMinor +
              l.modifiers.reduce((s, m) => s + m.priceMinor, 0n),
            quantityMilli: l.quantityMilli,
            discount: null,
          })),
          orderDiscount,
        );
        return {
          subtotal: money(priced.subtotalMinor),
          discounts: money(priced.lineDiscountsMinor + priced.orderDiscountMinor),
          total: money(priced.totalMinor),
        };
      } catch (error) {
        if (error instanceof PricingError) throw new AppError(400, error.code, error.message);
        throw error;
      }
    });
  }

  /**
   * Pays a bill: the chosen unpaid items become one sale through the checkout engine
   * (the cashier's open shift, exact payments, receipt number, stock). Split bills are
   * several pays over different items; split tenders are several payments on one bill.
   */
  async pay(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof payOrderSchema>,
    ip: string,
  ): Promise<{ order: RestaurantOrder; sale: Sale }> {
    const branchId = this.posBranch(actor);
    assertCan(actor, 'sales.create', branchId);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...input, idempotencyKey: undefined, restaurantOrderId: id }))
      .digest('hex');
    const replayed = await this.sales.replay(actor, input.idempotencyKey, requestHash);
    if (replayed) return { order: await this.get(actor, id), sale: replayed };
    const saleId = newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const settings = await this.config.settingsIn(tx);
        if (!settings.enabled)
          throw new AppError(409, 'MODULE_DISABLED', 'The restaurant module is not enabled.');
        const shift = await this.shifts.lockOwnShift(tx, actor);
        const order = await this.lockOrder(tx, id, branchId);
        const { rows, lines, orderDiscount } = await this.billLines(
          tx,
          actor,
          id,
          input.itemIds,
          input.orderDiscount,
        );
        await this.sales.completeSaleInTx(tx, actor, shift, {
          saleId,
          lines,
          orderDiscount,
          orderDiscountInput: input.orderDiscount,
          payments: input.payments,
          expectedTotalMinor: parseAmount(input.expectedTotal, 'expectedTotal'),
          orderId: null,
          idempotency: { key: input.idempotencyKey, hash: requestHash },
          exchange: null,
          customer: { id: input.customerId, inherited: false },
          restaurant: { orderId: id, serviceType: order.orderType },
          ip,
        });
        await tx
          .update(restaurantOrderItems)
          .set({ saleId, version: sql`${restaurantOrderItems.version} + 1` })
          .where(
            inArray(
              restaurantOrderItems.id,
              rows.map((r) => r.id),
            ),
          );
        if (settings.autoSendOnPayment && order.orderType !== 'dine_in')
          await this.sendIn(tx, actor, id, branchId, ip);
        await this.bump(tx, id);
        await this.closeIfSettled(tx, id);
        await this.config.record(tx, actor, 'restaurant.bill_paid', id, ip, {
          saleId,
          items: rows.length,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'orders_idempotency_key')) {
        const again = await this.sales.replay(actor, input.idempotencyKey, requestHash);
        if (again) return { order: await this.get(actor, id), sale: again };
      }
      throw error;
    }
    return {
      order: await this.get(actor, id),
      sale: await this.sales.getSale(actor, saleId, 'pos'),
    };
  }

  // ------------------------------------------------------------ kitchen
  async board(actor: MerchantActor, stationId: string | null): Promise<KitchenBoard> {
    const branchId = this.posBranch(actor, 'kitchen.access');
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.config.assertEnabled(tx);
      const stations = (
        await tx.execute(
          sql`select id, name_en, name_ar from kitchen_stations where branch_id = ${branchId} and status = 'active' order by name_en`,
        )
      ).rows as Row[];
      const tickets = await this.tickets(
        tx,
        sql`k.branch_id = ${branchId} and (k.status in ('new', 'preparing', 'ready')
             or (k.status = 'completed' and k.completed_at > now() - interval '15 minutes'))
            ${stationId ? sql`and k.station_id = ${stationId}` : sql``}`,
      );
      return {
        stations: stations.map((s) => ({
          id: s['id'] as string,
          nameEn: (s['name_en'] as string | null) ?? null,
          nameAr: (s['name_ar'] as string | null) ?? null,
        })),
        tickets,
      };
    });
  }

  private async tickets(tx: Transaction, where: ReturnType<typeof sql>): Promise<KitchenTicket[]> {
    const rows = (
      await tx.execute(sql`
        select k.*, o.number, o.order_type, o.label, t.code as table_code from kitchen_tickets k
        join restaurant_orders o on o.id = k.order_id left join dining_tables t on t.id = o.table_id
        where ${where} order by k.created_at`)
    ).rows as Row[];
    if (!rows.length) return [];
    const ids = sql.join(
      rows.map((r) => sql`${r['id'] as string}`),
      sql`, `,
    );
    const items = (
      await tx.execute(sql`
        select i.id, i.ticket_id, i.quantity::text as qty, i.note, i.kitchen_status, p.name_en, p.name_ar,
               v.name_en as vn_en, v.name_ar as vn_ar
        from restaurant_order_items i join product_variants v on v.id = i.variant_id join products p on p.id = v.product_id
        where i.ticket_id in (${ids}) order by i.position`)
    ).rows as Row[];
    const mods = (
      await tx.execute(sql`
        select m.item_id, m.name_en, m.name_ar from restaurant_order_item_modifiers m
        join restaurant_order_items i on i.id = m.item_id where i.ticket_id in (${ids})`)
    ).rows as Row[];
    return rows.map((r) => ({
      id: r['id'] as string,
      orderId: r['order_id'] as string,
      orderNumber: r['number'] as string,
      orderType: r['order_type'] as KitchenTicket['orderType'],
      tableCode: (r['table_code'] as string | null) ?? null,
      label: (r['label'] as string | null) ?? null,
      stationId: r['station_id'] as string,
      status: r['status'] as KitchenTicket['status'],
      createdAt: iso(r['created_at'])!,
      startedAt: iso(r['started_at']),
      readyAt: iso(r['ready_at']),
      completedAt: iso(r['completed_at']),
      version: r['version'] as number,
      items: items
        .filter((i) => i['ticket_id'] === r['id'])
        .map((i) => ({
          id: i['id'] as string,
          nameEn: (i['name_en'] as string | null) ?? null,
          nameAr: (i['name_ar'] as string | null) ?? null,
          variantNameEn: (i['vn_en'] as string | null) ?? null,
          variantNameAr: (i['vn_ar'] as string | null) ?? null,
          quantity: formatQuantity(parseQuantity(i['qty'] as string)),
          note: (i['note'] as string | null) ?? null,
          modifiers: mods
            .filter((m) => m['item_id'] === i['id'])
            .map((m) => ({
              nameEn: (m['name_en'] as string | null) ?? null,
              nameAr: (m['name_ar'] as string | null) ?? null,
            })),
          kitchenStatus: i['kitchen_status'] as KitchenTicket['items'][number]['kitchenStatus'],
        })),
    }));
  }

  /**
   * Moves a ticket forward (new → preparing → ready → completed). Repeating a status or
   * a stale tap that would move it backwards changes nothing; it never touches money.
   */
  async setTicketStatus(
    actor: MerchantActor,
    ticketId: string,
    input: z.output<typeof ticketStatusSchema>,
  ): Promise<KitchenTicket> {
    const branchId = this.posBranch(actor, 'kitchen.access');
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [ticket] = await tx
        .select()
        .from(kitchenTickets)
        .where(eq(kitchenTickets.id, ticketId))
        .for('update');
      if (!ticket || ticket.branchId !== branchId) throw AppError.notFound('Ticket not found.');
      const from = TICKET_ORDER[ticket.status as keyof typeof TICKET_ORDER];
      const to = TICKET_ORDER[input.status];
      if (ticket.status === 'cancelled') throw invalidState('This ticket was cancelled.');
      if (to > from) {
        if (ticket.version !== input.version) throw versionConflict();
        const at = { preparing: 'startedAt', ready: 'readyAt', completed: 'completedAt' } as const;
        await tx
          .update(kitchenTickets)
          .set({
            status: input.status,
            ...(input.status === 'completed' && !ticket.readyAt ? { readyAt: sql`now()` } : {}),
            ...(input.status !== 'preparing' && !ticket.startedAt ? { startedAt: sql`now()` } : {}),
            [at[input.status]]: sql`now()`,
            version: sql`${kitchenTickets.version} + 1`,
          })
          .where(eq(kitchenTickets.id, ticketId));
        await tx.execute(sql`
          update restaurant_order_items set kitchen_status = ${ITEM_FOR_TICKET[input.status]}, version = version + 1
          where ticket_id = ${ticketId} and kitchen_status <> 'cancelled'`);
      }
      const [view] = await this.tickets(tx, sql`k.id = ${ticketId}`);
      return view!;
    });
  }
}
