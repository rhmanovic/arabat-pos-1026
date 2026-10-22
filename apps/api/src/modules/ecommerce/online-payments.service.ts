import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { parseQuantity } from '@arabat/money';
import { eq, sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import { type Env, mockPaymentsEnabled } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { PrintJobsService } from '../printing/print-jobs.service.js';
import { SalesService } from '../sales/sales.service.js';
import { OrderNotificationsService } from './order-notifications.service.js';
import { onlineOrderLines, onlineOrders, onlinePayments } from './ecommerce.schema.js';
import {
  GATEWAY_PROVIDERS,
  type GatewayProvider,
  type GatewayStatus,
  MockGateway,
  type PaymentGateway,
  UnconfiguredGateway,
  type VerifiedPayment,
} from './gateways/payment-gateway.js';

type Row = Record<string, unknown>;

/** Appends a status to the order's customer timeline. */
export const historyEntry = (status: string) =>
  sql`history || jsonb_build_array(jsonb_build_object('status', ${status}::text, 'at', now()))`;

/**
 * Gateway-independent payment processing (ADR-0078): every provider's result — webhook,
 * return-page verification or reconciliation — goes through `applyResult`, which is
 * idempotent (provider event ids are stored once; a settled attempt never changes; an
 * order is paid at most once) and turns a confirmed payment into exactly one sale.
 */
@Injectable()
export class OnlinePaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnlinePaymentsService.name);
  private readonly gateways = new Map<GatewayProvider, PaymentGateway>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly sales: SalesService,
    private readonly printJobs: PrintJobsService,
    private readonly notifications: OrderNotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {
    for (const p of GATEWAY_PROVIDERS) this.gateways.set(p, new UnconfiguredGateway(p));
    if (mockPaymentsEnabled(env)) {
      this.gateways.set('mock', new MockGateway(env.PAYMENT_MOCK_SECRET, env.PUBLIC_STORE_URL));
      // Test payments create real sales and bank entries without money (FND-709): outside
      // development this must be a deliberate, visible choice (staging only, OPERATIONS.md).
      if (env.NODE_ENV === 'production')
        this.logger.warn(
          'PAYMENT_MOCK_ENABLED is on in a production build: test payments create sales and bank entries without real money. Never use this for a live merchant.',
        );
    }
  }

  onModuleInit() {
    // Expire unpaid orders and reconcile open attempts in the background (not in tests).
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(
      () => void this.reconcileDue().catch((e) => this.logger.error(e)),
      60_000,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  gateway(provider: string): PaymentGateway {
    const g = this.gateways.get(provider as GatewayProvider);
    if (!g)
      throw new AppError(409, 'GATEWAY_NOT_CONFIGURED', `Unknown payment provider ${provider}.`);
    return g;
  }

  mock(): MockGateway {
    const g = this.gateways.get('mock');
    if (!(g instanceof MockGateway)) throw AppError.notFound();
    return g;
  }

  // ------------------------------------------------------------ notifications
  /** Provider webhook: signature checked over the raw body, processed once per event id. */
  async handleWebhook(
    provider: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ) {
    const event = this.gateway(provider).parseWebhook(headers, rawBody);
    const [found] = (
      await this.database.db.execute(
        sql`select online_payment_merchant(${provider}, ${event.providerReference}) as m`,
      )
    ).rows as { m: string | null }[];
    if (!found?.m) throw AppError.notFound('Unknown payment reference.');
    const merchantId = found.m;
    return this.database
      .withMerchantTx(merchantId, async (tx) => {
        const [payment] = await tx
          .select()
          .from(onlinePayments)
          .where(
            sql`${onlinePayments.provider} = ${provider} and ${onlinePayments.providerReference} = ${event.providerReference}`,
          )
          .for('update');
        // The payment row lock serialises deliveries of the same event; the unique index is the
        // backstop. Events are append-only, so the outcome is known before the row is written.
        const [seen] = (
          await tx.execute(
            sql`select 1 from payment_events where provider = ${provider} and event_id = ${event.eventId}`,
          )
        ).rows;
        if (seen) return { duplicate: true, outcome: 'duplicate' };
        if (!payment) throw AppError.notFound('Unknown payment reference.');
        const outcome = await this.applyResult(tx, merchantId, payment.id, event);
        await tx.execute(sql`
        insert into payment_events (id, merchant_id, provider, event_id, online_payment_id, status, amount_minor, payload, outcome)
        values (${newId()}, ${merchantId}, ${provider}, ${event.eventId}, ${payment.id}, ${event.status},
                ${event.amountMinor.toString()}, ${JSON.stringify(event.payload)}::jsonb, ${outcome})`);
        return { duplicate: false, outcome, orderId: payment.onlineOrderId };
      })
      .then((result) => {
        // After the commit: the shopper and the store hear about the payment (ADR-0123).
        if (result.outcome === 'paid' && result.orderId)
          this.notifications.notify(merchantId, result.orderId, 'paid');
        return { duplicate: result.duplicate, outcome: result.outcome };
      });
  }

  /**
   * Applies a provider result to our attempt and order. Returns what happened, e.g.
   * `paid`, `already_settled`, `amount_mismatch`, `failed`, `needs_attention`.
   */
  async applyResult(
    tx: Transaction,
    merchantId: string,
    paymentId: string,
    result: VerifiedPayment,
  ): Promise<string> {
    const [payment] = await tx
      .select()
      .from(onlinePayments)
      .where(eq(onlinePayments.id, paymentId))
      .for('update');
    if (!payment) throw AppError.notFound();
    if (result.status === 'pending') return 'pending';
    if (payment.status !== 'initiated' && payment.status !== 'expired') {
      // Money taken on an attempt we had already closed (order cancelled, or a failure reported
      // first): never ignore it — record it and flag the order for a refund (audit fix).
      if (result.status === 'succeeded' && payment.status !== 'succeeded') {
        await tx
          .update(onlinePayments)
          .set({
            status: 'succeeded',
            failureReason: `Paid after the attempt was ${payment.status}; refund it at the provider.`,
            completedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(onlinePayments.id, paymentId));
        const [order] = await tx
          .select()
          .from(onlineOrders)
          .where(eq(onlineOrders.id, payment.onlineOrderId))
          .for('update');
        if (order && !order.saleId && order.status !== 'needs_attention')
          await this.setStatus(
            tx,
            order.id,
            'needs_attention',
            'A payment arrived after the order was closed; refund it at the provider.',
          );
        await this.record(tx, merchantId, 'online.payment_after_close', payment.onlineOrderId, {
          paymentId,
          previousStatus: payment.status,
        });
        return 'needs_attention';
      }
      return 'already_settled';
    }
    if (payment.status === 'expired' && result.status !== 'succeeded') return 'already_settled';
    const [order] = await tx
      .select()
      .from(onlineOrders)
      .where(eq(onlineOrders.id, payment.onlineOrderId))
      .for('update');
    if (!order) throw AppError.notFound();

    if (
      result.status === 'succeeded' &&
      (result.amountMinor !== payment.amountMinor || result.currency !== payment.currency)
    ) {
      await tx
        .update(onlinePayments)
        .set({
          status: 'failed',
          failureReason: 'Amount or currency does not match the order.',
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(onlinePayments.id, paymentId));
      await this.setStatus(
        tx,
        order.id,
        'needs_attention',
        'The gateway reported a different amount; check with the provider.',
      );
      // Not paid: the reserved stock goes back.
      await this.release(tx, order.id);
      return 'amount_mismatch';
    }

    if (result.status !== 'succeeded') {
      await tx
        .update(onlinePayments)
        .set({
          status: result.status as 'failed',
          failureReason: result.failureReason,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(onlinePayments.id, paymentId));
      if (order.status === 'pending_payment') {
        await this.setStatus(
          tx,
          order.id,
          result.status === 'cancelled' ? 'cancelled' : 'payment_failed',
          result.failureReason,
        );
        await this.release(tx, order.id);
      }
      await this.record(tx, merchantId, `online.payment_${result.status}`, order.id, { paymentId });
      return result.status;
    }

    await tx
      .update(onlinePayments)
      .set({ status: 'succeeded', completedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(onlinePayments.id, paymentId));
    if (order.saleId || !['pending_payment', 'expired'].includes(order.status)) {
      // Paid twice (a second attempt) or after cancellation: the money must be returned.
      await this.setStatus(
        tx,
        order.id,
        order.saleId ? order.status : 'needs_attention',
        'A payment arrived for an order that is already settled; refund it at the provider.',
      );
      return 'needs_attention';
    }
    const lines = await tx
      .select()
      .from(onlineOrderLines)
      .where(eq(onlineOrderLines.orderId, order.id))
      .orderBy(onlineOrderLines.position);
    const saleId = newId();
    try {
      // A savepoint: if stock is gone (a late payment after the reservation expired), the
      // payment stays recorded and the order is flagged instead of failing the webhook.
      await tx.transaction(async (sp) => {
        const delivery =
          order.deliveryFeeMinor > 0n
            ? await this.deliveryLine(sp, merchantId, order.deliveryFeeMinor)
            : [];
        await this.sales.completeOnlineSaleInTx(sp, merchantId, {
          saleId,
          branchId: order.branchId,
          onlineOrderId: order.id,
          orderNumber: order.number,
          customerId: order.customerId,
          lines: [
            ...lines.map((l) => ({
              variantId: l.variantId,
              productId: l.productId,
              quantityMilli: parseQuantity(l.quantity),
              unitPriceMinor: l.unitPriceMinor,
              regularUnitPriceMinor: l.regularUnitPriceMinor,
              productDiscountId: l.productDiscountId,
              nameEn: l.nameEn,
              nameAr: l.nameAr,
              variantNameEn: l.variantNameEn,
              variantNameAr: l.variantNameAr,
              sku: l.sku,
            })),
            ...delivery,
          ],
          payment: {
            // Gateway orders always carry their method (CHECK online_orders_gateway_fields).
            methodId: order.paymentMethodId!,
            amountMinor: payment.amountMinor,
            reference: payment.providerReference ?? payment.id,
            verification: 'gateway',
            collectedByUserId: null,
          },
          orderDiscountMinor: order.discountMinor,
        });
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'INSUFFICIENT_STOCK') {
        await this.setStatus(
          tx,
          order.id,
          'needs_attention',
          'Paid after the reservation expired and the stock is no longer available; refund or restock.',
        );
        await this.release(tx, order.id);
        await this.record(tx, merchantId, 'online.paid_without_stock', order.id, { paymentId });
        return 'needs_attention';
      }
      throw error;
    }
    await tx.execute(sql`
      update online_orders set status = 'paid', sale_id = ${saleId}, paid_at = now(), updated_at = now(),
             version = version + 1, history = ${historyEntry('paid')}
      where id = ${order.id}`);
    await tx.execute(sql`
      update stock_reservations set status = 'consumed', released_at = now()
      where online_order_id = ${order.id} and status = 'active'`);
    await this.record(tx, merchantId, 'online.order_paid', order.id, { paymentId, saleId });
    // The branch gets its packing slip the moment the order is paid for (ADR-0123).
    await this.printJobs.queueOnlineOrderInTx(tx, {
      merchantId,
      branchId: order.branchId,
      onlineOrderId: order.id,
      userId: null,
    });
    return 'paid';
  }

  /**
   * The archived service product used for delivery fees on online sales. Its cost is 0 (a
   * service, not goods), so it never makes a period's gross profit "unavailable".
   */
  async deliveryLine(tx: Transaction, merchantId: string, feeMinor: bigint) {
    // Serialised per merchant so two first deliveries do not both create the item.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`delivery-item:${merchantId}`}))`);
    const [existing] = (
      await tx.execute(sql`
        select v.id as variant_id, p.id as product_id from product_variants v join products p on p.id = v.product_id
        where lower(v.sku) = 'online-delivery' limit 1`)
    ).rows as { variant_id: string; product_id: string }[];
    let ids = existing;
    if (!ids) {
      const productId = newId();
      const variantId = newId();
      await tx.execute(sql`
        insert into products (id, merchant_id, name_en, name_ar, type, track_inventory, status)
        values (${productId}, ${merchantId}, 'Delivery fee', 'رسوم التوصيل', 'service', false, 'archived')`);
      await tx.execute(sql`
        insert into product_variants (id, merchant_id, product_id, sku, price_minor, cost_minor, status)
        values (${variantId}, ${merchantId}, ${productId}, 'ONLINE-DELIVERY', 0, 0, 'archived')`);
      ids = { variant_id: variantId, product_id: productId };
    }
    return [
      {
        variantId: ids.variant_id,
        productId: ids.product_id,
        quantityMilli: 1000n,
        unitPriceMinor: feeMinor,
        nameEn: 'Delivery fee',
        nameAr: 'رسوم التوصيل',
        variantNameEn: null,
        variantNameAr: null,
        sku: 'ONLINE-DELIVERY',
      },
    ];
  }

  async setStatus(tx: Transaction, orderId: string, status: string, note: string | null) {
    await tx.execute(sql`
      update online_orders set status = ${status}, status_note = ${note}, updated_at = now(), version = version + 1,
             cancelled_at = case when ${status} in ('cancelled', 'payment_failed', 'expired') then now() else cancelled_at end,
             history = ${historyEntry(status)}
      where id = ${orderId}`);
  }

  async release(tx: Transaction, orderId: string) {
    await tx.execute(sql`
      update stock_reservations set status = 'released', released_at = now()
      where online_order_id = ${orderId} and status = 'active'`);
  }

  // ------------------------------------------------------------ reconciliation
  /**
   * Asks the gateway about every open attempt of the merchant's unpaid orders: confirmed
   * payments complete their order; past their reservation, unconfirmed orders expire and
   * release their stock (ADR-0079).
   */
  async reconcile(
    merchantId: string,
    orderId?: string,
  ): Promise<{ checked: number; paid: number; expired: number }> {
    const open = await this.database.withMerchantTx(
      merchantId,
      async (tx) =>
        (
          await tx.execute(sql`
          select p.id, p.provider, p.provider_reference, o.id as order_id, o.reserved_until < now() as due
          from online_payments p join online_orders o on o.id = p.online_order_id
          where o.status = 'pending_payment' and p.status = 'initiated'
            ${orderId ? sql`and o.id = ${orderId}` : sql``}`)
        ).rows as Row[],
    );
    let paid = 0;
    for (const p of open) {
      if (!p['provider_reference']) continue;
      let result: VerifiedPayment | null = null;
      try {
        result = await this.gateway(p['provider'] as string).verify(
          p['provider_reference'] as string,
        );
      } catch (error) {
        this.logger.warn(`verify failed for ${String(p['id'])}: ${(error as Error).message}`);
      }
      if (result && result.status !== 'pending') {
        try {
          const outcome = await this.database.withMerchantTx(merchantId, (tx) =>
            this.applyResult(tx, merchantId, p['id'] as string, result),
          );
          if (outcome === 'paid') paid += 1;
        } catch (error) {
          // One failing attempt must not stop the others or the expiry step.
          this.logger.error(`applying ${String(p['id'])} failed: ${(error as Error).message}`);
        }
      }
    }
    const expired = await this.database.withMerchantTx(merchantId, async (tx) => {
      // Lock order: payment attempts before orders, as in applyResult (no deadlock).
      await tx.execute(sql`
        select p.id from online_payments p join online_orders o on o.id = p.online_order_id
        where o.status = 'pending_payment' and o.reserved_until < now()
          ${orderId ? sql`and o.id = ${orderId}` : sql``}
        order by p.id for update of p`);
      const due = (
        await tx.execute(sql`
          select id from online_orders where status = 'pending_payment' and reserved_until < now()
            ${orderId ? sql`and id = ${orderId}` : sql``} order by id for update`)
      ).rows as { id: string }[];
      for (const o of due) {
        await tx.execute(sql`
          update online_payments set status = 'expired', updated_at = now(), completed_at = now()
          where online_order_id = ${o.id} and status = 'initiated'`);
        await this.setStatus(
          tx,
          o.id,
          'expired',
          'Not paid in time; the reserved stock was released.',
        );
        await this.release(tx, o.id);
        await this.record(tx, merchantId, 'online.order_expired', o.id, {});
      }
      return due.length;
    });
    return { checked: open.length, paid, expired };
  }

  async reconcileDue() {
    const rows = (await this.database.db.execute(sql`select online_orders_due_merchants() as m`))
      .rows as { m: string }[];
    for (const r of rows) {
      try {
        await this.reconcile(r.m);
      } catch (error) {
        // A failing merchant must not stop the others.
        this.logger.error(`reconcile failed for merchant ${r.m}: ${(error as Error).message}`);
      }
    }
  }

  private record(
    tx: Transaction,
    merchantId: string,
    action: string,
    orderId: string,
    details: Row,
  ) {
    return this.audit.recordIn(tx, {
      merchantId,
      actorType: 'system',
      action,
      targetType: 'online_order',
      targetId: orderId,
      details,
    });
  }
}

export type { GatewayStatus };
