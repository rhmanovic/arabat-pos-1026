import type {
  Listing,
  OnlineCollection,
  OnlineOrder,
  OnlineOrderStatus,
  OnlineStore,
  PublicOrder,
  SlugAvailability,
  StoreCategory,
  StoreCategoryList,
  StoreHours,
  StoreProduct,
  StoreQuoteResult,
  StoreSlotList,
  Storefront,
  onlineOrderActionSchema,
  onlineOrderListQuerySchema,
  saveListingSchema,
  saveListingsSchema,
  saveOnlineCollectionSchema,
  saveOnlineStoreSchema,
  saveStoreCategorySchema,
  storeCheckoutSchema,
  storeQuoteSchema,
} from '@arabat/contracts';
import {
  MAX_STORE_IMAGE_BYTES,
  RESERVED_STORE_SLUGS,
  STORE_SLUG_PATTERN,
  normalizePhone,
} from '@arabat/contracts';
import { type FeeType, Money, formatQuantity, parseQuantity, priceCart } from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { type PosPaymentMethod, checkPayments } from '@arabat/pos-core';
import { Inject, Injectable } from '@nestjs/common';
import { type SQL, and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { diffFields } from '../../kernel/audit-diff.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { rules } from '../../kernel/errors/pos-rule.js';
import { newId } from '../../kernel/ids.js';
import { FileStorage } from '../../kernel/storage/file-storage.js';
import { toStorableImage } from '../../kernel/storage/image.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { ensureCustomerByPhone } from '../customers/customers.service.js';
import { stockConsumption } from '../inventory/consumption.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { parseAmount } from '../payments/payments.service.js';
import { SalesService } from '../sales/sales.service.js';
import { categories, products } from '../catalog/catalog.schema.js';
import {
  onlineCollectionProducts,
  onlineCollections,
  onlineListings,
  onlineOrderLines,
  onlineOrders,
  onlinePayments,
  onlineStoreSlugHistory,
  onlineStores,
} from './ecommerce.schema.js';
import { OnlinePaymentsService, historyEntry } from './online-payments.service.js';
import { FulfilmentService, type ServingBranch } from './fulfilment.service.js';
import { type OrderEvent, OrderNotificationsService } from './order-notifications.service.js';
import { PrintJobsService } from '../printing/print-jobs.service.js';
import { isOpenAt, slotsFrom } from './store-hours.js';
import { merchantTimezone } from '../../kernel/time/period.js';
import { type PromotionLine, PromotionsService } from './promotions.service.js';
import { type StoreCustomer, StoreAccountsService } from './store-accounts.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

type Row = Record<string, unknown>;
const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const MAX_CART_QTY = 20;

const STORE_CLOSED = () =>
  new AppError(409, 'STORE_CLOSED', 'This store is not taking orders right now.');
/** A former store address keeps answering for this long (ADR-0118). */
const SLUG_HISTORY_DAYS = 90;
/** A public store address can be changed at most once in this many hours. */
const SLUG_RENAME_HOURS = 24;

/** Allowed manager transitions (BR-146): paid gateway orders and confirmed pay-on-receipt orders. */
const NEXT: Record<string, OnlineOrderStatus[]> = {
  placed: ['confirmed'],
  confirmed: ['preparing', 'ready', 'out_for_delivery', 'completed'],
  paid: ['preparing', 'ready', 'out_for_delivery', 'completed'],
  preparing: ['ready', 'out_for_delivery', 'completed'],
  ready: ['completed'],
  out_for_delivery: ['completed'],
};
type StoreImageKind = 'logo' | 'banner';
const imageUrl = (path: string, version: number) => `/api/v1/${path}?v=${version}`;

/**
 * Where the storefront's pictures are served: the public store routes, or the console's own
 * routes while the merchant previews a store that is not public yet (ADR-0128).
 */
interface StoreUrls {
  logo: (version: number) => string;
  banner: (version: number) => string;
  category: (id: string, version: number) => string;
  collection: (id: string, version: number) => string;
  productImage: (productId: string, imageId: string) => string;
}
const publicUrls = (slug: string): StoreUrls => ({
  logo: (v) => imageUrl(`store/${slug}/logo`, v),
  banner: (v) => imageUrl(`store/${slug}/banner`, v),
  category: (id, v) => imageUrl(`store/${slug}/categories/${id}/image`, v),
  collection: (id, v) => imageUrl(`store/${slug}/collections/${id}/image`, v),
  productImage: (productId, imageId) => `/api/v1/store/${slug}/images/${productId}/${imageId}`,
});
const PREVIEW_URLS: StoreUrls = {
  logo: (v) => imageUrl('manager/online/store/logo', v),
  banner: (v) => imageUrl('manager/online/store/banner', v),
  category: (id, v) => imageUrl(`manager/online/categories/${id}/image`, v),
  collection: (id, v) => imageUrl(`manager/online/collections/${id}/image`, v),
  productImage: (productId, imageId) => `/api/v1/manager/products/${productId}/images/${imageId}`,
};

/** Statuses of a pay-on-receipt order whose payment can still be recorded (ADR-0118). */
const PAYABLE: OnlineOrderStatus[] = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
];

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
    private readonly fulfilment: FulfilmentService,
    private readonly notifications: OrderNotificationsService,
    private readonly printJobs: PrintJobsService,
    private readonly promotions: PromotionsService,
    private readonly accounts: StoreAccountsService,
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
      // Until the merchant chooses otherwise, the main branch fulfils online orders: a store
      // with one branch publishes without hunting for the field (owner's report, 2026-10-20).
      const [mainBranch] = (
        await tx.execute(
          sql`select id from branches where status = 'active' order by is_main desc, created_at limit 1`,
        )
      ).rows as { id: string }[];
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
        fulfillmentBranchId: row?.fulfillmentBranchId ?? mainBranch?.id ?? null,
        pickupEnabled: row?.pickupEnabled ?? true,
        deliveryEnabled: row?.deliveryEnabled ?? false,
        deliveryFee: money(row?.deliveryFeeMinor ?? 0n),
        minimumOrder: money(row?.minimumOrderMinor ?? 0n),
        reservationMinutes: row?.reservationMinutes ?? 30,
        payOnReceiptEnabled: row?.payOnReceiptEnabled ?? true,
        logoUrl: row?.logoKey ? imageUrl('manager/online/store/logo', row.version) : null,
        bannerUrl: row?.bannerKey ? imageUrl('manager/online/store/banner', row.version) : null,
        hideOutOfStock: row?.hideOutOfStock ?? false,
        hours: (row?.hours as StoreHours) ?? null,
        schedulingEnabled: row?.schedulingEnabled ?? false,
        slotMinutes: row?.slotMinutes ?? 30,
        slotCapacity: row?.slotCapacity ?? null,
        notifyEmail: row?.notifyEmail ?? true,
        accountsEnabled: row?.accountsEnabled ?? true,
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
          payOnReceiptEnabled: input.payOnReceiptEnabled,
          hideOutOfStock: input.hideOutOfStock,
          hours: input.hours,
          schedulingEnabled: input.schedulingEnabled,
          slotMinutes: input.slotMinutes,
          slotCapacity: input.slotCapacity,
          notifyEmail: input.notifyEmail,
          accountsEnabled: input.accountsEnabled,
        };
        // A published store must offer some way to pay: on hand-over, or a gateway that works.
        if (
          input.status === 'published' &&
          !input.payOnReceiptEnabled &&
          (await this.onlineMethods(tx)).every(
            (m) => !this.payments.gateway(m['gateway_provider'] as string).ready,
          )
        )
          throw new AppError(
            409,
            'NO_PAYMENT_OPTION',
            'Allow payment on receipt, or enable an online payment method that can take payments.',
          );
        // One address namespace with link pages and recently renamed stores (ADR-0118).
        if (!(await this.slugFree(tx, input.slug, actor.merchantId))) throw slugTaken();
        const renamed = row !== undefined && row.slug.toLowerCase() !== input.slug;
        if (renamed && row.status !== 'draft') {
          // A public address changes at most once a day and keeps answering for 90 days.
          if (await this.renamedRecently(tx, actor.merchantId))
            throw new AppError(
              409,
              'RENAME_LIMIT',
              `The store address can be changed once every ${SLUG_RENAME_HOURS} hours.`,
              [{ path: 'slug', code: 'rename_limit', message: 'Changed too recently.' }],
            );
          await tx.insert(onlineStoreSlugHistory).values({
            id: newId(),
            merchantId: actor.merchantId,
            slug: row.slug,
            expiresAt: sql`now() + make_interval(days => ${SLUG_HISTORY_DAYS})`,
          });
        }
        if (row)
          await tx
            .update(onlineStores)
            .set({ ...values, version: sql`${onlineStores.version} + 1`, updatedAt: sql`now()` });
        else await tx.insert(onlineStores).values({ merchantId: actor.merchantId, ...values });
        if (renamed)
          await this.record(
            tx,
            actor.merchantId,
            actor.userId,
            'online.store_renamed',
            actor.merchantId,
            ip,
            { from: row.slug, to: input.slug },
          );
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
      if (isUniqueViolation(error, 'online_stores_slug_key')) throw slugTaken();
      throw error;
    }
    return this.store(actor);
  }

  private async slugFree(tx: Transaction, slug: string, merchantId: string) {
    const [row] = (await tx.execute(sql`select link_slug_available(${slug}, ${merchantId}) as ok`))
      .rows as { ok: boolean }[];
    return row?.ok === true;
  }

  private async renamedRecently(tx: Transaction, merchantId: string) {
    const [row] = (
      await tx.execute(sql`
        select 1 from online_store_slug_history where merchant_id = ${merchantId}
          and replaced_at > now() - make_interval(hours => ${SLUG_RENAME_HOURS}) limit 1`)
    ).rows;
    return row !== undefined;
  }

  /**
   * Whether the merchant may take a store address, with free alternatives when not: the
   * format, the reserved words, other stores and link pages, and the daily rename limit of a
   * public store (ADR-0118).
   */
  async slugAvailability(actor: MerchantActor, raw: string): Promise<SlugAvailability> {
    this.assertManage(actor);
    const slug = raw.trim().toLowerCase();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(onlineStores);
      const current = row?.slug.toLowerCase() ?? null;
      const free = async (candidate: string) =>
        STORE_SLUG_PATTERN.test(candidate) &&
        !RESERVED_STORE_SLUGS.includes(candidate) &&
        (await this.slugFree(tx, candidate, actor.merchantId));
      let reason: SlugAvailability['reason'] = null;
      if (!STORE_SLUG_PATTERN.test(slug)) reason = 'invalid';
      else if (RESERVED_STORE_SLUGS.includes(slug)) reason = 'reserved';
      else if (!(await this.slugFree(tx, slug, actor.merchantId))) reason = 'taken';
      else if (
        current !== null &&
        slug !== current &&
        row?.status !== 'draft' &&
        (await this.renamedRecently(tx, actor.merchantId))
      )
        reason = 'rename_limit';
      const suggestions: string[] = [];
      if (reason !== null && reason !== 'rename_limit') {
        const base =
          slug
            .normalize('NFKD')
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 30) || 'store';
        const candidates = [
          base.length >= 2 ? base : `${base}-store`,
          `${base}-store`,
          `${base}-shop`,
          `${base}-kw`,
          ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${base}-${n}`),
        ];
        for (const candidate of candidates) {
          if (suggestions.length === 3) break;
          if (candidate !== slug && !suggestions.includes(candidate) && (await free(candidate)))
            suggestions.push(candidate);
        }
      }
      return { slug, available: reason === null, reason, suggestions };
    });
  }

  /** Tenders staff may record for a pay-on-receipt order: active POS methods without a gateway. */
  async tenders(actor: MerchantActor) {
    this.orderScope(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select id, name_en, name_ar, kind from payment_methods
          where status = 'active' and available_in_pos and gateway_provider is null order by sort_order, name_en`)
      ).rows as Row[];
      const settings = await this.sales.getSettingsInTx(tx, actor.merchantId);
      return {
        tenders: rows.map((r) => ({
          id: r['id'] as string,
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
          kind: r['kind'] as string,
          requiresReference: r['kind'] !== 'cash' && settings.requireTenderReference,
        })),
      };
    });
  }

  async listings(actor: MerchantActor): Promise<{ products: Listing[] }> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      products: await this.listingRows(tx),
    }));
  }

  /** Every active product with its online attributes, in the store's display order. */
  private async listingRows(tx: Transaction): Promise<Listing[]> {
    const rows = (
      await tx.execute(sql`
        select p.id, p.name_en, p.name_ar, p.category_id, p.pos_visible, p.track_inventory,
               c.name_en as c_en, c.name_ar as c_ar,
               coalesce(l.visible, false) as visible, coalesce(l.position, 0) as position,
               l.title_en, l.title_ar, l.description_en, l.description_ar, coalesce(l.featured, false) as featured,
               l.max_per_order,
               coalesce((select json_agg(cp.collection_id order by cp.created_at) from online_collection_products cp where cp.product_id = p.id), '[]'::json) as collections,
               (select count(*)::int from product_variants v where v.product_id = p.id and v.status = 'active') as variants,
               (select min(v.price_minor)::text from product_variants v where v.product_id = p.id and v.status = 'active') as price,
               coalesce((select json_agg(i.id order by i.position, i.created_at) from product_images i where i.product_id = p.id), '[]'::json) as images
        from products p
        left join online_listings l on l.product_id = p.id
        left join categories c on c.id = p.category_id and c.status = 'active'
        where p.status = 'active'
        order by (l.product_id is null), l.position, coalesce(lower(p.name_en), p.name_ar)`)
    ).rows as Row[];
    return rows.map((r) => ({
      productId: r['id'] as string,
      nameEn: (r['name_en'] as string | null) ?? null,
      nameAr: (r['name_ar'] as string | null) ?? null,
      visible: r['visible'] as boolean,
      posVisible: r['pos_visible'] as boolean,
      variants: r['variants'] as number,
      price: r['price'] === null ? null : money(r['price'] as string),
      trackInventory: r['track_inventory'] as boolean,
      position: r['position'] as number,
      titleEn: (r['title_en'] as string | null) ?? null,
      titleAr: (r['title_ar'] as string | null) ?? null,
      descriptionEn: (r['description_en'] as string | null) ?? null,
      descriptionAr: (r['description_ar'] as string | null) ?? null,
      featured: r['featured'] as boolean,
      maxPerOrder: (r['max_per_order'] as number | null) ?? null,
      // A product in an archived category is shown without one, as at the point of sale.
      category:
        r['category_id'] && (r['c_en'] !== null || r['c_ar'] !== null)
          ? {
              id: r['category_id'] as string,
              nameEn: (r['c_en'] as string | null) ?? null,
              nameAr: (r['c_ar'] as string | null) ?? null,
            }
          : null,
      collectionIds: r['collections'] as string[],
      images: (r['images'] as string[]).map((id) => ({
        id,
        url: `/api/v1/manager/products/${r['id'] as string}/images/${id}`,
      })),
    }));
  }

  /** The store's own text and options for one product (ADR-0121), its category and collections. */
  async saveListing(
    actor: MerchantActor,
    productId: string,
    input: z.output<typeof saveListingSchema>,
    ip: string,
  ) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx
        .select({ productId: onlineListings.productId })
        .from(onlineListings)
        .where(eq(onlineListings.productId, productId))
        .for('update');
      if (!row) throw AppError.notFound('Product not found.');
      if (input.categoryId !== undefined)
        await this.moveToCategory(tx, actor, [productId], input.categoryId, ip);
      if (input.collectionIds)
        await this.setProductCollections(tx, actor.merchantId, productId, input.collectionIds);
      await tx
        .update(onlineListings)
        .set({
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          descriptionEn: input.descriptionEn,
          descriptionAr: input.descriptionAr,
          featured: input.featured,
          maxPerOrder: input.maxPerOrder,
          ...(input.visible === undefined ? {} : { visible: input.visible }),
          updatedAt: sql`now()`,
        })
        .where(eq(onlineListings.productId, productId));
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        'online.listing_updated',
        productId,
        ip,
        {
          featured: input.featured,
          ...(input.visible === undefined ? {} : { visible: input.visible }),
          ...(input.collectionIds ? { collectionIds: input.collectionIds } : {}),
        },
      );
    });
    return this.listings(actor);
  }

  /**
   * Puts products in a shared category (ADR-0130). The category is the point of sale's too, so
   * this needs `catalog.manage`; products already there are left untouched.
   */
  private async moveToCategory(
    tx: Transaction,
    actor: MerchantActor,
    productIds: string[],
    categoryId: string | null,
    ip: string,
  ) {
    const list = sql.join(
      productIds.map((i) => sql`${i}`),
      sql`, `,
    );
    const moving = (
      await tx.execute(sql`
        select id, category_id from products
        where id in (${list}) and category_id is distinct from ${categoryId} for update`)
    ).rows as Row[];
    if (moving.length === 0) return;
    assertCan(actor, 'catalog.manage', null);
    if (categoryId) {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.status, 'active')));
      if (!category) throw AppError.notFound('Category not found.');
    }
    for (const p of moving) {
      await tx
        .update(products)
        .set({
          categoryId,
          version: sql`${products.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(products.id, p['id'] as string));
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'product.updated',
        targetType: 'product',
        targetId: p['id'] as string,
        ip,
        details: {
          changes: { categoryId: { from: p['category_id'] ?? null, to: categoryId } },
          via: 'online',
        },
      });
    }
  }

  /** A product's collections, replaced by `collectionIds`; new ones put it at their end. */
  private async setProductCollections(
    tx: Transaction,
    merchantId: string,
    productId: string,
    collectionIds: string[],
  ) {
    const ids = [...new Set(collectionIds)];
    if (ids.length) {
      const found = await tx
        .select({ id: onlineCollections.id })
        .from(onlineCollections)
        .where(inArray(onlineCollections.id, ids));
      if (found.length !== ids.length) throw AppError.notFound('Collection not found.');
    }
    await tx
      .delete(onlineCollectionProducts)
      .where(
        and(
          eq(onlineCollectionProducts.productId, productId),
          ids.length ? notInArray(onlineCollectionProducts.collectionId, ids) : undefined,
        ),
      );
    for (const collectionId of ids)
      await tx.execute(sql`
        insert into online_collection_products (merchant_id, collection_id, product_id, position)
        values (${merchantId}, ${collectionId}, ${productId},
          (select coalesce(max(position), -1) + 1 from online_collection_products where collection_id = ${collectionId}))
        on conflict do nothing`);
  }

  /** Display order: every active product exactly once. */
  async orderListings(actor: MerchantActor, productIds: string[], ip: string) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select l.product_id as id from online_listings l join products p on p.id = l.product_id
          where p.status = 'active' for update of l`)
      ).rows as { id: string }[];
      const known = new Set(rows.map((r) => r.id));
      if (
        new Set(productIds).size !== productIds.length ||
        productIds.length !== known.size ||
        productIds.some((i) => !known.has(i))
      )
        throw AppError.validation([
          {
            path: 'productIds',
            code: 'invalid',
            message: 'List every product of the store exactly once.',
          },
        ]);
      for (const [position, productId] of productIds.entries())
        await tx
          .update(onlineListings)
          .set({ position, updatedAt: sql`now()` })
          .where(eq(onlineListings.productId, productId));
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        'online.listings_reordered',
        actor.merchantId,
        ip,
        { count: productIds.length },
      );
    });
    return this.listings(actor);
  }

  /** Bulk actions on selected products: show / hide on the website, category, collection. */
  async setListings(actor: MerchantActor, input: z.output<typeof saveListingsSchema>, ip: string) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const ids = [...new Set(input.productIds)];
      if (!ids.length) return;
      const list = sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      );
      const found = (await tx.execute(sql`select id from products where id in (${list})`)).rows;
      if (found.length !== ids.length) throw AppError.notFound('Product not found.');
      if (input.visible !== undefined)
        await tx.execute(sql`
          update online_listings set visible = ${input.visible}, updated_at = now()
          where product_id in (${list}) and visible <> ${input.visible}`);
      if (input.categoryId !== undefined)
        await this.moveToCategory(tx, actor, ids, input.categoryId, ip);
      if (input.addToCollectionId) {
        await this.lockCollection(tx, input.addToCollectionId);
        await tx.execute(sql`
          insert into online_collection_products (merchant_id, collection_id, product_id, position)
          select ${actor.merchantId}, ${input.addToCollectionId}, p.id,
            (select coalesce(max(position), -1) from online_collection_products where collection_id = ${input.addToCollectionId})
              + row_number() over (order by coalesce(lower(p.name_en), p.name_ar))
          from products p where p.id in (${list}) on conflict do nothing`);
      }
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        input.visible === true
          ? 'online.products_shown'
          : input.visible === false
            ? 'online.products_hidden'
            : 'online.products_updated',
        actor.merchantId,
        ip,
        {
          count: ids.length,
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.addToCollectionId ? { collectionId: input.addToCollectionId } : {}),
        },
      );
    });
    return this.listings(actor);
  }

  // ------------------------------------------------------------ manager: categories (ADR-0130)
  /**
   * The shared catalog categories with the store's settings, in the store's order: its own
   * order once set, else the point of sale's.
   */
  private async storeCategoryList(tx: Transaction): Promise<StoreCategoryList> {
    const rows = (
      await tx.execute(sql`
        select c.*, (select count(*)::int from products p where p.category_id = c.id and p.status = 'active') as product_count
        from categories c where c.status = 'active'
        order by coalesce(c.online_position, c.sort_order), c.sort_order, coalesce(lower(c.name_en), c.name_ar), c.id`)
    ).rows as Row[];
    const [loose] = (
      await tx.execute(sql`
        select count(*)::int as n from products p
        where p.status = 'active' and not exists (
          select 1 from categories c where c.id = p.category_id and c.status = 'active')`)
    ).rows as { n: number }[];
    return {
      categories: rows.map((r, position) => ({
        id: r['id'] as string,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        parentId: (r['parent_id'] as string | null) ?? null,
        onlineNameEn: (r['online_name_en'] as string | null) ?? null,
        onlineNameAr: (r['online_name_ar'] as string | null) ?? null,
        visible: r['online_visible'] as boolean,
        position,
        imageUrl: r['online_image_key']
          ? imageUrl(`manager/online/categories/${r['id'] as string}/image`, r['version'] as number)
          : null,
        productCount: r['product_count'] as number,
        version: r['version'] as number,
      })),
      uncategorized: loose?.n ?? 0,
    };
  }

  private async lockStoreCategory(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.status, 'active')))
      .for('update');
    if (!row) throw AppError.notFound('Category not found.');
    return row;
  }

  async categories(actor: MerchantActor): Promise<StoreCategoryList> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.storeCategoryList(tx));
  }

  private async storeCategory(actor: MerchantActor, id: string): Promise<StoreCategory> {
    const { categories: list } = await this.categories(actor);
    const found = list.find((c) => c.id === id);
    if (!found) throw AppError.notFound('Category not found.');
    return found;
  }

  /** A new shared category from the store console: the point of sale gets it too. */
  async createCategory(
    actor: MerchantActor,
    input: z.output<typeof saveStoreCategorySchema>,
    ip: string,
  ): Promise<StoreCategory> {
    this.assertManage(actor);
    assertCan(actor, 'catalog.manage', null);
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [last] = (
        await tx.execute(sql`
          select coalesce(max(sort_order), -1) + 1 as pos_next,
                 coalesce(max(coalesce(online_position, sort_order)), -1) + 1 as online_next
          from categories where status = 'active'`)
      ).rows as { pos_next: number; online_next: number }[];
      await tx.insert(categories).values({
        id,
        merchantId: actor.merchantId,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        sortOrder: Math.min(Number(last?.pos_next ?? 0), 10000),
        onlineVisible: input.visible,
        onlinePosition: Number(last?.online_next ?? 0),
        onlineNameEn: input.onlineNameEn,
        onlineNameAr: input.onlineNameAr,
      });
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'category.created',
        targetType: 'category',
        targetId: id,
        ip,
        details: { nameEn: input.nameEn, nameAr: input.nameAr, via: 'online' },
      });
    });
    return this.storeCategory(actor, id);
  }

  /** Store settings of a shared category; renaming it needs `catalog.manage` (POS too). */
  async updateCategory(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof saveStoreCategorySchema>,
    ip: string,
  ): Promise<StoreCategory> {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const row = await this.lockStoreCategory(tx, id);
      if (input.version !== undefined && row.version !== input.version) throw versionConflict();
      const renamed = input.nameEn !== row.nameEn || input.nameAr !== row.nameAr;
      if (renamed) assertCan(actor, 'catalog.manage', null);
      const next = {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        onlineNameEn: input.onlineNameEn,
        onlineNameAr: input.onlineNameAr,
        onlineVisible: input.visible,
      };
      await tx
        .update(categories)
        .set({ ...next, version: sql`${categories.version} + 1`, updatedAt: sql`now()` })
        .where(eq(categories.id, id));
      await this.record(tx, actor.merchantId, actor.userId, 'online.category_updated', id, ip, {
        changes: diffFields(row, next, Object.keys(next) as (keyof typeof next)[]),
      });
    });
    return this.storeCategory(actor, id);
  }

  /** The store's order of the shared categories (the point of sale keeps its own). */
  async orderCategories(actor: MerchantActor, ids: string[], ip: string) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.status, 'active'))
        .for('update');
      const known = new Set(rows.map((r) => r.id));
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== known.size ||
        ids.some((i) => !known.has(i))
      )
        throw AppError.validation([
          { path: 'ids', code: 'invalid', message: 'List every category exactly once.' },
        ]);
      for (const [position, id] of ids.entries())
        await tx
          .update(categories)
          .set({ onlinePosition: position, updatedAt: sql`now()` })
          .where(eq(categories.id, id));
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        'online.categories_reordered',
        actor.merchantId,
        ip,
        { count: ids.length },
      );
    });
    return this.categories(actor);
  }

  async setCategoryImage(actor: MerchantActor, id: string, data: Buffer | null, ip: string) {
    this.assertManage(actor);
    const upload = data
      ? await this.checkImage(data, `${actor.merchantId}/online/categories/${id}`)
      : null;
    const previous = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const row = await this.lockStoreCategory(tx, id);
      await tx
        .update(categories)
        .set({
          onlineImageKey: upload?.key ?? null,
          onlineImageContentType: upload?.contentType ?? null,
          version: sql`${categories.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(categories.id, id));
      // Written last inside the transaction: a storage failure rolls the row back.
      if (upload) await this.storage.put(upload.key, upload.data);
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        upload ? 'online.category_image_set' : 'online.category_image_removed',
        id,
        ip,
        {},
      );
      return row.onlineImageKey;
    });
    if (previous) await this.forgetFile(previous);
    return this.storeCategory(actor, id);
  }

  async categoryImage(actor: MerchantActor, id: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(categories).where(eq(categories.id, id));
      return this.readImage(row?.onlineImageKey ?? null, row?.onlineImageContentType ?? null);
    });
  }

  // ------------------------------------------------------------ manager: collections (ADR-0130)
  private async collectionRows(tx: Transaction): Promise<OnlineCollection[]> {
    const rows = (
      await tx.execute(sql`
        select c.*, coalesce((select json_agg(cp.product_id order by cp.position, cp.created_at)
                              from online_collection_products cp where cp.collection_id = c.id), '[]'::json) as product_ids
        from online_collections c order by c.position, c.created_at`)
    ).rows as Row[];
    return rows.map((r) => ({
      id: r['id'] as string,
      nameEn: (r['name_en'] as string | null) ?? null,
      nameAr: (r['name_ar'] as string | null) ?? null,
      position: r['position'] as number,
      status: r['status'] as OnlineCollection['status'],
      imageUrl: r['image_key']
        ? imageUrl(`manager/online/collections/${r['id'] as string}/image`, r['version'] as number)
        : null,
      productIds: r['product_ids'] as string[],
      version: r['version'] as number,
    }));
  }

  private async lockCollection(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(onlineCollections)
      .where(eq(onlineCollections.id, id))
      .for('update');
    if (!row) throw AppError.notFound('Collection not found.');
    return row;
  }

  /** Replaces a collection's products, in the given order. */
  private async setCollectionProducts(
    tx: Transaction,
    merchantId: string,
    collectionId: string,
    productIds: string[],
  ) {
    const ids = [...new Set(productIds)];
    if (ids.length) {
      const found = await tx
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.id, ids));
      if (found.length !== ids.length) throw AppError.notFound('Product not found.');
    }
    await tx
      .delete(onlineCollectionProducts)
      .where(eq(onlineCollectionProducts.collectionId, collectionId));
    if (ids.length)
      await tx
        .insert(onlineCollectionProducts)
        .values(
          ids.map((productId, position) => ({ merchantId, collectionId, productId, position })),
        );
  }

  async collections(actor: MerchantActor): Promise<{ collections: OnlineCollection[] }> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      collections: await this.collectionRows(tx),
    }));
  }

  private async collection(actor: MerchantActor, id: string): Promise<OnlineCollection> {
    const found = (await this.collections(actor)).collections.find((c) => c.id === id);
    if (!found) throw AppError.notFound('Collection not found.');
    return found;
  }

  async createCollection(
    actor: MerchantActor,
    input: z.output<typeof saveOnlineCollectionSchema>,
    ip: string,
  ): Promise<OnlineCollection> {
    this.assertManage(actor);
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [last] = (
        await tx.execute(
          sql`select coalesce(max(position), -1) + 1 as next from online_collections`,
        )
      ).rows as { next: number }[];
      await tx.insert(onlineCollections).values({
        id,
        merchantId: actor.merchantId,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        status: input.status,
        position: Number(last?.next ?? 0),
      });
      if (input.productIds)
        await this.setCollectionProducts(tx, actor.merchantId, id, input.productIds);
      await this.record(tx, actor.merchantId, actor.userId, 'online.collection_created', id, ip, {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        products: input.productIds?.length ?? 0,
      });
    });
    return this.collection(actor, id);
  }

  async updateCollection(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof saveOnlineCollectionSchema>,
    ip: string,
  ): Promise<OnlineCollection> {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const row = await this.lockCollection(tx, id);
      if (input.version !== undefined && row.version !== input.version) throw versionConflict();
      await tx
        .update(onlineCollections)
        .set({
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          status: input.status,
          version: sql`${onlineCollections.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(onlineCollections.id, id));
      if (input.productIds)
        await this.setCollectionProducts(tx, actor.merchantId, id, input.productIds);
      await this.record(tx, actor.merchantId, actor.userId, 'online.collection_updated', id, ip, {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        status: input.status,
        ...(input.productIds ? { products: input.productIds.length } : {}),
      });
    });
    return this.collection(actor, id);
  }

  /** A collection is merchandising, not a record: deleting it leaves its products as they are. */
  async deleteCollection(actor: MerchantActor, id: string, ip: string) {
    this.assertManage(actor);
    const imageKey = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const row = await this.lockCollection(tx, id);
      await tx.delete(onlineCollections).where(eq(onlineCollections.id, id));
      await this.record(tx, actor.merchantId, actor.userId, 'online.collection_deleted', id, ip, {
        nameEn: row.nameEn,
        nameAr: row.nameAr,
      });
      return row.imageKey;
    });
    if (imageKey) await this.forgetFile(imageKey);
    return this.collections(actor);
  }

  async orderCollections(actor: MerchantActor, ids: string[], ip: string) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select({ id: onlineCollections.id })
        .from(onlineCollections)
        .for('update');
      const known = new Set(rows.map((r) => r.id));
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== known.size ||
        ids.some((i) => !known.has(i))
      )
        throw AppError.validation([
          { path: 'ids', code: 'invalid', message: 'List every collection exactly once.' },
        ]);
      for (const [position, id] of ids.entries())
        await tx
          .update(onlineCollections)
          .set({ position, updatedAt: sql`now()` })
          .where(eq(onlineCollections.id, id));
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        'online.collections_reordered',
        actor.merchantId,
        ip,
        { count: ids.length },
      );
    });
    return this.collections(actor);
  }

  async setCollectionImage(actor: MerchantActor, id: string, data: Buffer | null, ip: string) {
    this.assertManage(actor);
    const upload = data
      ? await this.checkImage(data, `${actor.merchantId}/online/collections/${id}`)
      : null;
    const previous = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const row = await this.lockCollection(tx, id);
      await tx
        .update(onlineCollections)
        .set({
          imageKey: upload?.key ?? null,
          imageContentType: upload?.contentType ?? null,
          version: sql`${onlineCollections.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(onlineCollections.id, id));
      if (upload) await this.storage.put(upload.key, upload.data);
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        upload ? 'online.collection_image_set' : 'online.collection_image_removed',
        id,
        ip,
        {},
      );
      return row.imageKey;
    });
    if (previous) await this.forgetFile(previous);
    return this.collection(actor, id);
  }

  async collectionImage(actor: MerchantActor, id: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(onlineCollections).where(eq(onlineCollections.id, id));
      return this.readImage(row?.imageKey ?? null, row?.imageContentType ?? null);
    });
  }

  // ------------------------------------------------------------ manager: store images (ADR-0121)
  async setStoreImage(actor: MerchantActor, kind: StoreImageKind, data: Buffer | null, ip: string) {
    this.assertManage(actor);
    const upload = data ? await this.checkImage(data, `${actor.merchantId}/online/${kind}`) : null;
    const previous = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(onlineStores).for('update');
      if (!row) throw AppError.notFound('Save the store settings first.');
      await tx.update(onlineStores).set({
        ...(kind === 'logo'
          ? { logoKey: upload?.key ?? null, logoContentType: upload?.contentType ?? null }
          : { bannerKey: upload?.key ?? null, bannerContentType: upload?.contentType ?? null }),
        version: sql`${onlineStores.version} + 1`,
        updatedAt: sql`now()`,
      });
      if (upload) await this.storage.put(upload.key, upload.data);
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        upload ? `online.store_${kind}_set` : `online.store_${kind}_removed`,
        actor.merchantId,
        ip,
        {},
      );
      return kind === 'logo' ? row.logoKey : row.bannerKey;
    });
    if (previous) await this.forgetFile(previous);
    return this.store(actor);
  }

  async storeImage(actor: MerchantActor, kind: StoreImageKind) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(onlineStores);
      return kind === 'logo'
        ? this.readImage(row?.logoKey ?? null, row?.logoContentType ?? null)
        : this.readImage(row?.bannerKey ?? null, row?.bannerContentType ?? null);
    });
  }

  /**
   * Size and type checks shared by every store image; the picture is converted to WebP and the
   * result says where it will be stored.
   */
  private async checkImage(data: Buffer, prefix: string) {
    if (data.length === 0 || data.length > MAX_STORE_IMAGE_BYTES)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
    const image = await toStorableImage(data);
    if (!image)
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Only JPEG, PNG and WebP images are accepted.');
    return {
      contentType: image.contentType,
      data: image.data,
      key: `${prefix}/${newId()}.${image.extension}`,
    };
  }

  private async readImage(key: string | null, contentType: string | null) {
    if (!key || !contentType) throw AppError.notFound('Image not found.');
    const data = await this.storage.get(key);
    if (!data) throw AppError.notFound('Image not found.');
    return { data, contentType };
  }

  private async forgetFile(key: string) {
    await this.storage.delete(key).catch(() => undefined);
  }

  // ------------------------------------------------------------ storefront (public)
  /** Resolves a public store slug to its merchant (published or paused stores only). */
  /** The merchant behind a store address (public routes of the account, ADR-0124). */
  merchantIdOf(slug: string): Promise<string> {
    return this.merchantOf(slug);
  }

  private async merchantOf(slug: string): Promise<string> {
    const [row] = (await this.database.db.execute(sql`select store_merchant(${slug}) as m`))
      .rows as { m: string | null }[];
    if (!row?.m) throw AppError.notFound('Store not found.');
    return row.m;
  }

  /** The store as shoppers may see it; a preview (ADR-0128) also opens a draft store. */
  private async storeRow(tx: Transaction, preview = false) {
    const [store] = await tx.select().from(onlineStores);
    if (!store || (store.status === 'draft' && !preview) || !store.fulfillmentBranchId)
      throw AppError.notFound('Store not found.');
    return store as typeof store & { fulfillmentBranchId: string };
  }

  async storefront(slug: string): Promise<Storefront> {
    return this.storefrontIn(await this.merchantOf(slug), false);
  }

  /** The storefront of the merchant's own store, also while it is a draft (ADR-0128). */
  previewStorefront(actor: MerchantActor): Promise<Storefront> {
    this.assertManage(actor);
    return this.storefrontIn(actor.merchantId, true);
  }

  private storefrontIn(merchantId: string, preview: boolean): Promise<Storefront> {
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const store = await this.storeRow(tx, preview);
      const urls = preview ? PREVIEW_URLS : publicUrls(store.slug);
      const methods = (await this.onlineMethods(tx)).filter(
        (m) => this.payments.gateway(m['gateway_provider'] as string).ready,
      );
      const nav = await this.storeCategories(tx, urls);
      const tz = await merchantTimezone(tx, merchantId);
      const now = new Date();
      const branches = await this.fulfilment.servingBranches(tx, store);
      const areas = await this.fulfilment.servingAreas(tx, this.defaultBranch(branches, store).id);
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
        payOnReceipt: store.payOnReceiptEnabled,
        logoUrl: store.logoKey ? urls.logo(store.version) : null,
        bannerUrl: store.bannerKey ? urls.banner(store.version) : null,
        categories: nav.categories,
        collections: nav.collections,
        branches: branches.map((b) => ({
          id: b.id,
          nameEn: b.nameEn,
          nameAr: b.nameAr,
          address: b.address,
          phone: b.phone,
          pickupEnabled: b.pickupEnabled,
          deliveryEnabled: b.deliveryEnabled,
          preparationMinutes: b.preparationMinutes,
          hours: b.hours,
          openNow: isOpenAt(b.hours, tz, now),
        })),
        defaultBranchId: this.defaultBranch(branches, store).id,
        deliveryAreas: areas.map((a) => ({
          id: a.id,
          nameEn: a.nameEn,
          nameAr: a.nameAr,
          fee: money(a.feeMinor),
          minimumOrder: money(a.minimumOrderMinor),
          freeDeliveryFrom:
            a.freeDeliveryFromMinor === null ? null : money(a.freeDeliveryFromMinor),
          estimatedMinutes: a.estimatedMinutes,
          branchId: a.branchId,
        })),
        scheduling: { enabled: store.schedulingEnabled, slotMinutes: store.slotMinutes },
        timezone: tz,
        accountsEnabled: store.accountsEnabled,
      };
    });
  }

  /** The store's fulfilment branch when it serves the store, else the first serving branch. */
  private defaultBranch(
    branches: ServingBranch[],
    store: { fulfillmentBranchId: string },
  ): ServingBranch {
    const found = branches.find((b) => b.id === store.fulfillmentBranchId) ?? branches[0];
    if (!found) throw AppError.notFound('Store not found.');
    return found;
  }

  /** The branch a shopper asked for (`?branch=`), when it serves the store, else the default. */
  private async browsingBranch(
    tx: Transaction,
    store: typeof onlineStores.$inferSelect & { fulfillmentBranchId: string },
    branchId: string | null,
  ): Promise<ServingBranch> {
    const branches = await this.fulfilment.servingBranches(tx, store);
    return (
      (branchId ? branches.find((b) => b.id === branchId) : undefined) ??
      this.defaultBranch(branches, store)
    );
  }

  /** Time slots a shopper may pick at a branch (ADR-0123), with their remaining capacity. */
  async slots(
    slug: string,
    query: { branch: string | null; fulfillment: 'pickup' | 'delivery' },
  ): Promise<StoreSlotList> {
    const merchantId = await this.merchantOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const store = await this.storeRow(tx);
      if (!store.schedulingEnabled) return { slots: [] };
      const branch = await this.browsingBranch(tx, store, query.branch);
      const tz = await merchantTimezone(tx, merchantId);
      const slots = slotsFrom(branch.hours, tz, {
        slotMinutes: store.slotMinutes,
        preparationMinutes: branch.preparationMinutes,
        now: new Date(),
      });
      const first = slots[0];
      const last = slots[slots.length - 1];
      const load =
        first && last && store.slotCapacity !== null
          ? await this.fulfilment.slotLoad(tx, branch.id, first.start, last.end)
          : new Map<string, number>();
      return {
        slots: slots.map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
          available:
            store.slotCapacity === null ||
            (load.get(s.start.toISOString()) ?? 0) < store.slotCapacity,
        })),
      };
    });
  }

  /**
   * The storefront's navigation (ADR-0130): the shared categories the store shows that hold
   * products shown on the website, in the store's order, with the store's name and picture;
   * and the active collections that hold such products.
   */
  private async storeCategories(tx: Transaction, urls: StoreUrls) {
    const shown = sql`exists (select 1 from online_listings l join products p on p.id = l.product_id
      where l.visible and p.status = 'active'`;
    const cats = (
      await tx.execute(sql`
        select c.id, coalesce(c.online_name_en, c.name_en) as name_en, coalesce(c.online_name_ar, c.name_ar) as name_ar,
               c.parent_id, c.online_image_key, c.version from categories c
        where c.status = 'active' and c.online_visible and ${shown} and p.category_id = c.id)
        order by coalesce(c.online_position, c.sort_order), c.sort_order, coalesce(lower(c.name_en), c.name_ar), c.id`)
    ).rows as Row[];
    const cols = (
      await tx.execute(sql`
        select c.id, c.name_en, c.name_ar, c.image_key, c.version from online_collections c
        where c.status = 'active' and ${shown}
          and exists (select 1 from online_collection_products cp where cp.collection_id = c.id and cp.product_id = p.id))
        order by c.position, c.created_at`)
    ).rows as Row[];
    const ids = new Set(cats.map((c) => c['id'] as string));
    return {
      categories: cats.map((c) => ({
        id: c['id'] as string,
        nameEn: (c['name_en'] as string | null) ?? null,
        nameAr: (c['name_ar'] as string | null) ?? null,
        // A sub-category whose parent is not shown is shown at the top level.
        parentId: ids.has(c['parent_id'] as string) ? (c['parent_id'] as string) : null,
        imageUrl: c['online_image_key']
          ? urls.category(c['id'] as string, c['version'] as number)
          : null,
      })),
      collections: cols.map((c) => ({
        id: c['id'] as string,
        nameEn: (c['name_en'] as string | null) ?? null,
        nameAr: (c['name_ar'] as string | null) ?? null,
        imageUrl: c['image_key']
          ? urls.collection(c['id'] as string, c['version'] as number)
          : null,
      })),
    };
  }

  /**
   * Public store images: logo, banner, category and collection pictures. A category picture
   * address with a collection id still answers: the store categories of ADR-0121 became
   * collections with the same ids.
   */
  async publicImage(
    slug: string,
    kind: StoreImageKind | { categoryId: string } | { collectionId: string },
  ) {
    const merchantId = await this.merchantOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      if (typeof kind === 'string') {
        const store = await this.storeRow(tx);
        return kind === 'logo'
          ? this.readImage(store.logoKey, store.logoContentType)
          : this.readImage(store.bannerKey, store.bannerContentType);
      }
      if ('categoryId' in kind) {
        const [row] = await tx
          .select()
          .from(categories)
          .where(and(eq(categories.id, kind.categoryId), eq(categories.status, 'active')));
        if (row) return this.readImage(row.onlineImageKey, row.onlineImageContentType);
      }
      const id = 'categoryId' in kind ? kind.categoryId : kind.collectionId;
      const [row] = await tx.select().from(onlineCollections).where(eq(onlineCollections.id, id));
      return this.readImage(row?.imageKey ?? null, row?.imageContentType ?? null);
    });
  }

  private async storeProducts(
    tx: Transaction,
    urls: StoreUrls,
    branchId: string,
    where: SQL,
  ): Promise<StoreProduct[]> {
    const [store] = await tx.select({ hide: onlineStores.hideOutOfStock }).from(onlineStores);
    const rows = (
      await tx.execute(sql`
        select p.id as product_id, p.name_en, p.name_ar, p.description_en, p.description_ar, p.category_id,
               p.track_inventory, v.id as variant_id, v.name_en as vn_en, v.name_ar as vn_ar, v.sku,
               v.price_minor::text as price,
               coalesce((select l.on_hand from stock_levels l where l.variant_id = v.id and l.branch_id = ${branchId}), 0)::text as on_hand,
               coalesce((select sum(r.quantity) from stock_reservations r where r.variant_id = v.id and r.branch_id = ${branchId}
                         and r.status = 'active' and r.expires_at > now()), 0)::text as reserved,
               coalesce((select json_agg(i.id order by i.position, i.created_at) from product_images i where i.product_id = p.id), '[]'::json) as images,
               exists (select 1 from recipe_components rc where rc.variant_id = v.id) as has_recipe,
               ol.position, ol.title_en, ol.title_ar, ol.description_en as od_en, ol.description_ar as od_ar,
               ol.featured, ol.max_per_order, (pc.id is not null) as category_shown,
               coalesce((select json_agg(cp.collection_id order by oc.position) from online_collection_products cp
                         join online_collections oc on oc.id = cp.collection_id
                         where cp.product_id = p.id and oc.status = 'active'), '[]'::json) as collections
        from online_listings ol join products p on p.id = ol.product_id
        join product_variants v on v.product_id = p.id
        left join categories pc on pc.id = p.category_id and pc.status = 'active' and pc.online_visible
        where ol.visible and p.status = 'active' and v.status = 'active'
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
      const cap = Math.min(MAX_CART_QTY, (r['max_per_order'] as number | null) ?? MAX_CART_QTY);
      const images = (r['images'] as string[]).map((imageId) => urls.productImage(id, imageId));
      const product = out.get(id) ?? {
        productId: id,
        // The store's own title and description win over the catalog's (ADR-0121).
        nameEn: (r['title_en'] as string | null) || ((r['name_en'] as string | null) ?? null),
        nameAr: (r['title_ar'] as string | null) || ((r['name_ar'] as string | null) ?? null),
        descriptionEn:
          (r['od_en'] as string | null) || ((r['description_en'] as string | null) ?? null),
        descriptionAr:
          (r['od_ar'] as string | null) || ((r['description_ar'] as string | null) ?? null),
        categoryId: r['category_shown'] ? ((r['category_id'] as string | null) ?? null) : null,
        collectionIds: r['collections'] as string[],
        imageUrl: images[0] ?? null,
        images,
        featured: r['featured'] as boolean,
        position: r['position'] as number,
        variants: [],
      };
      product.variants.push({
        variantId: r['variant_id'] as string,
        nameEn: (r['vn_en'] as string | null) ?? null,
        nameAr: (r['vn_ar'] as string | null) ?? null,
        sku: (r['sku'] as string | null) ?? null,
        price: money(r['price'] as string),
        available: !tracked || units > 0,
        maxQuantity: tracked ? Math.min(cap, units) : cap,
      });
      out.set(id, product);
    }
    const products = [...out.values()];
    return store?.hide ? products.filter((p) => p.variants.some((v) => v.available)) : products;
  }

  async products(slug: string, branchId: string | null = null) {
    return this.productsIn(await this.merchantOf(slug), branchId, null, false);
  }

  async product(
    slug: string,
    productId: string,
    branchId: string | null = null,
  ): Promise<StoreProduct> {
    const [p] = (await this.productsIn(await this.merchantOf(slug), branchId, productId, false))
      .products;
    if (!p) throw AppError.notFound('Product not found.');
    return p;
  }

  /** Products of the merchant's own store for the design preview (ADR-0128). */
  previewProducts(actor: MerchantActor, branchId: string | null, productId: string | null = null) {
    this.assertManage(actor);
    return this.productsIn(actor.merchantId, branchId, productId, true);
  }

  private productsIn(
    merchantId: string,
    branchId: string | null,
    productId: string | null,
    preview: boolean,
  ): Promise<{ products: StoreProduct[] }> {
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const store = await this.storeRow(tx, preview);
      const branch = await this.browsingBranch(tx, store, branchId);
      const urls = preview ? PREVIEW_URLS : publicUrls(store.slug);
      const where = productId ? sql`p.id = ${productId}` : sql`true`;
      return { products: await this.storeProducts(tx, urls, branch.id, where) };
    });
  }

  async image(slug: string, productId: string, imageId: string) {
    const merchantId = await this.merchantOf(slug);
    const image = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`
          select i.storage_key, i.content_type from product_images i join online_listings l on l.product_id = i.product_id
          where i.id = ${imageId} and i.product_id = ${productId} and l.visible`)
      ).rows as Row[];
      return row;
    });
    const data = image ? await this.storage.get(image['storage_key'] as string) : null;
    if (!image || !data) throw AppError.notFound('Image not found.');
    return { data, contentType: image['content_type'] as string };
  }

  /**
   * Places an online order: validated against the listing, priced by the shared pricing
   * engine at the fulfilment branch. With an online payment method the stock is reserved for
   * `reservationMinutes` and a payment attempt is started at the gateway; without one (pay on
   * receipt, ADR-0118) the order is `placed` for the merchant to confirm, nothing is reserved
   * and the sale is created when staff record the payment. Retries with the same key return
   * the same order (BR-141, BR-142).
   */
  /**
   * The promotion engine's view of priced lines: shared category and collections per product,
   * net amount per line (ADR-0125, ADR-0130).
   */
  private async promotionLines(
    tx: Transaction,
    lines: { productId: string; netMinor: bigint }[],
  ): Promise<PromotionLine[]> {
    if (lines.length === 0) return [];
    const rows = (
      await tx.execute(sql`
        select p.id, p.category_id,
               coalesce((select json_agg(cp.collection_id) from online_collection_products cp where cp.product_id = p.id), '[]'::json) as collections
        from products p
        where p.id in (${sql.join(
          [...new Set(lines.map((l) => l.productId))].map((id) => sql`${id}`),
          sql`, `,
        )})`)
    ).rows as Row[];
    const byProduct = new Map(rows.map((r) => [r['id'] as string, r]));
    return lines.map((l) => ({
      productId: l.productId,
      categoryId: (byProduct.get(l.productId)?.['category_id'] as string | null) ?? null,
      collectionIds: (byProduct.get(l.productId)?.['collections'] as string[] | undefined) ?? [],
      netMinor: l.netMinor,
    }));
  }

  /** Prices a cart the way checkout would, without placing anything (ADR-0125). */
  async quote(
    slug: string,
    input: z.output<typeof storeQuoteSchema>,
    customer: StoreCustomer | null,
  ): Promise<StoreQuoteResult> {
    const merchantId = await this.merchantOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const store = await this.storeRow(tx);
      const branches = await this.fulfilment.servingBranches(tx, store);
      const areas = await this.fulfilment.servingAreas(tx, this.defaultBranch(branches, store).id);
      const area =
        input.fulfillment === 'delivery'
          ? (areas.find((a) => a.id === input.deliveryAreaId) ?? null)
          : null;
      const branch =
        (area ? branches.find((b) => b.id === area.branchId) : undefined) ??
        (await this.browsingBranch(tx, store, input.branchId));
      const listed = await this.storeProducts(
        tx,
        publicUrls(store.slug),
        branch.id,
        sql`v.id in (${sql.join(
          input.lines.map((l) => sql`${l.variantId}`),
          sql`, `,
        )})`,
      );
      const variants = new Map(
        listed.flatMap((p) => p.variants.map((v) => [v.variantId, { p, v }] as const)),
      );
      const lines = input.lines.flatMap((l) => {
        const found = variants.get(l.variantId);
        if (!found) return [];
        const quantityMilli = parseQuantity(l.quantity);
        return [
          {
            productId: found.p.productId,
            unitPriceMinor: parseAmount(found.v.price.amount, 'price'),
            quantityMilli: quantityMilli > 0n ? quantityMilli : 1000n,
          },
        ];
      });
      const priced = priceCart(
        lines.map((l) => ({
          unitPriceMinor: l.unitPriceMinor,
          quantityMilli: l.quantityMilli,
          discount: null,
        })),
        null,
      );
      const fee =
        input.fulfillment !== 'delivery'
          ? 0n
          : areas.length > 0
            ? area === null
              ? 0n
              : area.freeDeliveryFromMinor !== null &&
                  priced.totalMinor >= area.freeDeliveryFromMinor
                ? 0n
                : area.feeMinor
            : store.deliveryFeeMinor;
      const phone = customer
        ? (((
            (await tx.execute(sql`select phone from customers where id = ${customer.customerId}`))
              .rows[0] as Row | undefined
          )?.['phone'] as string | null) ?? null)
        : null;
      const { promotion, codeIssue } = await this.promotions.apply(tx, {
        lines: await this.promotionLines(
          tx,
          lines.map((l, i) => ({ productId: l.productId, netMinor: priced.lines[i]!.netMinor })),
        ),
        subtotalMinor: priced.totalMinor,
        deliveryFeeMinor: fee,
        code: input.promotionCode,
        customerPhone: phone,
      });
      const discount = promotion?.discountMinor ?? 0n;
      const deliveryFee = promotion?.freeDelivery ? 0n : fee;
      return {
        subtotal: money(priced.totalMinor),
        discount: money(discount),
        deliveryFee: money(deliveryFee),
        total: money(priced.totalMinor - discount + deliveryFee),
        promotion: promotion
          ? { code: promotion.code, nameEn: promotion.nameEn, nameAr: promotion.nameAr }
          : null,
        codeIssue,
      };
    });
  }

  async checkout(
    slug: string,
    input: z.output<typeof storeCheckoutSchema>,
    ip: string,
    customer: StoreCustomer | null = null,
  ): Promise<PublicOrder> {
    const merchantId = await this.merchantOf(slug);
    if (customer && customer.merchantId !== merchantId) customer = null;
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
    let provider: string | null = null;
    let amountMinor = 0n;
    try {
      await this.database.withMerchantTx(merchantId, async (tx) => {
        const store = await this.storeRow(tx);
        if (store.status !== 'published') throw STORE_CLOSED();
        if (input.fulfillment === 'pickup' && !store.pickupEnabled) throw STORE_CLOSED();
        if (input.fulfillment === 'delivery' && !store.deliveryEnabled) throw STORE_CLOSED();
        if (input.paymentMethodId === null) {
          if (!store.payOnReceiptEnabled)
            throw new AppError(
              409,
              'PAYMENT_METHOD_REQUIRED',
              'This store needs the order to be paid online.',
            );
        } else {
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
        }
        const onReceipt = provider === null;
        // Which branch prepares the order (ADR-0123): the pickup branch the shopper chose, or
        // the branch serving the delivery area; the store's own flat fee without areas.
        const branches = await this.fulfilment.servingBranches(tx, store);
        const areas = await this.fulfilment.servingAreas(
          tx,
          this.defaultBranch(branches, store).id,
        );
        const issue = (path: string, code: string, message: string) =>
          AppError.validation([{ path, code, message }]);
        let area: (typeof areas)[number] | null = null;
        let branch: ServingBranch;
        if (input.fulfillment === 'delivery') {
          if (areas.length > 0) {
            area = areas.find((a) => a.id === input.deliveryAreaId) ?? null;
            if (!area) throw issue('deliveryAreaId', 'required', 'Choose the delivery area.');
            branch =
              branches.find((b) => b.id === area!.branchId) ?? this.defaultBranch(branches, store);
          } else {
            branch =
              (input.branchId ? branches.find((b) => b.id === input.branchId) : undefined) ??
              this.defaultBranch(branches, store);
          }
          if (!branch.deliveryEnabled && areas.length === 0) throw STORE_CLOSED();
        } else {
          branch =
            (input.branchId ? branches.find((b) => b.id === input.branchId) : undefined) ??
            (branches.length === 1 ? branches[0]! : this.defaultBranch(branches, store));
          if (input.branchId && branch.id !== input.branchId)
            throw issue('branchId', 'invalid', 'This branch does not serve the store.');
          if (!branch.pickupEnabled)
            throw issue('branchId', 'invalid', 'This branch does not offer pickup.');
        }
        const tz = await merchantTimezone(tx, merchantId);
        const now = new Date();
        let scheduledFor: Date | null = null;
        if (input.scheduledFor !== null) {
          if (!store.schedulingEnabled)
            throw issue('scheduledFor', 'invalid', 'This store does not take scheduled orders.');
          const wanted = new Date(input.scheduledFor).toISOString();
          const slot = slotsFrom(branch.hours, tz, {
            slotMinutes: store.slotMinutes,
            preparationMinutes: branch.preparationMinutes,
            now,
          }).find((x) => x.start.toISOString() === wanted);
          if (!slot) throw issue('scheduledFor', 'invalid', 'Choose one of the offered times.');
          if (store.slotCapacity !== null) {
            const load = await this.fulfilment.slotLoad(tx, branch.id, slot.start, slot.end);
            if ((load.get(wanted) ?? 0) >= store.slotCapacity)
              throw new AppError(409, 'SLOT_FULL', 'This time is fully booked. Choose another.', [
                { path: 'scheduledFor', code: 'full', message: 'Fully booked.' },
              ]);
          }
          scheduledFor = slot.start;
        } else if (!isOpenAt(branch.hours, tz, now)) {
          throw new AppError(
            409,
            'OUTSIDE_HOURS',
            store.schedulingEnabled
              ? 'The store is closed right now; choose a time.'
              : 'The store is closed right now.',
          );
        }
        const branchId = branch.id;
        const listed = await this.storeProducts(
          tx,
          publicUrls(store.slug),
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
          'online',
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
        const deliveryFee =
          input.fulfillment !== 'delivery'
            ? 0n
            : area === null
              ? store.deliveryFeeMinor
              : area.freeDeliveryFromMinor !== null &&
                  priced.totalMinor >= area.freeDeliveryFromMinor
                ? 0n
                : area.feeMinor;
        const minimum =
          area !== null && area.minimumOrderMinor > store.minimumOrderMinor
            ? area.minimumOrderMinor
            : store.minimumOrderMinor;
        if (priced.totalMinor < minimum)
          throw new AppError(
            409,
            'MINIMUM_ORDER',
            `The minimum order is ${Money.ofMinor(minimum, CURRENCY).toDecimalString()} KWD.`,
          );
        // The promotion (ADR-0125): the entered code must fit; else the best automatic offer.
        const { promotion, codeIssue } = await this.promotions.apply(tx, {
          lines: await this.promotionLines(
            tx,
            lines.map((l, i) => ({
              productId: l.item.productId,
              netMinor: priced.lines[i]!.netMinor,
            })),
          ),
          subtotalMinor: priced.totalMinor,
          deliveryFeeMinor: deliveryFee,
          code: input.promotionCode,
          customerPhone: normalizePhone(input.customer.phone),
        });
        if (input.promotionCode && codeIssue)
          throw new AppError(409, 'PROMOTION_INVALID', 'This promotion code cannot be used.', [
            { path: 'promotionCode', code: codeIssue, message: 'Not applicable.' },
          ]);
        const discountMinor = promotion?.discountMinor ?? 0n;
        const finalDeliveryFee = promotion?.freeDelivery ? 0n : deliveryFee;
        const total = priced.totalMinor - discountMinor + finalDeliveryFee;
        if (total !== parseAmount(input.expectedTotal, 'expectedTotal'))
          throw new AppError(
            409,
            'TOTAL_CHANGED',
            'Prices changed. Review your cart and try again.',
          );
        amountMinor = total;
        const number = await nextDocumentNumber(tx, merchantId, 'online_order', 'W');
        // A signed-in shopper is the account's customer (ADR-0124); guests are matched by phone.
        const customerId = customer
          ? customer.customerId
          : await ensureCustomerByPhone(tx, merchantId, {
              fullName: input.customer.name,
              phone: input.customer.phone,
              email: input.customer.email,
            });
        if (customer && input.saveAddress && input.fulfillment === 'delivery') {
          const [same] = (
            await tx.execute(
              sql`select 1 from customer_addresses where customer_id = ${customer.customerId} and address = ${input.deliveryAddress}`,
            )
          ).rows;
          if (!same)
            await this.accounts.saveAddressIn(tx, merchantId, customer.customerId, null, {
              label: null,
              deliveryAreaId: area?.id ?? null,
              address: input.deliveryAddress!,
              isDefault: false,
            });
        }
        if (onReceipt) {
          // Nothing is held for an unpaid order (owner's decision, ADR-0118): only what is
          // free right now can be ordered, and the stock is deducted when the payment is recorded.
          const short = lines.findIndex(
            (l) => l.quantityMilli > BigInt(variants.get(l.variantId)!.v.maxQuantity) * 1000n,
          );
          if (short >= 0)
            throw new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this order.', [
              { path: `lines.${short}.quantity`, code: 'insufficient', message: 'Not enough.' },
            ]);
        }
        const reservedUntil = onReceipt
          ? null
          : new Date(Date.now() + store.reservationMinutes * 60_000);
        const initial = onReceipt ? 'placed' : 'pending_payment';
        await tx.insert(onlineOrders).values({
          id: orderId,
          merchantId,
          number,
          branchId,
          status: initial,
          paymentMode: onReceipt ? 'on_receipt' : 'gateway',
          fulfillment: input.fulfillment,
          customerName: input.customer.name,
          customerPhone: input.customer.phone,
          customerEmail: input.customer.email,
          deliveryAddress: input.fulfillment === 'delivery' ? input.deliveryAddress : null,
          deliveryAreaId: area?.id ?? null,
          deliveryAreaName: area ? (area.nameAr ?? area.nameEn) : null,
          scheduledFor,
          note: input.note,
          customerId,
          subtotalMinor: priced.totalMinor,
          discountMinor,
          promotionId: promotion?.id ?? null,
          promotionCode: promotion?.code ?? null,
          promotionName: promotion ? (promotion.nameAr ?? promotion.nameEn) : null,
          deliveryFeeMinor: finalDeliveryFee,
          totalMinor: total,
          paymentMethodId: input.paymentMethodId,
          trackingToken: token,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          reservedUntil,
          history: sql`jsonb_build_array(jsonb_build_object('status', ${initial}::text, 'at', now()))`,
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
        if (provider !== null && reservedUntil !== null) {
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
        }
        if (promotion)
          await this.promotions.recordUse(tx, merchantId, {
            promotionId: promotion.id,
            orderId,
            customerId,
            customerPhone: normalizePhone(input.customer.phone) ?? input.customer.phone,
            discountMinor: promotion.freeDelivery ? deliveryFee : discountMinor,
          });
        await this.record(tx, merchantId, null, 'online.order_placed', orderId, ip, {
          number,
          total: Money.ofMinor(total, CURRENCY).toDecimalString(),
          paymentMode: onReceipt ? 'on_receipt' : 'gateway',
          branchId,
          deliveryArea: area ? (area.nameAr ?? area.nameEn) : null,
          scheduledFor: scheduledFor?.toISOString() ?? null,
          promotion: promotion?.code ?? promotion?.nameEn ?? null,
          discount: Money.ofMinor(discountMinor, CURRENCY).toDecimalString(),
          account: customer?.accountId ?? null,
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

    if (provider === null) {
      this.notifications.notify(merchantId, orderId, 'placed');
      return this.track(slug, token);
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
      discount: o.discount,
      promotion: o.promotion,
      deliveryFee: o.deliveryFee,
      total: o.total,
      createdAt: o.createdAt,
      paymentMode: o.paymentMode,
      paidAt: o.paidAt,
      reservedUntil: o.reservedUntil,
      trackingToken: o.trackingToken,
      paymentUrl: o.paymentUrl,
      scheduledFor: o.scheduledFor,
      deliveryAreaName: o.deliveryAreaName,
      deliveryArea: o.deliveryArea,
      branch: o.branch,
      timeline: o.timeline,
    };
  }

  // ------------------------------------------------------------ orders (manager)
  private async orderIn(tx: Transaction, id: string): Promise<OnlineOrder> {
    const [o] = (
      await tx.execute(sql`
        select o.*, s.receipt_number, pm.id as pm_id, pm.name_en as pm_en, pm.name_ar as pm_ar, pm.gateway_provider,
               b.name_en as b_en, b.name_ar as b_ar, b.address as b_address, b.phone as b_phone,
               da.name_en as da_en, da.name_ar as da_ar
        from online_orders o left join sales s on s.id = o.sale_id left join payment_methods pm on pm.id = o.payment_method_id
        join branches b on b.id = o.branch_id left join online_delivery_areas da on da.id = o.delivery_area_id
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
      deliveryAreaId: (o['delivery_area_id'] as string | null) ?? null,
      deliveryAreaName: (o['delivery_area_name'] as string | null) ?? null,
      deliveryArea:
        o['da_en'] || o['da_ar']
          ? {
              nameEn: (o['da_en'] as string | null) ?? null,
              nameAr: (o['da_ar'] as string | null) ?? null,
            }
          : null,
      scheduledFor: iso(o['scheduled_for']),
      branch: {
        nameEn: (o['b_en'] as string | null) ?? null,
        nameAr: (o['b_ar'] as string | null) ?? null,
        address: (o['b_address'] as string | null) ?? null,
        phone: (o['b_phone'] as string | null) ?? null,
      },
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
      discount: money(o['discount_minor'] as string),
      promotion: o['promotion_name']
        ? {
            code: (o['promotion_code'] as string | null) ?? null,
            name: o['promotion_name'] as string,
          }
        : null,
      deliveryFee: money(o['delivery_fee_minor'] as string),
      total: money(o['total_minor'] as string),
      createdAt: iso(o['created_at'])!,
      paymentMode: o['payment_mode'] as 'gateway',
      confirmedAt: iso(o['confirmed_at']),
      paidAt: iso(o['paid_at']),
      reservedUntil: iso(o['reserved_until']),
      trackingToken: o['tracking_token'] as string,
      paymentUrl: o['status'] === 'pending_payment' ? (open?.redirectUrl ?? null) : null,
      timeline: (o['history'] as { status: OnlineOrderStatus; at: string }[]).map((h) => ({
        status: h.status,
        at: new Date(h.at).toISOString(),
      })),
      paymentMethod: o['pm_id']
        ? {
            nameEn: (o['pm_en'] as string | null) ?? null,
            nameAr: (o['pm_ar'] as string | null) ?? null,
            provider: (o['gateway_provider'] as string | null) ?? '',
          }
        : null,
      paymentReference: (o['payment_reference'] as string | null) ?? null,
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
      const details: Row = {};
      if (input.action === 'cancel') {
        // Unpaid orders are cancelled in place (gateway orders release their stock); paid
        // ones are corrected by refunding their sale.
        const cancellable = order.saleId
          ? false
          : order.paymentMode === 'on_receipt'
            ? [...PAYABLE, 'needs_attention'].includes(order.status)
            : ['pending_payment', 'needs_attention'].includes(order.status);
        if (!cancellable)
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
      } else if (input.action === 'mark_paid') {
        Object.assign(details, await this.recordPayment(tx, actor, order, input));
      } else {
        const next: OnlineOrderStatus = input.action === 'confirm' ? 'confirmed' : input.action;
        if (!(NEXT[order.status] ?? []).includes(next))
          throw new AppError(409, 'INVALID_STATE', 'This step is not possible for the order now.');
        if (next === 'ready' && order.fulfillment !== 'pickup')
          throw new AppError(409, 'INVALID_STATE', 'Delivery orders go out for delivery.');
        if (next === 'out_for_delivery' && order.fulfillment !== 'delivery')
          throw new AppError(409, 'INVALID_STATE', 'Pickup orders are made ready.');
        // Handing over means the money was received: a pay-on-receipt order completes only paid.
        if (next === 'completed' && !order.saleId)
          throw new AppError(
            409,
            'ORDER_UNPAID',
            'Record the payment before completing the order.',
          );
        await tx.execute(sql`
          update online_orders set status = ${next}, status_note = ${input.note}, updated_at = now(), version = version + 1,
                 confirmed_at = case when ${next} = 'confirmed' then now() else confirmed_at end,
                 completed_at = case when ${next} = 'completed' then now() else completed_at end,
                 history = ${historyEntry(next)}
          where id = ${id}`);
        // A confirmed order prints at its branch (ADR-0123).
        if (next === 'confirmed')
          await this.printJobs.queueOnlineOrderInTx(tx, {
            merchantId: actor.merchantId,
            branchId: order.branchId,
            onlineOrderId: id,
            userId: actor.userId,
          });
      }
      await this.record(
        tx,
        actor.merchantId,
        actor.userId,
        `online.order_${input.action}`,
        id,
        ip,
        details,
      );
    });
    const event: OrderEvent =
      input.action === 'confirm'
        ? 'confirmed'
        : input.action === 'mark_paid'
          ? 'paid'
          : input.action === 'cancel'
            ? 'cancelled'
            : input.action;
    this.notifications.notify(actor.merchantId, id, event);
    return this.getOrder(actor, id);
  }

  /**
   * Staff record the money received for a pay-on-receipt order (ADR-0118): the tender rules
   * of the till apply (active POS method, no gateway, settlement account and reference for
   * non-cash, BR-181), the order becomes a sale now (stock deducted, receipt number, cash into
   * the branch treasury), and a still-placed order counts as confirmed.
   */
  private async recordPayment(
    tx: Transaction,
    actor: MerchantActor,
    order: typeof onlineOrders.$inferSelect,
    input: z.output<typeof onlineOrderActionSchema>,
  ): Promise<Row> {
    if (order.paymentMode !== 'on_receipt')
      throw new AppError(409, 'INVALID_STATE', 'Online payments are confirmed by the gateway.');
    if (order.saleId || !PAYABLE.includes(order.status as OnlineOrderStatus))
      throw new AppError(409, 'INVALID_STATE', 'This order cannot be paid now.');
    const methodId = input.paymentMethodId!;
    const [m] = (await tx.execute(sql`select * from payment_methods where id = ${methodId}`))
      .rows as Row[];
    if (!m) throw AppError.notFound('Payment method not found.');
    const method: PosPaymentMethod = {
      id: m['id'] as string,
      kind: m['kind'] as string,
      status: m['status'] as string,
      availableInPos: Boolean(m['available_in_pos']),
      gatewayProvider: (m['gateway_provider'] as string | null) ?? null,
      financialAccountId: (m['financial_account_id'] as string | null) ?? null,
      nameEn: (m['name_en'] as string | null) ?? null,
      nameAr: (m['name_ar'] as string | null) ?? null,
      feeType: m['fee_type'] as FeeType,
      feeFixedMinor: BigInt(m['fee_fixed_minor'] as string),
      feePercent: m['fee_percent'] as string,
    };
    const settings = await this.sales.getSettingsInTx(tx, actor.merchantId);
    const [tender] = rules(() =>
      checkPayments(
        [
          {
            methodId,
            amount: Money.ofMinor(order.totalMinor, CURRENCY).toDecimalString(),
            tendered: null,
            reference: input.reference,
          },
        ],
        new Map([[methodId, method]]),
        order.totalMinor,
        settings.requireTenderReference,
      ),
    );
    const lines = await tx
      .select()
      .from(onlineOrderLines)
      .where(eq(onlineOrderLines.orderId, order.id))
      .orderBy(onlineOrderLines.position);
    const saleId = newId();
    const delivery =
      order.deliveryFeeMinor > 0n
        ? await this.payments.deliveryLine(tx, actor.merchantId, order.deliveryFeeMinor)
        : [];
    const { receiptNumber } = await this.sales.completeOnlineSaleInTx(tx, actor.merchantId, {
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
          nameEn: l.nameEn,
          nameAr: l.nameAr,
          variantNameEn: l.variantNameEn,
          variantNameAr: l.variantNameAr,
          sku: l.sku,
        })),
        ...delivery,
      ],
      payment: {
        methodId,
        amountMinor: order.totalMinor,
        reference: tender!.reference,
        verification: 'manual',
        collectedByUserId: actor.userId,
      },
      orderDiscountMinor: order.discountMinor,
    });
    const confirmNow = order.status === 'placed';
    await tx.execute(sql`
      update online_orders set sale_id = ${saleId}, paid_at = now(), payment_method_id = ${methodId},
             payment_reference = ${tender!.reference}, collected_by_user_id = ${actor.userId},
             status = case when ${confirmNow} then 'confirmed' else status end,
             confirmed_at = case when ${confirmNow} then now() else confirmed_at end,
             status_note = ${input.note}, updated_at = now(), version = version + 1,
             history = ${historyEntry('paid')}
      where id = ${order.id}`);
    if (confirmNow)
      await this.printJobs.queueOnlineOrderInTx(tx, {
        merchantId: actor.merchantId,
        branchId: order.branchId,
        onlineOrderId: order.id,
        userId: actor.userId,
      });
    return { saleId, receiptNumber, methodId, reference: tender!.reference, kind: method.kind };
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
      targetType: action.startsWith('online.store')
        ? 'online_store'
        : action.startsWith('online.categor')
          ? 'category'
          : action.startsWith('online.collection')
            ? 'online_collection'
            : action.startsWith('online.listing') || action.startsWith('online.products_')
              ? 'online_listing'
              : 'online_order',
      targetId: id,
      ip,
      details,
    });
  }
}

const slugTaken = () =>
  new AppError(409, 'DUPLICATE_CODE', 'Another store or link page already uses this address.', [
    { path: 'slug', code: 'duplicate', message: 'This address is taken.' },
  ]);
