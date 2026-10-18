import {
  type LinkItem,
  type LinkPage,
  MAX_LINK_AVATAR_BYTES,
  MAX_LINK_ITEMS,
  type PublicLinkPage,
  type saveLinkItemSchema,
  type saveLinkPageSchema,
} from '@arabat/contracts';
import { can } from '@arabat/permissions';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { FileStorage, sniffImageType } from '../../kernel/storage/file-storage.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { onlineStores } from '../ecommerce/ecommerce.schema.js';
import { linkPageItems, linkPages } from './links.schema.js';

type PageRow = typeof linkPages.$inferSelect;
type ItemRow = typeof linkPageItems.$inferSelect;

const SLUG_TAKEN = () =>
  new AppError(409, 'DUPLICATE_CODE', 'Another business already uses this address.', [
    { path: 'slug', code: 'duplicate', message: 'Another business already uses this address.' },
  ]);

/**
 * Link page ("link in bio", ADR-0116): the merchant's own public page of links to put in a
 * social-media profile. Managed under `online.manage`; the public page knows only the slug.
 */
@Injectable()
export class LinksService {
  private readonly logger = new Logger(LinksService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertManage(actor: MerchantActor) {
    if (!can(actor.access, 'online.manage', null)) throw AppError.forbidden();
  }

  private publicBase() {
    return this.env.PUBLIC_STORE_URL.replace(/\/$/, '');
  }

  private async slugAvailable(tx: Transaction, slug: string, merchantId: string) {
    const [row] = (await tx.execute(sql`select link_slug_available(${slug}, ${merchantId}) as ok`))
      .rows as { ok: boolean }[];
    return Boolean(row?.ok);
  }

  /** The first address offered: the online store's, when it is free, else a neutral one. */
  private async suggestedSlug(tx: Transaction, merchantId: string) {
    const [store] = await tx.select({ slug: onlineStores.slug }).from(onlineStores);
    if (store && (await this.slugAvailable(tx, store.slug, merchantId))) return store.slug;
    // The end of a UUIDv7 is random; its start is a timestamp shared by companies opened together.
    return `links-${merchantId.replace(/-/g, '').slice(-12)}`;
  }

  /** Creates the draft page on first use (links can be added before the settings are saved). */
  private async ensurePage(tx: Transaction, merchantId: string): Promise<PageRow> {
    const [row] = await tx.select().from(linkPages).for('update');
    if (row) return row;
    const [m] = (
      await tx.execute(
        sql`select display_name_en, display_name_ar from merchants where id = ${merchantId}`,
      )
    ).rows as { display_name_en: string | null; display_name_ar: string | null }[];
    const [created] = await tx
      .insert(linkPages)
      .values({
        merchantId,
        slug: await this.suggestedSlug(tx, merchantId),
        titleAr: m?.display_name_ar ?? null,
        titleEn: m?.display_name_en ?? null,
      })
      .returning();
    return created!;
  }

  private toItem(r: ItemRow): LinkItem {
    return {
      id: r.id,
      kind: r.kind as LinkItem['kind'],
      labelAr: r.labelAr,
      labelEn: r.labelEn,
      url: r.url,
      status: r.status as LinkItem['status'],
      sortOrder: r.sortOrder,
      clicks: Number(r.clicks),
      version: r.version,
    };
  }

  // ------------------------------------------------------------ manager
  async page(actor: MerchantActor): Promise<LinkPage> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(linkPages);
      const items = await tx.select().from(linkPageItems).orderBy(asc(linkPageItems.sortOrder));
      const [store] = await tx
        .select({ slug: onlineStores.slug, status: onlineStores.status })
        .from(onlineStores);
      const [m] = (
        await tx.execute(
          sql`select display_name_en, display_name_ar from merchants where id = ${actor.merchantId}`,
        )
      ).rows as { display_name_en: string | null; display_name_ar: string | null }[];
      const slug = row?.slug ?? (await this.suggestedSlug(tx, actor.merchantId));
      return {
        slug,
        status: (row?.status as LinkPage['status']) ?? 'draft',
        titleAr: row ? row.titleAr : (m?.display_name_ar ?? null),
        titleEn: row ? row.titleEn : (m?.display_name_en ?? null),
        bioAr: row?.bioAr ?? null,
        bioEn: row?.bioEn ?? null,
        themeColor: row?.themeColor ?? '#1e3a8a',
        buttonStyle: (row?.buttonStyle as LinkPage['buttonStyle']) ?? 'rounded',
        background: (row?.background as LinkPage['background']) ?? 'light',
        avatarUrl: row?.avatarKey ? `/api/v1/manager/link-page/avatar?v=${row.version}` : null,
        url: `${this.publicBase()}/links/${slug}`,
        storeUrl: store && store.status !== 'draft' ? `${this.publicBase()}/${store.slug}` : null,
        items: items.map((i) => this.toItem(i)),
        version: row?.version ?? 0,
      };
    });
  }

  async savePage(actor: MerchantActor, input: z.output<typeof saveLinkPageSchema>, ip: string) {
    this.assertManage(actor);
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [row] = await tx.select().from(linkPages).for('update');
        if ((row?.version ?? 0) !== input.version) throw versionConflict();
        if (!(await this.slugAvailable(tx, input.slug, actor.merchantId))) throw SLUG_TAKEN();
        const values = {
          slug: input.slug,
          status: input.status,
          titleAr: input.titleAr,
          titleEn: input.titleEn,
          bioAr: input.bioAr,
          bioEn: input.bioEn,
          themeColor: input.themeColor,
          buttonStyle: input.buttonStyle,
          background: input.background,
        };
        if (row)
          await tx
            .update(linkPages)
            .set({ ...values, version: sql`${linkPages.version} + 1`, updatedAt: sql`now()` });
        else await tx.insert(linkPages).values({ merchantId: actor.merchantId, ...values });
        await this.record(tx, actor, 'links.page_updated', actor.merchantId, ip, {
          status: input.status,
          slug: input.slug,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error, 'link_pages_slug_key')) throw SLUG_TAKEN();
      throw error;
    }
    return this.page(actor);
  }

  async createItem(actor: MerchantActor, input: z.output<typeof saveLinkItemSchema>, ip: string) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.ensurePage(tx, actor.merchantId);
      const [stats] = (
        await tx.execute(
          sql`select count(*)::int as n, coalesce(max(sort_order), -1)::int as last from link_page_items`,
        )
      ).rows as { n: number; last: number }[];
      if ((stats?.n ?? 0) >= MAX_LINK_ITEMS)
        throw new AppError(
          409,
          'LINK_LIMIT_REACHED',
          `A link page holds at most ${MAX_LINK_ITEMS} links.`,
        );
      const id = newId();
      await tx.insert(linkPageItems).values({
        id,
        merchantId: actor.merchantId,
        kind: input.kind,
        labelAr: input.labelAr,
        labelEn: input.labelEn,
        url: input.url,
        status: input.status,
        sortOrder: (stats?.last ?? -1) + 1,
      });
      await this.record(tx, actor, 'links.item_created', id, ip, { kind: input.kind });
    });
    return this.page(actor);
  }

  async updateItem(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof saveLinkItemSchema>,
    ip: string,
  ) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const current = await this.lockItem(tx, id);
      if (current.version !== input.version) throw versionConflict();
      await tx
        .update(linkPageItems)
        .set({
          kind: input.kind,
          labelAr: input.labelAr,
          labelEn: input.labelEn,
          url: input.url,
          status: input.status,
          version: sql`${linkPageItems.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(linkPageItems.id, id));
      await this.record(tx, actor, 'links.item_updated', id, ip, {
        kind: input.kind,
        status: input.status,
      });
    });
    return this.page(actor);
  }

  async deleteItem(actor: MerchantActor, id: string, ip: string) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const current = await this.lockItem(tx, id);
      await tx.delete(linkPageItems).where(eq(linkPageItems.id, id));
      await this.record(tx, actor, 'links.item_deleted', id, ip, {
        kind: current.kind,
        url: current.url,
      });
    });
    return this.page(actor);
  }

  /** `ids` must list every link of the page exactly once, in the new order. */
  async reorder(actor: MerchantActor, ids: string[], ip: string) {
    this.assertManage(actor);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx.select({ id: linkPageItems.id }).from(linkPageItems).for('update');
      const known = new Set(rows.map((r) => r.id));
      if (
        new Set(ids).size !== ids.length ||
        ids.length !== known.size ||
        ids.some((i) => !known.has(i))
      )
        throw AppError.validation([
          { path: 'ids', code: 'invalid', message: 'List every link of the page exactly once.' },
        ]);
      for (const [position, itemId] of ids.entries())
        await tx
          .update(linkPageItems)
          .set({ sortOrder: position })
          .where(eq(linkPageItems.id, itemId));
      await this.record(tx, actor, 'links.items_reordered', actor.merchantId, ip, {
        count: ids.length,
      });
    });
    return this.page(actor);
  }

  async avatar(actor: MerchantActor) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx.select().from(linkPages);
      return this.readAvatar(row);
    });
  }

  async setAvatar(actor: MerchantActor, data: Buffer | null, ip: string) {
    this.assertManage(actor);
    let contentType: string | null = null;
    let key: string | null = null;
    if (data) {
      if (data.length === 0 || data.length > MAX_LINK_AVATAR_BYTES)
        throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
      contentType = sniffImageType(data);
      if (!contentType)
        throw new AppError(
          415,
          'UNSUPPORTED_MEDIA',
          'Only JPEG, PNG and WebP images are accepted.',
        );
      key = `merchants/${actor.merchantId}/link-page/${newId()}.${contentType.split('/')[1]}`;
    }
    const previous = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const page = await this.ensurePage(tx, actor.merchantId);
      await tx.update(linkPages).set({
        avatarKey: key,
        avatarContentType: contentType,
        version: sql`${linkPages.version} + 1`,
        updatedAt: sql`now()`,
      });
      // Written last inside the transaction: a storage failure rolls the row back.
      if (key && data) await this.storage.put(key, data);
      await this.record(
        tx,
        actor,
        data ? 'links.avatar_set' : 'links.avatar_removed',
        actor.merchantId,
        ip,
        {},
      );
      return page.avatarKey;
    });
    if (previous)
      await this.storage.delete(previous).catch((error: unknown) => {
        this.logger.warn(`Old link-page picture not deleted: ${(error as Error).message}`);
      });
    return this.page(actor);
  }

  // ------------------------------------------------------------ public page
  /** Resolves a published page's slug to its merchant (active merchants only). */
  private async merchantOf(slug: string): Promise<string> {
    const [row] = (await this.database.db.execute(sql`select link_page_merchant(${slug}) as m`))
      .rows as { m: string | null }[];
    if (!row?.m) throw AppError.notFound('Page not found.');
    return row.m;
  }

  async publicPage(slug: string): Promise<PublicLinkPage> {
    const merchantId = await this.merchantOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const [page] = await tx.select().from(linkPages);
      if (!page) throw AppError.notFound('Page not found.');
      const items = await tx
        .select()
        .from(linkPageItems)
        .where(eq(linkPageItems.status, 'active'))
        .orderBy(asc(linkPageItems.sortOrder));
      return {
        slug: page.slug,
        titleAr: page.titleAr,
        titleEn: page.titleEn,
        bioAr: page.bioAr,
        bioEn: page.bioEn,
        themeColor: page.themeColor,
        buttonStyle: page.buttonStyle as PublicLinkPage['buttonStyle'],
        background: page.background as PublicLinkPage['background'],
        avatarUrl: page.avatarKey
          ? `/api/v1/public/links/${encodeURIComponent(page.slug)}/avatar?v=${page.version}`
          : null,
        items: items.map((i) => ({
          id: i.id,
          kind: i.kind as LinkItem['kind'],
          labelAr: i.labelAr,
          labelEn: i.labelEn,
          url: i.url,
        })),
      };
    });
  }

  async publicAvatar(slug: string) {
    const merchantId = await this.merchantOf(slug);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const [row] = await tx.select().from(linkPages);
      return this.readAvatar(row);
    });
  }

  /** Counts one open of an active link (BR-201). Unknown links are ignored silently. */
  async click(slug: string, itemId: string): Promise<void> {
    const merchantId = await this.merchantOf(slug);
    await this.database.withMerchantTx(merchantId, (tx) =>
      tx
        .update(linkPageItems)
        .set({ clicks: sql`${linkPageItems.clicks} + 1` })
        .where(and(eq(linkPageItems.id, itemId), eq(linkPageItems.status, 'active'))),
    );
  }

  // ------------------------------------------------------------ helpers
  private async readAvatar(row: PageRow | undefined) {
    if (!row?.avatarKey || !row.avatarContentType) throw AppError.notFound('Image not found.');
    const data = await this.storage.get(row.avatarKey);
    if (!data) throw AppError.notFound('Image not found.');
    return { data, contentType: row.avatarContentType };
  }

  private async lockItem(tx: Transaction, id: string): Promise<ItemRow> {
    const [row] = await tx
      .select()
      .from(linkPageItems)
      .where(eq(linkPageItems.id, id))
      .for('update');
    if (!row) throw AppError.notFound('Link not found.');
    return row;
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    id: string,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'link_page',
      targetId: id,
      ip,
      details,
    });
  }
}
