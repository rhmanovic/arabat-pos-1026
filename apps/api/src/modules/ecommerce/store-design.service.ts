import {
  MAX_STORE_IMAGE_BYTES,
  type DesignTemplate,
  type StoreAsset,
  type StoreDesign,
  type StoreDesignState,
  designImageIds,
  legacyDesign,
  storeDesignSchema,
} from '@arabat/contracts';
import { can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { FileStorage } from '../../kernel/storage/file-storage.js';
import { toStorableImage } from '../../kernel/storage/image.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { restaurantSettings } from '../restaurant/restaurant.schema.js';
import { onlineStoreAssets, onlineStoreDesigns } from './design.schema.js';
import { EcommerceService } from './ecommerce.service.js';

/** Pictures a store may keep for its design (ADR-0128). */
export const MAX_DESIGN_ASSETS = 200;

/**
 * Storefront design (ADR-0128): the merchant edits a draft, previews it in the console and
 * publishes it; shoppers see the published design, or the legacy layout before the first one.
 * Designs are validated by the shared `storeDesignSchema` on the way in and on the way out.
 */
@Injectable()
export class StoreDesignService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly store: EcommerceService,
  ) {}

  private assertManage(actor: MerchantActor) {
    if (!can(actor.access, 'online.manage')) throw AppError.forbidden();
  }

  /** Restaurants (restaurant module on) start from the restaurant template. */
  private async suggested(tx: Transaction): Promise<DesignTemplate> {
    const [row] = await tx.select({ enabled: restaurantSettings.enabled }).from(restaurantSettings);
    return row?.enabled ? 'restaurant' : 'retail';
  }

  /** A stored design read back; one that no longer parses falls back to the legacy layout. */
  private read(value: unknown, template: DesignTemplate): StoreDesign {
    const parsed = storeDesignSchema.safeParse(value);
    return parsed.success ? parsed.data : legacyDesign(template);
  }

  async state(actor: MerchantActor): Promise<StoreDesignState> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.stateIn(tx));
  }

  private async stateIn(tx: Transaction): Promise<StoreDesignState> {
    const suggestedTemplate = await this.suggested(tx);
    const [row] = await tx.select().from(onlineStoreDesigns);
    if (!row)
      return {
        draft: legacyDesign(suggestedTemplate),
        published: null,
        publishedAt: null,
        dirty: false,
        suggestedTemplate,
        version: 0,
      };
    const draft = this.read(row.draft, suggestedTemplate);
    const published = row.published === null ? null : this.read(row.published, suggestedTemplate);
    return {
      draft,
      published,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      dirty: published === null || JSON.stringify(draft) !== JSON.stringify(published),
      suggestedTemplate,
      version: row.version,
    };
  }

  /** Every picture the design uses must be one of the merchant's design pictures. */
  private async assertImages(tx: Transaction, design: StoreDesign) {
    const ids = designImageIds(design);
    if (ids.length === 0) return;
    const found = await tx
      .select({ id: onlineStoreAssets.id })
      .from(onlineStoreAssets)
      .where(inArray(onlineStoreAssets.id, ids));
    const known = new Set(found.map((r) => r.id));
    const missing = ids.filter((x) => !known.has(x));
    if (missing.length > 0)
      throw AppError.validation([
        {
          path: 'design',
          code: 'unknown_image',
          message: 'A section uses a picture that does not exist.',
        },
      ]);
  }

  async save(
    actor: MerchantActor,
    input: { design: StoreDesign; version: number },
    ip: string,
  ): Promise<StoreDesignState> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(onlineStoreDesigns).for('update');
      // Checked under the row lock, so a picture deleted meanwhile cannot slip in.
      await this.assertImages(tx, input.design);
      if (!row) {
        if (input.version !== 0) throw versionConflict();
        await tx.insert(onlineStoreDesigns).values({
          merchantId: actor.merchantId,
          draft: input.design,
        });
      } else {
        if (row.version !== input.version) throw versionConflict();
        await tx
          .update(onlineStoreDesigns)
          .set({
            draft: input.design,
            version: sql`${onlineStoreDesigns.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(onlineStoreDesigns.merchantId, actor.merchantId));
      }
      await this.record(tx, actor, 'online.design_saved', ip, {
        template: input.design.template,
        sections: {
          home: input.design.pages.home.length,
          products: input.design.pages.products.length,
          categories: input.design.pages.categories.length,
          product: input.design.pages.product.length,
          cart: input.design.pages.cart.length,
        },
      });
      return this.stateIn(tx);
    });
  }

  /** Shoppers see the draft from now on. */
  async publish(
    actor: MerchantActor,
    input: { version: number },
    ip: string,
  ): Promise<StoreDesignState> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(onlineStoreDesigns).for('update');
      if (!row)
        throw AppError.validation([
          {
            path: 'version',
            code: 'nothing_saved',
            message: 'Save the design before publishing it.',
          },
        ]);
      if (row.version !== input.version) throw versionConflict();
      const draft = this.read(row.draft, await this.suggested(tx));
      await this.assertImages(tx, draft);
      await tx
        .update(onlineStoreDesigns)
        .set({
          published: draft,
          publishedAt: sql`now()`,
          publishedByUserId: actor.userId,
          version: sql`${onlineStoreDesigns.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(onlineStoreDesigns.merchantId, actor.merchantId));
      await this.record(tx, actor, 'online.design_published', ip, { template: draft.template });
      return this.stateIn(tx);
    });
  }

  /** Back to what shoppers see (or the legacy layout when nothing was published). */
  async discard(
    actor: MerchantActor,
    input: { version: number },
    ip: string,
  ): Promise<StoreDesignState> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(onlineStoreDesigns).for('update');
      if (!row) return this.stateIn(tx);
      if (row.version !== input.version) throw versionConflict();
      const back = row.published ?? legacyDesign(await this.suggested(tx));
      await tx
        .update(onlineStoreDesigns)
        .set({
          draft: back,
          version: sql`${onlineStoreDesigns.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(onlineStoreDesigns.merchantId, actor.merchantId));
      await this.record(tx, actor, 'online.design_discarded', ip, {});
      return this.stateIn(tx);
    });
  }

  /** What the storefront renders: the published design, else the legacy layout. */
  async publicDesign(slug: string): Promise<{ design: StoreDesign }> {
    const merchantId = await this.store.merchantIdOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const template = await this.suggested(tx);
      const [row] = await tx
        .select({ published: onlineStoreDesigns.published })
        .from(onlineStoreDesigns);
      return {
        design: row?.published ? this.read(row.published, template) : legacyDesign(template),
      };
    });
  }

  // ------------------------------------------------------------------------- pictures
  private assetView(r: typeof onlineStoreAssets.$inferSelect): StoreAsset {
    return {
      id: r.id,
      url: `/api/v1/manager/online/design/assets/${r.id}/file`,
      contentType: r.contentType,
      bytes: r.bytes,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async assets(actor: MerchantActor): Promise<{ assets: StoreAsset[] }> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select()
        .from(onlineStoreAssets)
        .orderBy(desc(onlineStoreAssets.createdAt));
      return { assets: rows.map((r) => this.assetView(r)) };
    });
  }

  async upload(actor: MerchantActor, data: Buffer, ip: string): Promise<StoreAsset> {
    this.assertManage(actor);
    if (data.length === 0 || data.length > MAX_STORE_IMAGE_BYTES)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
    const image = await toStorableImage(data);
    if (!image)
      throw new AppError(415, 'UNSUPPORTED_MEDIA', 'Only JPEG, PNG and WebP images are accepted.');
    const { contentType } = image;
    const id = newId();
    const key = `${actor.merchantId}/online/design/${id}.${image.extension}`;
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [count] = (await tx.execute(sql`select count(*)::int as n from online_store_assets`))
        .rows as { n: number }[];
      if ((count?.n ?? 0) >= MAX_DESIGN_ASSETS)
        throw new AppError(
          409,
          'ASSET_LIMIT_REACHED',
          'The store holds at most 200 design pictures.',
        );
      const [row] = await tx
        .insert(onlineStoreAssets)
        .values({
          id,
          merchantId: actor.merchantId,
          storageKey: key,
          contentType,
          bytes: image.data.length,
          createdByUserId: actor.userId,
        })
        .returning();
      // Written last inside the transaction: a storage failure rolls the row back.
      await this.storage.put(key, image.data);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'online.design_asset_added',
        targetType: 'online_store_asset',
        targetId: id,
        ip,
        details: { bytes: data.length, contentType },
      });
      return this.assetView(row!);
    });
  }

  /** Refused while the draft or the published design still shows the picture. */
  async removeAsset(
    actor: MerchantActor,
    id: string,
    ip: string,
  ): Promise<{ assets: StoreAsset[] }> {
    this.assertManage(actor);
    const key = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      // The design row is the lock: a save that adds the picture waits for this check.
      const [row] = await tx.select().from(onlineStoreDesigns).for('update');
      const template = await this.suggested(tx);
      const used = row
        ? [row.draft, row.published]
            .filter((d) => d !== null)
            .some((d) => designImageIds(this.read(d, template)).includes(id))
        : false;
      if (used)
        throw new AppError(409, 'ASSET_IN_USE', 'This picture is used in the store design.');
      const [asset] = await tx
        .delete(onlineStoreAssets)
        .where(eq(onlineStoreAssets.id, id))
        .returning();
      if (!asset) throw AppError.notFound('Picture not found.');
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'online.design_asset_removed',
        targetType: 'online_store_asset',
        targetId: id,
        ip,
        details: {},
      });
      return asset.storageKey;
    });
    await this.storage.delete(key).catch(() => undefined);
    return this.assets(actor);
  }

  async assetFile(actor: MerchantActor, id: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.readAsset(tx, id));
  }

  async publicAsset(slug: string, id: string) {
    const merchantId = await this.store.merchantIdOf(slug);
    return this.database.withMerchantTx(merchantId, (tx) => this.readAsset(tx, id));
  }

  private async readAsset(tx: Transaction, id: string) {
    const [asset] = await tx.select().from(onlineStoreAssets).where(eq(onlineStoreAssets.id, id));
    if (!asset) throw AppError.notFound('Picture not found.');
    const data = await this.storage.get(asset.storageKey);
    if (!data) throw AppError.notFound('Picture not found.');
    return { data, contentType: asset.contentType };
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'online_store_design',
      targetId: actor.merchantId,
      ip,
      details,
    });
  }
}
