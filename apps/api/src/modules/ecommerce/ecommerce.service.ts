import type {
  OnlineOrder,
  OnlineOrderStatus,
  OnlineStore,
  PublicOrder,
  StoreProduct,
  Storefront,
  onlineOrderActionSchema,
  onlineOrderListQuerySchema,
  saveOnlineStoreSchema,
  storeCheckoutSchema,
} from '@arabat/contracts';
import { Money, formatQuantity, parseQuantity, priceCart } from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { type SQL, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { FileStorage } from '../../kernel/storage/file-storage.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { ensureCustomerByPhone } from '../customers/customers.service.js';
import { stockConsumption } from '../inventory/consumption.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { parseAmount } from '../payments/payments.service.js';
import { SalesService } from '../sales/sales.service.js';
import {
  onlineOrderLines,
  onlineOrders,
  onlinePayments,
  onlineStores,
} from './ecommerce.schema.js';
import { OnlinePaymentsService, historyEntry } from './online-payments.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

type Row = Record<string, unknown>;
const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const MAX_CART_QTY = 20;

const STORE_CLOSED = () =>
  new AppError(409, 'STORE_CLOSED', 'This store is not taking orders right now.');

/** Allowed manager transitions of a paid order (BR-145). */
const NEXT: Record<string, OnlineOrderStatus[]> = {
  paid: ['preparing', 'ready', 'out_for_delivery', 'completed'],
  preparing: ['ready', 'out_for_delivery', 'completed'],
  ready: ['completed'],
  out_for_delivery: ['completed'],
};

/**
 * The online store (Prompt 16): manager configuration, the public storefront and checkout,
 * and online order fulfilment. Products, prices and availability come from the shared
 * catalog and inventory engine; a paid order becomes a sale through `SalesService`.
 */
@Injectable()
export class EcommerceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedgerService,
    private readonly sales: SalesService,
    private readonly payments: OnlinePaymentsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly storage: FileStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------ manager: store
  private assertManage(actor: MerchantActor) {
    if (!can(actor.access, 'online.manage', null)) throw AppError.forbidden();
  }

  private storeUrl(slug: string) {
    return `${this.env.PUBLIC_STORE_URL.replace(/\/$/, '')}/${slug}`;
  }

  private async onlineMethods(tx: Transaction) {
    return (
      await tx.execute(sql`
        select id, name_en, name_ar, gateway_provider from payment_methods
        where available_online and status = 'active' and gateway_provider is not null order by sort_order, name_en`)
    ).rows as Row[];
  }

  async store(actor: MerchantActor): Promise<OnlineStore> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(onlineStores);
      const methods = await this.onlineMethods(tx);
      const [m] = (
        await tx.execute(
          sql`select display_name_en, display_name_ar from merchants where id = ${actor.merchantId}`,
        )
      ).rows as Row[];
      const slug = row?.slug ?? `store-${actor.merchantId.slice(0, 8)}`;
      return {
        slug,
        status: (row?.status as OnlineStore['status']) ?? 'draft',
        nameEn: row?.nameEn ?? (m?.['display_name_en'] as string | null) ?? null,
        nameAr: row?.nameAr ?? (m?.['display_name_ar'] as string | null) ?? null,
        taglineEn: row?.taglineEn ?? null,
        taglineAr: row?.taglineAr ?? null,
        announcementEn: row?.announcementEn ?? null,
        announcementAr: row?.announcementAr ?? null,
        primaryColor: row?.primaryColor ?? '#1e3a8a',
        contactPhone: row?.contactPhone ?? null,
        contactEmail: row?.contactEmail ?? null,
        fulfillmentBranchId: row?.fulfillmentBranchId ?? null,
        pickupEnabled: row?.pickupEnabled ?? true,
        deliveryEnabled: row?.deliveryEnabled ?? false,
        deliveryFee: money(row?.deliveryFeeMinor ?? 0n),
        minimumOrder: money(row?.minimumOrderMinor ?? 0n),
        reservationMinutes: row?.reservationMinutes ?? 30,
        paymentMethods: methods.map((x) => ({
          id: x['id'] as string,
          nameEn: (x['name_en'] as string | null) ?? null,
          nameAr: (x['name_ar'] as string | null) ?? null,
          provider: x['gateway_provider'] as string,
          ready: this.payments.gateway(x['gateway_provider'] as string).ready,
        })),
        url: this.storeUrl(slug),
        version: row?.version ?? 0,
      };
    });
  }

  async saveStore(actor: MerchantActor, input: z.output<typeof saveOnlineStoreSchema>, ip: string) {
    this.assertManage(actor);
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [row] = await tx.select().from(onlineStores).for('update');
        if ((row?.version ?? 0) !== input.version) throw versionConflict();
        if (input.status !== 'draft')
          await this.subscriptions.assertFeature(tx, actor.merchantId, 'ecommerce');
        if (input.fulfillmentBranchId) {
          const [b] = (
            await tx.execute(
              sql`select status from branches where id = ${input.fulfillmentBranchId}`,
            )
          ).rows as Row[];
          if (!b) throw AppError.notFound('Branch not found.');
        }
        const values = {
          slug: input.slug,
          status: input.status,
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          taglineEn: input.taglineEn,
          taglineAr: input.taglineAr,
          announcementEn: input.announcementEn,
          announcementAr: input.announcementAr,
          primaryColor: input.primaryColor,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          fulfillmentBranchId: input.fulfillmentBranchId,
          pickupEnabled: input.pickupEnabled,
          deliveryEnabled: input.deliveryEnabled,
          deliveryFeeMinor: parseAmount(input.deliveryFee, 'deliveryFee'),
          minimumOrderMinor: parseAmount(input.minimumOrder, 'minimumOrder'),
          reservationMinutes: input.reservationMinutes,
        };
        if (
          input.status === 'published' &&
          (await this.onlineMethods(tx)).every(
            (m) => !this.payments.gateway(m['gateway_provider'] as string).ready,
          )
        )
          throw new AppError(
            409,
            'GATEWAY_NOT_CONFIGURED',
            'Enable at least one online payment method that can take payments.',
          );
        if (row)
          await tx
            .update(onlineStores)
            .set({ ...values, version: sql`${onlineStores.version} + 1`, updatedAt: sql`now()` });
        else await tx.insert(onlineStores).values({ merchantId: actor.merchantId, ...values });
        await this.record(
          tx,
          actor.merchantId,
          actor.userId,
          'online.store_updated',
          actor.merchantId,
          ip,
          { status: input.status, slug: input.slug },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'online_stores_slug_key'))
        throw new AppError(409, 'DUPLICATE_CODE', 'Another store already uses this address.', [
          { path: 'slug', code: 'duplicate', message: 'Another store already uses this address.' },
        ]);
      throw error;
    }
    return this.store(actor);
  }

  async listings(actor: MerchantActor) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select p.id, p.name_en, p.name_ar, exists (select 1 from online_listings l where l.product_id = p.id) as listed,
                 (select count(*)::int from product_variants v where v.product_id = p.id and v.status = 'active') as variants,
                 (select min(v.price_minor)::text from product_variants v where v.product_id = p.id and v.status = 'active') as price
          from products p where p.status = 'active' order by coalesce(lower(p.name_en), p.name_ar)`)
      ).rows as Row[];
      return {
        products: rows.map((r) => ({
          productId: r['id'] as string,
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
          listed: r['listed'] as boolean,
          variants: r['variants'] as number,
          price: r['price'] === null ? null : money(r['price'] as string),
        })),
      };
    });
  }

  async setListings(actor: MerchantActor, productIds: string[], listed: boolean, ip: string) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const ids = [...new Set(productIds)];
      if (!ids.length) return;
      const list = sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      );
      const found = (await tx.execute(sql`select id from products where id in (${list})`)).rows;
      if (found.length !== ids.length) throw AppError.notFound('Product not found.');
      if (listed)
        await tx.execute(sql`
          insert into online_listings (merchant_id, product_id)
          select ${actor.merchantId}, id from products where id in (${list}) on conflict do nothing`);
      else await tx.execute(sql`delete from online_listings where product_id in (${list})`);
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        listed ? 'online.products_listed' : 'online.products_unlisted',
        actor.merchantId,
        ip,
        { count: ids.length },
      );
    });
    return this.listings(actor);
  }

  // ------------------------------------------------------------ storefront (public)
  /** Resolves a public store slug to its merchant (published or paused stores only). */
  private async merchantOf(slug: string): Promise<string> {
    const [row] = (await this.database.db.execute(sql`select store_merchant(${slug}) as m`))
      .rows as { m: string | null }[];
    if (!row?.m) throw AppError.notFound('Store not found.');
    return row.m;
  }

  private async storeRow(tx: Transaction) {
    const [store] = await tx.select().from(onlineStores);
    if (!store || store.status === 'draft' || !store.fulfillmentBranchId)
      throw AppError.notFound('Store not found.');
    return store as typeof store & { fulfillmentBranchId: string };
  }

  async storefront(slug: string): Promise<Storefront> {
    const merchantId = await this.merchantOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const store = await this.storeRow(tx);
      const methods = (await this.onlineMethods(tx)).filter(
        (m) => this.payments.gateway(m['gateway_provider'] as string).ready,
      );
      const categories = (
        await tx.execute(sql`
          select distinct c.id, c.name_en, c.name_ar from categories c
          join products p on p.category_id = c.id join online_listings l on l.product_id = p.id
          where p.status = 'active' order by c.name_en`)
      ).rows as Row[];
      return {
        slug: store.slug,
        nameEn: store.nameEn,
        nameAr: store.nameAr,
        taglineEn: store.taglineEn,
        taglineAr: store.taglineAr,
        announcementEn: store.announcementEn,
        announcementAr: store.announcementAr,
        primaryColor: store.primaryColor,
        contactPhone: store.contactPhone,
        contactEmail: store.contactEmail,
        acceptingOrders: store.status === 'published',
        pickupEnabled: store.pickupEnabled,
        deliveryEnabled: store.deliveryEnabled,
        deliveryFee: money(store.deliveryFeeMinor),
        minimumOrder: money(store.minimumOrderMinor),
        paymentMethods: methods.map((m) => ({
          id: m['id'] as string,
          nameEn: (m['name_en'] as string | null) ?? null,
          nameAr: (m['name_ar'] as string | null) ?? null,
          provider: m['gateway_provider'] as string,
        })),
        categories: categories.map((c) => ({
          id: c['id'] as string,
          nameEn: (c['name_en'] as string | null) ?? null,
          nameAr: (c['name_ar'] as string | null) ?? null,
        })),
      };
    });
  }

  private async storeProducts(
    tx: Transaction,
    slug: string,
    branchId: string,
    where: SQL,
  ): Promise<StoreProduct[]> {
    const rows = (
      await tx.execute(sql`
        select p.id as product_id, p.name_en, p.name_ar, p.description_en, p.description_ar, p.category_id,
               p.track_inventory, v.id as variant_id, v.name_en as vn_en, v.name_ar as vn_ar, v.sku,
               v.price_minor::text as price,
               coalesce((select l.on_hand from stock_levels l where l.variant_id = v.id and l.branch_id = ${branchId}), 0)::text as on_hand,
               coalesce((select sum(r.quantity) from stock_reservations r where r.variant_id = v.id and r.branch_id = ${branchId}
                         and r.status = 'active' and r.expires_at > now()), 0)::text as reserved,
               (select i.id from product_images i where i.product_id = p.id order by i.position limit 1) as image_id,
               exists (select 1 from recipe_components rc where rc.variant_id = v.id) as has_recipe
        from online_listings ol join products p on p.id = ol.product_id
        join product_variants v on v.product_id = p.id
        where p.status = 'active' and v.status = 'active'
          and (p.available_in_all_branches or exists (select 1 from product_branch_availability a where a.product_id = p.id and a.branch_id = ${branchId}))
          and ${where}
        order by ol.position, coalesce(lower(p.name_en), p.name_ar), v.position`)
    ).rows as Row[];
    const out = new Map<string, StoreProduct>();
    for (const r of rows) {
      const id = r['product_id'] as string;
      const tracked = (r['track_inventory'] as boolean) && !(r['has_recipe'] as boolean);
      const free = parseQuantity(r['on_hand'] as string) - parseQuantity(r['reserved'] as string);
      const units = free > 0n ? Number(free / 1000n) : 0;
      const product = out.get(id) ?? {
        productId: id,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        descriptionEn: (r['description_en'] as string | null) ?? null,
        descriptionAr: (r['description_ar'] as string | null) ?? null,
        categoryId: (r['category_id'] as string | null) ?? null,
        imageUrl: r['image_id']
          ? `/api/v1/store/${slug}/images/${id}/${r['image_id'] as string}`
          : null,
        variants: [],
      };
      product.variants.push({
        variantId: r['variant_id'] as string,
        nameEn: (r['vn_en'] as string | null) ?? null,
        nameAr: (r['vn_ar'] as string | null) ?? null,
        sku: (r['sku'] as string | null) ?? null,
        price: money(r['price'] as string),
        available: !tracked || units > 0,
        maxQuantity: tracked ? Math.min(MAX_CART_QTY, units) : MAX_CART_QTY,
      });
      out.set(id, product);
    }
    return [...out.values()];
  }

  async products(slug: string) {
    const merchantId = await this.merchantOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const store = await this.storeRow(tx);
      return {
        products: await this.storeProducts(tx, store.slug, store.fulfillmentBranchId, sql`true`),
      };
    });
  }

  async product(slug: string, productId: string): Promise<StoreProduct> {
    const merchantId = await this.merchantOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const store = await this.storeRow(tx);
      const [p] = await this.storeProducts(
        tx,
        store.slug,
        store.fulfillmentBranchId,
        sql`p.id = ${productId}`,
      );
      if (!p) throw AppError.notFound('Product not found.');
      return p;
    });
  }

  async image(slug: string, productId: string, imageId: string) {
    const merchantId = await this.merchantOf(slug);
    const image = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`
          select i.storage_key, i.content_type from product_images i join online_listings l on l.product_id = i.product_id
          where i.id = ${imageId} and i.product_id = ${productId}`)
      ).rows as Row[];
      return row;
    });
    const data = image ? await this.storage.get(image['storage_key'] as string) : null;
    if (!image || !data) throw AppError.notFound('Image not found.');
    return { data, contentType: image['content_type'] as string };
  }

  /**
   * Places an online order: validated against the listing, priced by the shared pricing
   * engine at the fulfilment branch, stock reserved for `reservationMinutes`, then a
   * payment attempt is started at the gateway. Retries with the same key return the same
   * order (BR-141, BR-142).
   */
  async checkout(
    slug: string,
    input: z.output<typeof storeCheckoutSchema>,
    ip: string,
  ): Promise<PublicOrder> {
    const merchantId = await this.merchantOf(slug);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...input, idempotencyKey: undefined }))
      .digest('hex');
    const replay = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(onlineOrders)
        .where(eq(onlineOrders.idempotencyKey, input.idempotencyKey));
      if (!existing) return null;
      if (existing.requestHash !== requestHash)
        throw new AppError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This checkout key was already used for a different order.',
        );
      return existing.trackingToken;
    });
    if (replay) return this.track(slug, replay);
    // Unpaid orders past their reservation give their stock back before we check it.
    await this.payments.reconcile(merchantId).catch(() => undefined);

    const orderId = newId();
    const paymentId = newId();
    const token = randomBytes(16).toString('hex');
    let provider = '';
    let amountMinor = 0n;
    try {
      await this.database.withMerchantTx(merchantId, async (tx) => {
        const store = await this.storeRow(tx);
        if (store.status !== 'published') throw STORE_CLOSED();
        if (input.fulfillment === 'pickup' && !store.pickupEnabled) throw STORE_CLOSED();
        if (input.fulfillment === 'delivery' && !store.deliveryEnabled) throw STORE_CLOSED();
        const [method] = (await this.onlineMethods(tx)).filter(
          (m) => m['id'] === input.paymentMethodId,
        );
        if (!method)
          throw new AppError(
            409,
            'PAYMENT_METHOD_UNAVAILABLE',
            'This payment method is not available online.',
          );
        provider = method['gateway_provider'] as string;
        if (!this.payments.gateway(provider).ready)
          throw new AppError(
            409,
            'GATEWAY_NOT_CONFIGURED',
            'This payment method cannot take payments yet.',
          );
        const branchId = store.fulfillmentBranchId;
        const listed = await this.storeProducts(
          tx,
          store.slug,
          branchId,
          sql`v.id in (${sql.join(
            input.lines.map((l) => sql`${l.variantId}`),
            sql`, `,
          )})`,
        );
        const variants = new Map(
          listed.flatMap((p) => p.variants.map((v) => [v.variantId, { p, v }] as const)),
        );
        const items = await this.sales.loadItems(
          tx,
          branchId,
          input.lines.map((l) => l.variantId),
        );
        const issues = input.lines.flatMap((l, i) =>
          variants.has(l.variantId) && items.has(l.variantId)
            ? []
            : [
                {
                  path: `lines.${i}.variantId`,
                  code: 'unavailable',
                  message: 'This item is not sold online.',
                },
              ],
        );
        if (issues.length)
          throw new AppError(
            409,
            'ITEM_UNAVAILABLE',
            'Some items are not available online.',
            issues,
          );
        const lines = input.lines.map((l) => ({
          ...l,
          quantityMilli: parseQuantity(l.quantity),
          item: items.get(l.variantId)!,
        }));
        if (
          lines.some(
            (l) =>
              l.quantityMilli <= 0n ||
              l.quantityMilli % 1000n !== 0n ||
              l.quantityMilli > BigInt(MAX_CART_QTY * 1000),
          )
        )
          throw new AppError(
            400,
            'INVALID_QUANTITY',
            `Quantities are whole units up to ${MAX_CART_QTY}.`,
          );
        const priced = priceCart(
          lines.map((l) => ({
            unitPriceMinor: l.item.priceMinor,
            quantityMilli: l.quantityMilli,
            discount: null,
          })),
          null,
        );
        const deliveryFee = input.fulfillment === 'delivery' ? store.deliveryFeeMinor : 0n;
        if (priced.totalMinor < store.minimumOrderMinor)
          throw new AppError(
            409,
            'MINIMUM_ORDER',
            `The minimum order is ${Money.ofMinor(store.minimumOrderMinor, CURRENCY).toDecimalString()} KWD.`,
          );
        const total = priced.totalMinor + deliveryFee;
        if (total !== parseAmount(input.expectedTotal, 'expectedTotal'))
          throw new AppError(
            409,
            'TOTAL_CHANGED',
            'Prices changed. Review your cart and try again.',
          );
        amountMinor = total;
        const number = await nextDocumentNumber(tx, merchantId, 'online_order', 'W');
        const customerId = await ensureCustomerByPhone(tx, merchantId, {
          fullName: input.customer.name,
          phone: input.customer.phone,
          email: input.customer.email,
        });
        const reservedUntil = new Date(Date.now() + store.reservationMinutes * 60_000);
        await tx.insert(onlineOrders).values({
          id: orderId,
          merchantId,
          number,
          branchId,
          fulfillment: input.fulfillment,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          customerEmail: input.customer.email,
          deliveryAddress: input.fulfillment === 'delivery' ? input.deliveryAddress : null,
          note: input.note,
          customerId,
          subtotalMinor: priced.totalMinor,
          deliveryFeeMinor: deliveryFee,
          totalMinor: total,
          paymentMethodId: input.paymentMethodId,
          trackingToken: token,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          reservedUntil,
          history: sql`jsonb_build_array(jsonb_build_object('status', 'pending_payment', 'at', now()))`,
        });
        await tx.insert(onlineOrderLines).values(
          lines.map((l, position) => ({
            merchantId,
            orderId,
            position,
            variantId: l.variantId,
            productId: l.item.productId,
            nameEn: l.item.nameEn,
            nameAr: l.item.nameAr,
            variantNameEn: l.item.variantNameEn,
            variantNameAr: l.item.variantNameAr,
            sku: l.item.sku,
            quantity: formatQuantity(l.quantityMilli),
            unitPriceMinor: l.item.priceMinor,
            lineTotalMinor: priced.lines[position]!.netMinor,
          })),
        );
        // Hold the stock (recipe items hold their ingredients) until the reservation ends.
        const consumption = await stockConsumption(
          tx,
          lines.map((l) => ({
            variantId: l.variantId,
            quantityMilli: l.quantityMilli,
            modifierIds: [],
          })),
        );
        await this.ledger.reserve(
          tx,
          { merchantId, branchId, onlineOrderId: orderId, expiresAt: reservedUntil },
          consumption,
        );
        await tx.insert(onlinePayments).values({
          id: paymentId,
          merchantId,
          onlineOrderId: orderId,
          provider,
          amountMinor: total,
        });
        await this.record(tx, merchantId, null, 'online.order_placed', orderId, ip, {
          number,
          total: Money.ofMinor(total, CURRENCY).toDecimalString(),
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'online_orders_idempotency_key')) {
        const again = await this.database.withMerchantTx(merchantId, async (tx) => {
          const [o] = await tx
            .select()
            .from(onlineOrders)
            .where(eq(onlineOrders.idempotencyKey, input.idempotencyKey));
          // A concurrent duplicate must carry the same request (audit fix).
          if (o && o.requestHash !== requestHash)
            throw new AppError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'This checkout key was already used for a different order.',
            );
          return o?.trackingToken ?? null;
        });
        if (again) return this.track(slug, again);
      }
      throw error;
    }

    // Start the payment at the gateway (outside the database transaction).
    try {
      const started = await this.payments.gateway(provider).initiate({
        paymentId,
        amountMinor,
        currency: CURRENCY,
        description: `Order ${orderId}`,
        customer: {
          name: input.customer.name,
          phone: input.customer.phone,
          email: input.customer.email,
        },
        returnUrl: `${this.storeUrl(slug)}/orders/${token}`,
      });
      await this.database.withMerchantTx(merchantId, (tx) =>
        tx
          .update(onlinePayments)
          .set({
            providerReference: started.providerReference,
            redirectUrl: started.redirectUrl,
            updatedAt: sql`now()`,
          })
          .where(eq(onlinePayments.id, paymentId)),
      );
    } catch (error) {
      await this.database.withMerchantTx(merchantId, async (tx) => {
        await tx
          .update(onlinePayments)
          .set({
            status: 'failed',
            failureReason: (error as Error).message,
            completedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(onlinePayments.id, paymentId));
        await this.payments.setStatus(
          tx,
          orderId,
          'payment_failed',
          'The payment could not be started.',
        );
        await this.payments.release(tx, orderId);
      });
    }
    return this.track(slug, token);
  }

  /** Public order page: status and timeline; pending payments are verified with the gateway. */
  async track(slug: string, token: string): Promise<PublicOrder> {
    const merchantId = await this.merchantOf(slug);
    const id = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [o] = await tx
        .select({ id: onlineOrders.id, status: onlineOrders.status })
        .from(onlineOrders)
        .where(eq(onlineOrders.trackingToken, token));
      if (!o) throw AppError.notFound('Order not found.');
      return o;
    });
    if (id.status === 'pending_payment') await this.payments.reconcile(merchantId, id.id);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const order = await this.orderIn(tx, id.id);
      return this.publicView(order);
    });
  }

  private publicView(o: OnlineOrder): PublicOrder {
    return {
      number: o.number,
      status: o.status,
      fulfillment: o.fulfillment,
      customerName: o.customerName,
      lines: o.lines,
      subtotal: o.subtotal,
      deliveryFee: o.deliveryFee,
      total: o.total,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      reservedUntil: o.reservedUntil,
      trackingToken: o.trackingToken,
      paymentUrl: o.paymentUrl,
      timeline: o.timeline,
    };
  }

  // ------------------------------------------------------------ orders (manager)
  private async orderIn(tx: Transaction, id: string): Promise<OnlineOrder> {
    const [o] = (
      await tx.execute(sql`
        select o.*, s.receipt_number, pm.name_en as pm_en, pm.name_ar as pm_ar, pm.gateway_provider
        from online_orders o left join sales s on s.id = o.sale_id join payment_methods pm on pm.id = o.payment_method_id
        where o.id = ${id}`)
    ).rows as Row[];
    if (!o) throw AppError.notFound('Order not found.');
    const lines = await tx
      .select()
      .from(onlineOrderLines)
      .where(eq(onlineOrderLines.orderId, id))
      .orderBy(onlineOrderLines.position);
    const attempts = await tx
      .select()
      .from(onlinePayments)
      .where(eq(onlinePayments.onlineOrderId, id))
      .orderBy(onlinePayments.createdAt);
    const open = attempts.find((a) => a.status === 'initiated' && a.redirectUrl);
    return {
      id,
      number: o['number'] as string,
      branchId: o['branch_id'] as string,
      status: o['status'] as OnlineOrderStatus,
      fulfillment: o['fulfillment'] as 'pickup',
      customerName: o['customer_name'] as string,
      customerPhone: o['customer_phone'] as string,
      customerEmail: (o['customer_email'] as string | null) ?? null,
      deliveryAddress: (o['delivery_address'] as string | null) ?? null,
      note: (o['note'] as string | null) ?? null,
      customerId: (o['customer_id'] as string | null) ?? null,
      saleId: (o['sale_id'] as string | null) ?? null,
      receiptNumber: (o['receipt_number'] as string | null) ?? null,
      lines: lines.map((l) => ({
        position: l.position,
        variantId: l.variantId,
        productId: l.productId,
        nameEn: l.nameEn,
        nameAr: l.nameAr,
        variantNameEn: l.variantNameEn,
        variantNameAr: l.variantNameAr,
        sku: l.sku,
        quantity: formatQuantity(parseQuantity(l.quantity)),
        unitPrice: money(l.unitPriceMinor),
        lineTotal: money(l.lineTotalMinor),
      })),
      subtotal: money(o['subtotal_minor'] as string),
      deliveryFee: money(o['delivery_fee_minor'] as string),
      total: money(o['total_minor'] as string),
      createdAt: iso(o['created_at'])!,
      paidAt: iso(o['paid_at']),
      reservedUntil: iso(o['reserved_until'])!,
      trackingToken: o['tracking_token'] as string,
      paymentUrl: o['status'] === 'pending_payment' ? (open?.redirectUrl ?? null) : null,
      timeline: (o['history'] as { status: OnlineOrderStatus; at: string }[]).map((h) => ({
        status: h.status,
        at: new Date(h.at).toISOString(),
      })),
      paymentMethod: {
        nameEn: (o['pm_en'] as string | null) ?? null,
        nameAr: (o['pm_ar'] as string | null) ?? null,
        provider: (o['gateway_provider'] as string | null) ?? '',
      },
      payments: attempts.map((a) => ({
        id: a.id,
        provider: a.provider,
        providerReference: a.providerReference,
        status: a.status as 'initiated',
        amount: money(a.amountMinor),
        failureReason: a.failureReason,
        createdAt: a.createdAt.toISOString(),
        completedAt: a.completedAt?.toISOString() ?? null,
      })),
      statusNote: (o['status_note'] as string | null) ?? null,
      version: o['version'] as number,
    };
  }

  private orderScope(actor: MerchantActor): SQL {
    const scope = permissionBranchScope(actor.access, 'online.orders');
    if (scope.all) return sql`true`;
    if (!scope.branchIds.length) throw AppError.forbidden();
    return sql`o.branch_id in (${sql.join(
      scope.branchIds.map((b) => sql`${b}`),
      sql`, `,
    )})`;
  }

  async listOrders(actor: MerchantActor, query: z.output<typeof onlineOrderListQuerySchema>) {
    const scope = this.orderScope(actor);
    await this.payments.reconcile(actor.merchantId).catch(() => undefined);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const where = sql`${scope} ${query.status ? sql`and o.status = ${query.status}` : sql``}`;
      const ids = (
        await tx.execute(
          sql`select o.id from online_orders o where ${where} order by o.created_at desc limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`,
        )
      ).rows as { id: string }[];
      const [count] = (
        await tx.execute(sql`select count(*)::int as n from online_orders o where ${where}`)
      ).rows as { n: number }[];
      const counts = (
        await tx.execute(
          sql`select o.status, count(*)::int as n from online_orders o where ${scope} group by 1`,
        )
      ).rows as { status: string; n: number }[];
      const orders: Omit<OnlineOrder, 'lines' | 'payments' | 'timeline'>[] = [];
      for (const { id } of ids) {
        const { lines: _l, payments: _p, timeline: _t, ...rest } = await this.orderIn(tx, id);
        orders.push(rest);
      }
      return {
        orders,
        total: count!.n,
        page: query.page,
        pageSize: query.pageSize,
        counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      };
    });
  }

  async getOrder(actor: MerchantActor, id: string): Promise<OnlineOrder> {
    const scope = this.orderScope(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [visible] = (
        await tx.execute(sql`select 1 from online_orders o where o.id = ${id} and ${scope}`)
      ).rows;
      if (!visible) throw AppError.notFound('Order not found.');
      return this.orderIn(tx, id);
    });
  }

  async act(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof onlineOrderActionSchema>,
    ip: string,
  ) {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      // Lock order: payment attempts before the order, as the payment handler does.
      await tx.execute(
        sql`select id from online_payments where online_order_id = ${id} order by id for update`,
      );
      const [order] = await tx
        .select()
        .from(onlineOrders)
        .where(eq(onlineOrders.id, id))
        .for('update');
      if (!order) throw AppError.notFound('Order not found.');
      assertCan(actor, 'online.orders', order.branchId);
      if (order.version !== input.version) throw versionConflict();
      if (input.action === 'cancel') {
        // Unpaid orders release their stock; paid ones are refunded through a refund of the sale.
        if (!['pending_payment', 'needs_attention'].includes(order.status))
          throw new AppError(
            409,
            'INVALID_STATE',
            'Paid orders are cancelled by refunding their sale.',
          );
        await tx.execute(
          sql`update online_payments set status = 'cancelled', updated_at = now(), completed_at = now() where online_order_id = ${id} and status = 'initiated'`,
        );
        await this.payments.setStatus(tx, id, 'cancelled', input.note);
        await this.payments.release(tx, id);
      } else {
        if (!(NEXT[order.status] ?? []).includes(input.action))
          throw new AppError(409, 'INVALID_STATE', 'This step is not possible for the order now.');
        if (input.action === 'ready' && order.fulfillment !== 'pickup')
          throw new AppError(409, 'INVALID_STATE', 'Delivery orders go out for delivery.');
        if (input.action === 'out_for_delivery' && order.fulfillment !== 'delivery')
          throw new AppError(409, 'INVALID_STATE', 'Pickup orders are made ready.');
        await tx.execute(sql`
          update online_orders set status = ${input.action}, status_note = ${input.note}, updated_at = now(), version = version + 1,
                 completed_at = case when ${input.action} = 'completed' then now() else completed_at end,
                 history = ${historyEntry(input.action)}
          where id = ${id}`);
      }
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        `online.order_${input.action}`,
        id,
        ip,
        {},
      );
    });
    return this.getOrder(actor, id);
  }

  async reconcileNow(actor: MerchantActor) {
    this.assertManage(actor);
    return this.payments.reconcile(actor.merchantId);
  }

  // ------------------------------------------------------------ mock gateway page
  async mockPayment(reference: string) {
    const merchantId = await this.mockMerchant(reference);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`
          select p.id, p.amount_minor::text as amount, p.status, o.number, o.tracking_token, s.slug,
                 coalesce(s.name_en, s.name_ar) as name
          from online_payments p join online_orders o on o.id = p.online_order_id join online_stores s on true
          where p.provider = 'mock' and p.provider_reference = ${reference}`)
      ).rows as Row[];
      if (!row) throw AppError.notFound();
      return {
        paymentId: row['id'] as string,
        merchantName: (row['name'] as string | null) ?? '',
        orderNumber: row['number'] as string,
        amount: money(row['amount'] as string),
        status: row['status'] as 'initiated',
        returnUrl: `${this.storeUrl(row['slug'] as string)}/orders/${row['tracking_token'] as string}`,
      };
    });
  }

  /** The customer's choice on the test page: the mock gateway sends its signed notification. */
  async mockComplete(reference: string, outcome: 'succeeded' | 'failed' | 'cancelled') {
    const page = await this.mockPayment(reference);
    if (page.status !== 'initiated') return page;
    const mock = this.payments.mock();
    const { body, signature } = mock.settle(
      reference,
      outcome,
      Money.parse(page.amount.amount, CURRENCY).minor,
    );
    await this.payments.handleWebhook('mock', { 'x-mock-signature': signature }, body);
    return this.mockPayment(reference);
  }

  private async mockMerchant(reference: string) {
    this.payments.mock();
    const [row] = (
      await this.database.db.execute(sql`select online_payment_merchant('mock', ${reference}) as m`)
    ).rows as { m: string | null }[];
    if (!row?.m) throw AppError.notFound();
    return row.m;
  }

  private record(
    tx: Transaction,
    merchantId: string,
    userId: string | null,
    action: string,
    id: string,
    ip: string,
    details: Row,
  ) {
    return this.audit.recordIn(tx, {
      merchantId,
      actorType: userId ? 'user' : 'anonymous',
      actorId: userId,
      action,
      targetType: 'online_order',
      targetId: id,
      ip,
      details,
    });
  }
}
