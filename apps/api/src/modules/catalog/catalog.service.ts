import type {
  Category,
  PosCatalog,
  PriceHistory,
  Product,
  ProductSummary,
  productListQuerySchema,
  saveCategorySchema,
  saveProductSchema,
} from '@arabat/contracts';
import { Money, MoneyError } from '@arabat/money';
import { can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { diffFields } from '../../kernel/audit-diff.js';
import { newId } from '../../kernel/ids.js';
import { FileStorage } from '../../kernel/storage/file-storage.js';
import { toStorableImage } from '../../kernel/storage/image.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { branches } from '../branches/branches.schema.js';
import {
  categories,
  priceHistory,
  productBarcodes,
  productBranchAvailability,
  productImages,
  productVariants,
  products,
} from './catalog.schema.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

type SaveProductInput = z.output<typeof saveProductSchema>;
type SaveCategoryInput = z.output<typeof saveCategorySchema>;
type ListQuery = z.output<typeof productListQuerySchema>;

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 8;
const CURRENCY = 'KWD' as const;

const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();

/**
 * Explicitly qualified outer columns for correlated subqueries. Drizzle renders a column of
 * a single-table query unqualified ("id"), which inside a subquery would bind to the
 * subquery's own table (e.g. v.id) and silently return wrong results.
 */
const PRODUCT_ID = sql.raw('"products"."id"');
const VARIANT_ID = sql.raw('"product_variants"."id"');
const PRODUCT_CATEGORY_ID = sql.raw('"products"."category_id"');

/**
 * Product catalog (Prompt 7). Product definitions only; stock is the inventory module's.
 * Prices are parsed exactly from decimal strings; price and cost changes require
 * `catalog.prices.manage` and are audited with old and new values.
 */
@Injectable()
export class CatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  // ------------------------------------------------------------ categories
  async listCategories(actor: MerchantActor): Promise<Category[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select()
        .from(categories)
        .orderBy(asc(categories.sortOrder), asc(categories.nameEn), asc(categories.nameAr));
      const counts = await tx
        .select({ categoryId: products.categoryId, n: count() })
        .from(products)
        .where(eq(products.status, 'active'))
        .groupBy(products.categoryId);
      const map = new Map(counts.map((c) => [c.categoryId, Number(c.n)]));
      return rows.map((r) => ({
        id: r.id,
        parentId: r.parentId,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        sortOrder: r.sortOrder,
        status: r.status as Category['status'],
        productCount: map.get(r.id) ?? 0,
        version: r.version,
      }));
    });
  }

  async saveCategory(
    actor: MerchantActor,
    id: string | null,
    input: SaveCategoryInput,
    ip: string,
  ): Promise<Category> {
    const categoryId = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      this.saveCategoryInTx(tx, actor, id, input, ip),
    );
    return (await this.listCategories(actor)).find((c) => c.id === categoryId)!;
  }

  /**
   * Creates (`id` null) or updates a category inside the caller's transaction; the Excel import
   * (ADR-0132) saves many in one. Returns the category's id.
   */
  async saveCategoryInTx(
    tx: Transaction,
    actor: MerchantActor,
    id: string | null,
    input: SaveCategoryInput,
    ip: string,
    categoryId: string = id ?? newId(),
  ): Promise<string> {
    if (input.parentId) await this.assertParentValid(tx, categoryId, input.parentId);
    let changes = {};
    if (id) {
      if (!input.version)
        throw AppError.validation([
          { path: 'version', code: 'required', message: 'version is required' },
        ]);
      const before = await this.findCategory(tx, id);
      changes = diffFields(
        before,
        {
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          parentId: input.parentId,
          sortOrder: input.sortOrder,
        },
        ['nameEn', 'nameAr', 'parentId', 'sortOrder'],
      );
      const [row] = await tx
        .update(categories)
        .set({
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          parentId: input.parentId,
          sortOrder: input.sortOrder,
          version: sql`${categories.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(categories.id, id), eq(categories.version, input.version)))
        .returning({ id: categories.id });
      if (!row) {
        await this.findCategory(tx, id);
        throw versionConflict();
      }
    } else {
      await tx.insert(categories).values({
        id: categoryId,
        merchantId: actor.merchantId,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        parentId: input.parentId,
        sortOrder: input.sortOrder,
      });
    }
    await this.record(
      tx,
      actor,
      id ? 'category.updated' : 'category.created',
      'category',
      categoryId,
      ip,
      id ? { changes } : {},
    );
    return categoryId;
  }

  async setCategoryStatus(
    actor: MerchantActor,
    id: string,
    status: 'active' | 'archived',
    ip: string,
  ): Promise<Category> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.findCategory(tx, id);
      await tx
        .update(categories)
        .set({ status, version: sql`${categories.version} + 1`, updatedAt: sql`now()` })
        .where(eq(categories.id, id));
      await this.record(
        tx,
        actor,
        `category.${status === 'active' ? 'restored' : 'archived'}`,
        'category',
        id,
        ip,
      );
    });
    return (await this.listCategories(actor)).find((c) => c.id === id)!;
  }

  // ------------------------------------------------------------ products
  async listProducts(
    actor: MerchantActor,
    query: ListQuery,
  ): Promise<{ products: ProductSummary[]; total: number; page: number; pageSize: number }> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const conditions: SQL[] = [];
      if (query.status !== 'all') conditions.push(eq(products.status, query.status));
      if (query.categoryId) conditions.push(eq(products.categoryId, query.categoryId));
      if (query.trackInventory)
        conditions.push(eq(products.trackInventory, query.trackInventory === 'true'));
      if (query.branchId) conditions.push(availableAt(query.branchId));
      if (query.q) {
        const like = `%${escapeLike(query.q.toLowerCase())}%`;
        conditions.push(
          or(
            sql`lower(${products.nameEn}) like ${like}`,
            sql`lower(${products.nameAr}) like ${like}`,
            sql`exists (select 1 from product_variants v where v.product_id = ${PRODUCT_ID} and lower(v.sku) like ${like})`,
            sql`exists (select 1 from product_barcodes b join product_variants v on v.id = b.variant_id
                        where v.product_id = ${PRODUCT_ID} and b.barcode = ${query.q})`,
          )!,
        );
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const minPrice = sql<
        string | null
      >`(select min(v.price_minor) from product_variants v where v.product_id = ${PRODUCT_ID} and v.status = 'active')`;
      const order =
        query.sort === 'price'
          ? sql`${minPrice} ${sql.raw(query.direction)} nulls last`
          : query.sort === 'updated'
            ? sql`${products.updatedAt} ${sql.raw(query.direction)}`
            : sql`coalesce(lower(${products.nameEn}), ${products.nameAr}) ${sql.raw(query.direction)}`;

      const [totalRow] = await tx.select({ n: count() }).from(products).where(where);
      const rows = await tx
        .select({
          id: products.id,
          nameEn: products.nameEn,
          nameAr: products.nameAr,
          categoryId: products.categoryId,
          type: products.type,
          hasVariants: products.hasVariants,
          trackInventory: products.trackInventory,
          posVisible: products.posVisible,
          status: products.status,
          updatedAt: products.updatedAt,
          minPrice,
          maxPrice: sql<
            string | null
          >`(select max(v.price_minor) from product_variants v where v.product_id = ${PRODUCT_ID} and v.status = 'active')`,
          variantCount: sql<number>`(select count(*)::int from product_variants v where v.product_id = ${PRODUCT_ID} and v.status = 'active')`,
          skus: sql<
            string[]
          >`coalesce((select array_agg(v.sku order by v.position) from product_variants v where v.product_id = ${PRODUCT_ID} and v.status = 'active' and v.sku is not null), '{}')`,
          imageId: sql<
            string | null
          >`(select i.id from product_images i where i.product_id = ${PRODUCT_ID} order by i.position, i.created_at limit 1)`,
        })
        .from(products)
        .where(where)
        .orderBy(order, asc(products.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return {
        total: Number(totalRow?.n ?? 0),
        page: query.page,
        pageSize: query.pageSize,
        products: rows.map((r) => ({
          id: r.id,
          nameEn: r.nameEn,
          nameAr: r.nameAr,
          categoryId: r.categoryId,
          type: r.type as ProductSummary['type'],
          hasVariants: r.hasVariants,
          trackInventory: r.trackInventory,
          posVisible: r.posVisible,
          status: r.status as ProductSummary['status'],
          variantCount: r.variantCount,
          skus: r.skus,
          minPrice: r.minPrice === null ? null : money(BigInt(r.minPrice)),
          maxPrice: r.maxPrice === null ? null : money(BigInt(r.maxPrice)),
          imageUrl: r.imageId ? imageUrl(r.id, r.imageId) : null,
          updatedAt: r.updatedAt.toISOString(),
        })),
      };
    });
  }

  getProduct(actor: MerchantActor, productId: string): Promise<Product> {
    return this.database.withMerchantTx(actor.merchantId, (tx) =>
      this.loadProduct(tx, actor, productId),
    );
  }

  async createProduct(actor: MerchantActor, input: SaveProductInput, ip: string): Promise<Product> {
    return this.write(async () =>
      this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const productId = await this.createProductInTx(tx, actor, input, ip);
        return this.loadProduct(tx, actor, productId);
      }),
    );
  }

  /** Creates a product inside the caller's transaction (also the Excel import, ADR-0132). */
  async createProductInTx(
    tx: Transaction,
    actor: MerchantActor,
    input: SaveProductInput,
    ip: string,
  ): Promise<string> {
    this.assertPriceRights(actor);
    const productId = newId();
    await this.subscriptions.assertCapacity(tx, actor.merchantId, 'products');
    await this.validateReferences(tx, input);
    await tx
      .insert(products)
      .values({ id: productId, merchantId: actor.merchantId, ...productFields(input) });
    await this.saveAvailability(tx, actor.merchantId, productId, input);
    const changes = await this.saveVariants(tx, actor, productId, input, []);
    await this.record(tx, actor, 'product.created', 'product', productId, ip, {
      variants: changes,
    });
    return productId;
  }

  async updateProduct(
    actor: MerchantActor,
    productId: string,
    input: SaveProductInput,
    ip: string,
  ): Promise<Product> {
    return this.write(async () =>
      this.database.withMerchantTx(actor.merchantId, async (tx) => {
        await this.updateProductInTx(tx, actor, productId, input, ip);
        return this.loadProduct(tx, actor, productId);
      }),
    );
  }

  /** Updates a product inside the caller's transaction (also the Excel import, ADR-0132). */
  async updateProductInTx(
    tx: Transaction,
    actor: MerchantActor,
    productId: string,
    input: SaveProductInput,
    ip: string,
  ): Promise<void> {
    if (!input.version)
      throw AppError.validation([
        { path: 'version', code: 'required', message: 'version is required' },
      ]);
    const existing = await this.loadProduct(tx, actor, productId);
    await this.validateReferences(tx, input);
    const fields = productFields(input);
    const currentVariants = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId));
    // Stock never disappears silently (BR-171): tracking stays on, goods stay goods and
    // variants stay active while any balance is not zero.
    if (existing.trackInventory && !fields.trackInventory)
      await assertNoStockOnHand(
        tx,
        currentVariants.map((v) => v.id),
        'switch stock tracking off',
      );
    const requestedIds = new Set(input.variants.map((v) => v.id).filter(Boolean));
    await assertNoStockOnHand(
      tx,
      currentVariants
        .filter((v) => v.status === 'active' && !requestedIds.has(v.id))
        .map((v) => v.id),
      'remove a variant',
    );
    const [row] = await tx
      .update(products)
      .set({
        ...fields,
        version: sql`${products.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(products.id, productId), eq(products.version, input.version!)))
      .returning({ id: products.id });
    if (!row) throw versionConflict();
    await this.saveAvailability(tx, actor.merchantId, productId, input);
    const changes = await this.saveVariants(tx, actor, productId, input, currentVariants);
    await this.record(tx, actor, 'product.updated', 'product', productId, ip, {
      before: { status: existing.status, name: existing.nameEn ?? existing.nameAr },
      changes: diffFields(existing, fields, Object.keys(fields) as (keyof typeof fields)[]),
      variants: changes,
    });
  }

  async setProductStatus(
    actor: MerchantActor,
    productId: string,
    status: 'active' | 'archived',
    ip: string,
  ): Promise<Product> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const current = await this.loadProduct(tx, actor, productId);
      if (status === 'active' && current.status !== 'active')
        await this.subscriptions.assertCapacity(tx, actor.merchantId, 'products');
      if (status === 'archived' && current.status === 'active')
        await assertNoStockOnHand(
          tx,
          (
            await tx
              .select({ id: productVariants.id })
              .from(productVariants)
              .where(eq(productVariants.productId, productId))
          ).map((v) => v.id),
          'archive the product',
        );
      await tx
        .update(products)
        .set({ status, version: sql`${products.version} + 1`, updatedAt: sql`now()` })
        .where(eq(products.id, productId));
      await this.record(
        tx,
        actor,
        status === 'archived' ? 'product.archived' : 'product.restored',
        'product',
        productId,
        ip,
      );
      return this.loadProduct(tx, actor, productId);
    });
  }

  // ------------------------------------------------------------ images
  async addImage(
    actor: MerchantActor,
    productId: string,
    data: Buffer,
    ip: string,
  ): Promise<Product> {
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
      throw new AppError(
        413,
        'PAYLOAD_TOO_LARGE',
        `Images must be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
    }
    const image = await toStorableImage(data);
    if (!image)
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Only JPEG, PNG and WebP images are accepted.');
    const { contentType } = image;
    const imageId = newId();
    const key = `${actor.merchantId}/products/${productId}/${imageId}.${image.extension}`;
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.loadProduct(tx, actor, productId);
      const [n] = await tx
        .select({ n: count() })
        .from(productImages)
        .where(eq(productImages.productId, productId));
      if (Number(n?.n ?? 0) >= MAX_IMAGES_PER_PRODUCT)
        throw AppError.conflict(`At most ${MAX_IMAGES_PER_PRODUCT} images per product.`);
      await tx.insert(productImages).values({
        id: imageId,
        merchantId: actor.merchantId,
        productId,
        storageKey: key,
        contentType,
        sizeBytes: image.data.length,
        position: Number(n?.n ?? 0),
      });
      // Written last inside the transaction: a storage failure rolls the row back.
      await this.storage.put(key, image.data);
      await tx
        .update(products)
        .set({ updatedAt: sql`now()` })
        .where(eq(products.id, productId));
      await this.record(tx, actor, 'product.image_added', 'product', productId, ip, { imageId });
    });
    return this.getProduct(actor, productId);
  }

  async deleteImage(
    actor: MerchantActor,
    productId: string,
    imageId: string,
    ip: string,
  ): Promise<Product> {
    const key = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [image] = await tx
        .delete(productImages)
        .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
        .returning({ key: productImages.storageKey });
      if (!image) throw AppError.notFound('Image not found.');
      await tx
        .update(products)
        .set({ updatedAt: sql`now()` })
        .where(eq(products.id, productId));
      await this.record(tx, actor, 'product.image_removed', 'product', productId, ip, { imageId });
      return image.key;
    });
    await this.storage.delete(key);
    return this.getProduct(actor, productId);
  }

  async readImage(
    actor: MerchantActor,
    productId: string,
    imageId: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    const [image] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      tx
        .select()
        .from(productImages)
        .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId))),
    );
    const data = image ? await this.storage.get(image.storageKey) : null;
    if (!image || !data) throw AppError.notFound('Image not found.');
    return { data, contentType: image.contentType };
  }

  // ------------------------------------------------------------ POS catalog
  /** Active products available at the session's branch, flattened to sellable variants. */
  async posCatalog(actor: MerchantActor): Promise<PosCatalog> {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select({
          variantId: productVariants.id,
          productId: products.id,
          categoryId: products.categoryId,
          nameEn: products.nameEn,
          nameAr: products.nameAr,
          variantNameEn: productVariants.nameEn,
          variantNameAr: productVariants.nameAr,
          sku: productVariants.sku,
          priceMinor: productVariants.priceMinor,
          trackInventory: products.trackInventory,
          barcodes: sql<
            string[]
          >`coalesce((select array_agg(b.barcode order by b.barcode) from product_barcodes b where b.variant_id = ${VARIANT_ID}), '{}')`,
          imageId: sql<
            string | null
          >`(select i.id from product_images i where i.product_id = ${PRODUCT_ID} order by i.position, i.created_at limit 1)`,
          categoryActive: sql<boolean>`${PRODUCT_CATEGORY_ID} is null or exists (select 1 from categories c where c.id = ${PRODUCT_CATEGORY_ID} and c.status = 'active')`,
        })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(
          and(
            eq(products.status, 'active'),
            eq(products.posVisible, true),
            eq(productVariants.status, 'active'),
            availableAt(branchId),
          ),
        )
        .orderBy(asc(products.nameEn), asc(products.nameAr), asc(productVariants.position));
      const cats = await tx
        .select({
          id: categories.id,
          nameEn: categories.nameEn,
          nameAr: categories.nameAr,
          sortOrder: categories.sortOrder,
        })
        .from(categories)
        .where(eq(categories.status, 'active'))
        .orderBy(asc(categories.sortOrder));
      const items = rows.map((r) => ({
        variantId: r.variantId,
        productId: r.productId,
        // Products in an archived category stay sellable but are shown without category.
        categoryId: r.categoryActive ? r.categoryId : null,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        variantNameEn: r.variantNameEn,
        variantNameAr: r.variantNameAr,
        sku: r.sku,
        barcodes: r.barcodes,
        price: money(r.priceMinor),
        trackInventory: r.trackInventory,
        imageUrl: r.imageId ? `/api/v1/pos/catalog/images/${r.productId}/${r.imageId}` : null,
      }));
      const version = createHash('sha256')
        .update(JSON.stringify({ items, cats }))
        .digest('hex')
        .slice(0, 32);
      return { branchId, categories: cats, items, version };
    });
  }

  async readPosImage(actor: MerchantActor, productId: string, imageId: string) {
    return this.readImage(actor, productId, imageId);
  }

  // ------------------------------------------------------------ internals
  private assertPriceRights(actor: MerchantActor) {
    if (!can(actor.access, 'catalog.prices.manage', null)) {
      throw AppError.forbidden('Setting prices requires the "Manage prices and costs" permission.');
    }
  }

  private async write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error, 'product_variants_merchant_sku_key')) {
        throw new AppError(409, 'DUPLICATE_SKU', 'Another product already uses this SKU.');
      }
      if (isUniqueViolation(error, 'product_barcodes_merchant_id_barcode_pk')) {
        throw new AppError(409, 'DUPLICATE_BARCODE', 'Another product already uses this barcode.');
      }
      throw error;
    }
  }

  private async validateReferences(tx: Transaction, input: SaveProductInput) {
    if (input.categoryId) await this.findCategory(tx, input.categoryId);
    if (!input.availableInAllBranches) {
      const ids = [...new Set(input.branchIds)];
      const found = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(inArray(branches.id, ids));
      if (found.length !== ids.length) throw AppError.notFound('Branch not found.');
    }
    const skus = input.variants.map((v) => v.sku?.toLowerCase()).filter(Boolean);
    if (new Set(skus).size !== skus.length)
      throw new AppError(409, 'DUPLICATE_SKU', 'The same SKU is used twice.');
    const barcodes = input.variants.flatMap((v) => v.barcodes);
    if (new Set(barcodes).size !== barcodes.length)
      throw new AppError(409, 'DUPLICATE_BARCODE', 'The same barcode is used twice.');
  }

  private async saveAvailability(
    tx: Transaction,
    merchantId: string,
    productId: string,
    input: SaveProductInput,
  ) {
    await tx
      .delete(productBranchAvailability)
      .where(eq(productBranchAvailability.productId, productId));
    if (!input.availableInAllBranches) {
      await tx
        .insert(productBranchAvailability)
        .values(
          [...new Set(input.branchIds)].map((branchId) => ({ merchantId, productId, branchId })),
        );
    }
  }

  /**
   * Upserts variants. Variants missing from the payload are archived (never deleted) and
   * lose their barcodes so the codes can be reused. Returns an audit-friendly change list.
   */
  private async saveVariants(
    tx: Transaction,
    actor: MerchantActor,
    productId: string,
    input: SaveProductInput,
    current: (typeof productVariants.$inferSelect)[],
  ) {
    const canPrice = can(actor.access, 'catalog.prices.manage', null);
    const changes: Record<string, unknown>[] = [];
    const keep = new Set<string>();
    const requested = new Set(input.variants.map((v) => v.id).filter(Boolean));

    // Archive removed variants first so their barcodes can be reused in the same save.
    for (const old of current.filter((c) => !requested.has(c.id) && c.status === 'active')) {
      await tx
        .update(productVariants)
        .set({
          status: 'archived',
          isDefault: false,
          updatedAt: sql`now()`,
          version: sql`${productVariants.version} + 1`,
        })
        .where(eq(productVariants.id, old.id));
      await tx.delete(productBarcodes).where(eq(productBarcodes.variantId, old.id));
      changes.push({ variantId: old.id, archived: true });
    }

    for (const [position, v] of input.variants.entries()) {
      const price = parseMoney(v.price, 'price');
      const cost = v.cost === null ? null : parseMoney(v.cost, 'cost');
      const existing = v.id ? current.find((c) => c.id === v.id) : undefined;
      if (v.id && !existing) throw AppError.notFound('Variant not found.');
      const isDefault = position === 0;
      if (existing) {
        keep.add(existing.id);
        const priceChanged = existing.priceMinor !== price;
        const costChanged = canPrice && existing.costMinor !== cost;
        if (priceChanged && !canPrice) this.assertPriceRights(actor);
        await tx
          .update(productVariants)
          .set({
            nameEn: v.nameEn,
            nameAr: v.nameAr,
            sku: v.sku,
            priceMinor: price,
            ...(canPrice ? { costMinor: cost } : {}),
            position,
            isDefault: false,
            status: 'active',
            version: sql`${productVariants.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(productVariants.id, existing.id));
        if (priceChanged)
          await this.history(
            tx,
            actor,
            productId,
            existing.id,
            'price',
            existing.priceMinor,
            price,
          );
        if (costChanged)
          await this.history(tx, actor, productId, existing.id, 'cost', existing.costMinor, cost);
        if (priceChanged || costChanged) {
          changes.push({
            variantId: existing.id,
            ...(priceChanged
              ? { price: { from: money(existing.priceMinor).amount, to: money(price).amount } }
              : {}),
            ...(costChanged
              ? {
                  cost: {
                    from: existing.costMinor === null ? null : money(existing.costMinor).amount,
                    to: cost === null ? null : money(cost).amount,
                  },
                }
              : {}),
          });
        }
        if (isDefault) await this.markDefault(tx, productId, existing.id);
        await this.replaceBarcodes(tx, actor.merchantId, existing.id, v.barcodes);
      } else {
        this.assertPriceRights(actor);
        const id = newId();
        keep.add(id);
        await tx.insert(productVariants).values({
          id,
          merchantId: actor.merchantId,
          productId,
          nameEn: v.nameEn,
          nameAr: v.nameAr,
          sku: v.sku,
          priceMinor: price,
          costMinor: cost,
          currency: CURRENCY,
          position,
          isDefault: false,
        });
        if (isDefault) await this.markDefault(tx, productId, id);
        await this.replaceBarcodes(tx, actor.merchantId, id, v.barcodes);
        await this.history(tx, actor, productId, id, 'price', null, price, 'created');
        if (cost !== null)
          await this.history(tx, actor, productId, id, 'cost', null, cost, 'created');
        changes.push({ variantId: id, created: true, price: money(price).amount });
      }
    }

    return changes;
  }

  /** Append-only price / cost history of a variant (BR-191, FND-222). */
  private async history(
    tx: Transaction,
    actor: MerchantActor,
    productId: string,
    variantId: string,
    kind: 'price' | 'cost',
    from: bigint | null,
    to: bigint | null,
    source: 'manual' | 'created' = 'manual',
  ) {
    await tx.insert(priceHistory).values({
      id: newId(),
      merchantId: actor.merchantId,
      productId,
      variantId,
      kind,
      fromMinor: from,
      toMinor: to,
      source,
      changedByUserId: actor.userId,
    });
  }

  /** Price and cost history of a product; cost rows only for holders of `catalog.prices.manage`. */
  async priceHistory(actor: MerchantActor, productId: string): Promise<PriceHistory> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.loadProduct(tx, actor, productId);
      const showCost = can(actor.access, 'catalog.prices.manage', null);
      const rows = (
        await tx.execute(sql`
          select h.id, h.variant_id, v.name_en, v.name_ar, h.kind, h.from_minor::text as from_minor,
                 h.to_minor::text as to_minor, h.source, u.full_name, h.created_at
          from price_history h join product_variants v on v.id = h.variant_id
          left join users u on u.id = h.changed_by_user_id
          where h.product_id = ${productId} ${showCost ? sql`` : sql`and h.kind = 'price'`}
          order by h.created_at desc, h.id desc limit 500`)
      ).rows as Record<string, unknown>[];
      return {
        entries: rows.map((r) => ({
          id: r['id'] as string,
          variantId: r['variant_id'] as string,
          variantNameEn: (r['name_en'] as string | null) ?? null,
          variantNameAr: (r['name_ar'] as string | null) ?? null,
          kind: r['kind'] as 'price' | 'cost',
          from: r['from_minor'] === null ? null : money(BigInt(r['from_minor'] as string)),
          to: r['to_minor'] === null ? null : money(BigInt(r['to_minor'] as string)),
          source: r['source'] as 'manual' | 'created',
          changedBy: (r['full_name'] as string | null) ?? null,
          changedAt: new Date(r['created_at'] as string).toISOString(),
        })),
      };
    });
  }

  private async markDefault(tx: Transaction, productId: string, variantId: string) {
    await tx
      .update(productVariants)
      .set({ isDefault: false })
      .where(and(eq(productVariants.productId, productId), eq(productVariants.isDefault, true)));
    await tx
      .update(productVariants)
      .set({ isDefault: true })
      .where(eq(productVariants.id, variantId));
  }

  private async replaceBarcodes(
    tx: Transaction,
    merchantId: string,
    variantId: string,
    barcodes: string[],
  ) {
    await tx.delete(productBarcodes).where(eq(productBarcodes.variantId, variantId));
    if (barcodes.length) {
      await tx
        .insert(productBarcodes)
        .values(barcodes.map((barcode) => ({ merchantId, variantId, barcode })));
    }
  }

  private async loadProduct(
    tx: Transaction,
    actor: MerchantActor,
    productId: string,
  ): Promise<Product> {
    const [p] = await tx.select().from(products).where(eq(products.id, productId));
    if (!p) throw AppError.notFound('Product not found.');
    const variants = await tx
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(desc(sql`${productVariants.status} = 'active'`), asc(productVariants.position));
    const barcodeRows = variants.length
      ? await tx
          .select()
          .from(productBarcodes)
          .where(
            inArray(
              productBarcodes.variantId,
              variants.map((v) => v.id),
            ),
          )
      : [];
    const availability = await tx
      .select({ branchId: productBranchAvailability.branchId })
      .from(productBranchAvailability)
      .where(eq(productBranchAvailability.productId, productId));
    const images = await tx
      .select()
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(asc(productImages.position), asc(productImages.createdAt));
    const showCost = can(actor.access, 'catalog.prices.manage', null);

    return {
      id: p.id,
      categoryId: p.categoryId,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      descriptionEn: p.descriptionEn,
      descriptionAr: p.descriptionAr,
      type: p.type as Product['type'],
      hasVariants: p.hasVariants,
      trackInventory: p.trackInventory,
      availableInAllBranches: p.availableInAllBranches,
      branchIds: availability.map((a) => a.branchId),
      posVisible: p.posVisible,
      status: p.status as Product['status'],
      variants: variants.map((v) => ({
        id: v.id,
        nameEn: v.nameEn,
        nameAr: v.nameAr,
        sku: v.sku,
        barcodes: barcodeRows
          .filter((b) => b.variantId === v.id)
          .map((b) => b.barcode)
          .sort(),
        price: money(v.priceMinor),
        ...(showCost ? { cost: v.costMinor === null ? null : money(v.costMinor) } : {}),
        isDefault: v.isDefault,
        status: v.status as 'active' | 'archived',
        position: v.position,
      })),
      images: images.map((i) => ({
        id: i.id,
        contentType: i.contentType,
        sizeBytes: i.sizeBytes,
        url: imageUrl(p.id, i.id),
      })),
      version: p.version,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private async findCategory(tx: Transaction, id: string) {
    const [row] = await tx.select().from(categories).where(eq(categories.id, id));
    if (!row) throw AppError.notFound('Category not found.');
    return row;
  }

  /** The parent must exist and must not be the category itself or one of its descendants. */
  private async assertParentValid(tx: Transaction, categoryId: string, parentId: string) {
    let cursor: string | null = parentId;
    for (let depth = 0; cursor; depth++) {
      if (cursor === categoryId || depth > 10)
        throw AppError.conflict('A category cannot be placed inside itself.');
      const parent = await this.findCategory(tx, cursor);
      cursor = parent.parentId;
    }
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    targetType: string,
    targetId: string,
    ip: string,
    details = {},
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

/**
 * Refuses an action that would hide a stock balance (BR-171, FND-206 / FND-207): every
 * branch where one of the variants still holds stock is named, with what to do first.
 */
export async function assertNoStockOnHand(
  tx: Transaction,
  variantIds: readonly string[],
  action: string,
): Promise<void> {
  if (variantIds.length === 0) return;
  const rows = (
    await tx.execute(sql`
      select l.variant_id, l.on_hand::text as on_hand, b.name_en, b.name_ar,
             coalesce(v.name_en, p.name_en, v.name_ar, p.name_ar) as item
      from stock_levels l
      join branches b on b.id = l.branch_id
      join product_variants v on v.id = l.variant_id
      join products p on p.id = v.product_id
      where l.on_hand <> 0 and l.variant_id in (${sql.join(
        variantIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by b.is_main desc, b.name_en, v.position`)
  ).rows as Record<string, string | null>[];
  if (rows.length === 0) return;
  throw new AppError(
    409,
    'STOCK_ON_HAND',
    `Cannot ${action} while stock is on hand. Write it off or transfer it first: ${rows
      .map((r) => `${r['item']} at ${r['name_en'] ?? r['name_ar']}: ${r['on_hand']}`)
      .join('; ')}.`,
    rows.map((r) => ({
      path: `variants.${r['variant_id']}`,
      code: 'stock_on_hand',
      message: `${r['name_en'] ?? r['name_ar']}: ${r['on_hand']}`,
    })),
  );
}

function productFields(input: SaveProductInput) {
  return {
    nameEn: input.nameEn,
    nameAr: input.nameAr,
    descriptionEn: input.descriptionEn,
    descriptionAr: input.descriptionAr,
    categoryId: input.categoryId,
    type: input.type,
    hasVariants: input.hasVariants,
    trackInventory: input.type === 'service' ? false : input.trackInventory,
    availableInAllBranches: input.availableInAllBranches,
    posVisible: input.posVisible,
  };
}

/** Exact decimal → fils. Rejects more than 3 decimals and out-of-range values. */
export function parseMoney(amount: string, field: string): bigint {
  try {
    const value = Money.parse(amount, CURRENCY);
    if (value.isNegative() || value.minor > 1_000_000_000_000n)
      throw new MoneyError('out of range');
    return value.minor;
  } catch (error) {
    if (error instanceof MoneyError) {
      throw new AppError(
        400,
        'INVALID_PRICE',
        `Invalid ${field}: use 0 to 1,000,000,000 with at most 3 decimals.`,
      );
    }
    throw error;
  }
}

/** Product is sellable at the branch: everywhere, or explicitly listed. */
function availableAt(branchId: string): SQL {
  return or(
    eq(products.availableInAllBranches, true),
    sql`exists (select 1 from product_branch_availability a where a.product_id = ${PRODUCT_ID} and a.branch_id = ${branchId})`,
  )!;
}

function imageUrl(productId: string, imageId: string): string {
  return `/api/v1/manager/products/${productId}/images/${imageId}`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
