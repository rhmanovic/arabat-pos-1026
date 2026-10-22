import type {
  PosOnlineOrder,
  Sale,
  posOnlineOrderCompleteSchema,
  posOnlineOrderPaySchema,
} from '@arabat/contracts';
import { Money, formatQuantity, parseQuantity } from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { parseAmount } from '../payments/payments.service.js';
import { ShiftsService } from '../registers/shifts.service.js';
import { SalesService } from '../sales/sales.service.js';
import { OnlinePaymentsService, historyEntry } from './online-payments.service.js';
import { OrderNotificationsService } from './order-notifications.service.js';

type Row = Record<string, unknown>;
const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Orders a cashier may hand over: not yet completed, not cancelled, at the till's branch. */
const OPEN = ['placed', 'confirmed', 'paid', 'preparing', 'ready'] as const;
/** Pay-on-receipt statuses whose money may be taken at the till. */
const PAYABLE = ['placed', 'confirmed', 'preparing', 'ready'] as const;

/**
 * Hand-over of online orders at the POS (ADR-0123): the cashier sees the pickup orders of the
 * branch, takes the money of an unpaid one with the till's tenders in the open shift (the
 * sale is created then, with `channel = 'online'`, cash into the drawer) and completes it.
 */
@Injectable()
export class PosHandoverService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
    private readonly shifts: ShiftsService,
    private readonly payments: OnlinePaymentsService,
    private readonly notifications: OrderNotificationsService,
  ) {}

  private posBranch(actor: MerchantActor) {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    assertCan(actor, 'sales.create', branchId);
    return branchId;
  }

  private async view(tx: Transaction, id: string): Promise<PosOnlineOrder> {
    const [o] = (await tx.execute(sql`select * from online_orders where id = ${id}`)).rows as Row[];
    if (!o) throw AppError.notFound('Order not found.');
    const lines = (
      await tx.execute(
        sql`select * from online_order_lines where order_id = ${id} order by position`,
      )
    ).rows as Row[];
    return {
      id,
      number: o['number'] as string,
      status: o['status'] as PosOnlineOrder['status'],
      fulfillment: o['fulfillment'] as 'pickup',
      paymentMode: o['payment_mode'] as 'gateway',
      customerName: o['customer_name'] as string,
      customerPhone: o['customer_phone'] as string,
      total: money(o['total_minor'] as string),
      paid: o['sale_id'] !== null,
      scheduledFor: iso(o['scheduled_for']),
      createdAt: iso(o['created_at'])!,
      lines: lines.map((l) => ({
        position: l['position'] as number,
        variantId: l['variant_id'] as string,
        productId: l['product_id'] as string,
        nameEn: (l['name_en'] as string | null) ?? null,
        nameAr: (l['name_ar'] as string | null) ?? null,
        variantNameEn: (l['variant_name_en'] as string | null) ?? null,
        variantNameAr: (l['variant_name_ar'] as string | null) ?? null,
        sku: (l['sku'] as string | null) ?? null,
        quantity: formatQuantity(parseQuantity(l['quantity'] as string)),
        unitPrice: money(l['unit_price_minor'] as string),
        lineTotal: money(l['line_total_minor'] as string),
      })),
      note: (o['note'] as string | null) ?? null,
      version: o['version'] as number,
    };
  }

  async list(actor: MerchantActor): Promise<{ orders: PosOnlineOrder[] }> {
    const branchId = this.posBranch(actor);
    await this.payments.reconcile(actor.merchantId).catch(() => undefined);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const ids = (
        await tx.execute(sql`
          select id from online_orders
          where branch_id = ${branchId} and fulfillment = 'pickup'
            and status in (${sql.join(
              OPEN.map((s) => sql`${s}`),
              sql`, `,
            )})
          order by coalesce(scheduled_for, created_at), created_at limit 100`)
      ).rows as { id: string }[];
      const orders: PosOnlineOrder[] = [];
      for (const { id } of ids) orders.push(await this.view(tx, id));
      return { orders };
    });
  }

  /**
   * Takes the money of a pay-on-receipt order at the till and hands it over: one sale in the
   * cashier's open shift, the order completed. Retries with the same key return the sale.
   */
  async pay(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof posOnlineOrderPaySchema>,
    ip: string,
  ): Promise<Sale> {
    const branchId = this.posBranch(actor);
    const saleId = newId();
    const result = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [order] = (
        await tx.execute(sql`select * from online_orders where id = ${id} for update`)
      ).rows as Row[];
      if (!order || order['branch_id'] !== branchId) throw AppError.notFound('Order not found.');
      if (order['pos_idempotency_key'] === input.idempotencyKey && order['sale_id'])
        return { saleId: order['sale_id'] as string, replayed: true };
      if (order['version'] !== input.version) throw versionConflict();
      if (order['payment_mode'] !== 'on_receipt')
        throw new AppError(409, 'INVALID_STATE', 'Online payments are confirmed by the gateway.');
      if (order['sale_id'] || !PAYABLE.includes(order['status'] as (typeof PAYABLE)[number]))
        throw new AppError(409, 'INVALID_STATE', 'This order cannot be paid now.');
      if (order['fulfillment'] !== 'pickup')
        throw new AppError(409, 'INVALID_STATE', 'Delivery orders are settled from the console.');
      const totalMinor = BigInt(order['total_minor'] as string);
      if (totalMinor !== parseAmount(input.expectedTotal, 'expectedTotal'))
        throw new AppError(409, 'TOTAL_CHANGED', 'The order total changed. Reload it.');
      const shift = await this.shifts.lockOwnShift(tx, actor);
      const lines = (
        await tx.execute(
          sql`select * from online_order_lines where order_id = ${id} order by position`,
        )
      ).rows as Row[];
      const deliveryFeeMinor = BigInt(order['delivery_fee_minor'] as string);
      const delivery =
        deliveryFeeMinor > 0n
          ? await this.payments.deliveryLine(tx, actor.merchantId, deliveryFeeMinor)
          : [];
      const first = input.payments[0]!;
      await this.sales.completeOnlineSaleInTx(tx, actor.merchantId, {
        saleId,
        branchId,
        onlineOrderId: id,
        orderNumber: order['number'] as string,
        customerId: (order['customer_id'] as string | null) ?? null,
        lines: [
          ...lines.map((l) => ({
            variantId: l['variant_id'] as string,
            productId: l['product_id'] as string,
            quantityMilli: parseQuantity(l['quantity'] as string),
            unitPriceMinor: BigInt(l['unit_price_minor'] as string),
            regularUnitPriceMinor:
              l['regular_unit_price_minor'] === null
                ? null
                : BigInt(l['regular_unit_price_minor'] as string),
            productDiscountId: (l['product_discount_id'] as string | null) ?? null,
            nameEn: (l['name_en'] as string | null) ?? null,
            nameAr: (l['name_ar'] as string | null) ?? null,
            variantNameEn: (l['variant_name_en'] as string | null) ?? null,
            variantNameAr: (l['variant_name_ar'] as string | null) ?? null,
            sku: (l['sku'] as string | null) ?? null,
          })),
          ...delivery,
        ],
        payment: {
          methodId: first.methodId,
          amountMinor: totalMinor,
          reference: first.reference ?? null,
          verification: 'manual',
          collectedByUserId: actor.userId,
        },
        till: {
          shift: { id: shift.id, registerId: shift.registerId },
          membershipId: actor.membershipId,
          userId: actor.userId,
          payments: input.payments,
        },
        orderDiscountMinor: BigInt(order['discount_minor'] as string),
      });
      await tx.execute(sql`
        update online_orders set sale_id = ${saleId}, paid_at = now(), payment_method_id = ${first.methodId},
               payment_reference = ${first.reference ?? null}, collected_by_user_id = ${actor.userId},
               pos_idempotency_key = ${input.idempotencyKey},
               status = 'completed', confirmed_at = coalesce(confirmed_at, now()), completed_at = now(),
               updated_at = now(), version = version + 1,
               history = ${historyEntry('completed')}
        where id = ${id}`);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'online.order_handed_over',
        targetType: 'online_order',
        targetId: id,
        ip,
        details: {
          number: order['number'],
          saleId,
          shiftId: shift.id,
          total: Money.ofMinor(totalMinor, CURRENCY).toDecimalString(),
          tenders: input.payments.length,
        },
      });
      return { saleId, replayed: false };
    });
    if (!result.replayed) this.notifications.notify(actor.merchantId, id, 'completed');
    return this.sales.getSale(actor, result.saleId, 'pos');
  }

  /** Hands over an order that is already paid (gateway, console or till). */
  async complete(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof posOnlineOrderCompleteSchema>,
    ip: string,
  ): Promise<PosOnlineOrder> {
    const branchId = this.posBranch(actor);
    const view = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [order] = (
        await tx.execute(sql`select * from online_orders where id = ${id} for update`)
      ).rows as Row[];
      if (!order || order['branch_id'] !== branchId) throw AppError.notFound('Order not found.');
      if (order['version'] !== input.version) throw versionConflict();
      if (!order['sale_id'])
        throw new AppError(409, 'ORDER_UNPAID', 'Take the payment before handing the order over.');
      if (!OPEN.includes(order['status'] as (typeof OPEN)[number]))
        throw new AppError(409, 'INVALID_STATE', 'This order cannot be completed now.');
      await tx.execute(sql`
        update online_orders set status = 'completed', completed_at = now(), updated_at = now(),
               version = version + 1, history = ${historyEntry('completed')}
        where id = ${id}`);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'online.order_handed_over',
        targetType: 'online_order',
        targetId: id,
        ip,
        details: { number: order['number'], saleId: order['sale_id'] },
      });
      return this.view(tx, id);
    });
    this.notifications.notify(actor.merchantId, id, 'completed');
    return view;
  }
}
