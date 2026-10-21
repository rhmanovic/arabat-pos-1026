import {
  type OfferItem,
  type PublicOffer,
  type PublicOfferItem,
  type SalesRequest,
  type SalesRequestCreated,
  type SalesRequestList,
  SALES_REQUEST_STATUSES,
  createSalesRequestSchema,
  saveOfferItemSchema,
  updateSalesRequestSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import { renderEmail } from '../../kernel/mail/template.js';
import { FileStorage } from '../../kernel/storage/file-storage.js';
import { toStorableImage } from '../../kernel/storage/image.js';
import { AuditService } from '../audit/audit.service.js';
import { parseAmount } from '../payments/payments.service.js';
import { offerItems, salesRequestLines, salesRequests } from './pricing.schema.js';

type O<T extends z.ZodType> = z.output<T>;
type ItemRow = typeof offerItems.$inferSelect;
type RequestRow = typeof salesRequests.$inferSelect;

const CURRENCY = 'KWD' as const;
export const MAX_OFFER_IMAGE_BYTES = 2 * 1024 * 1024;
const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();
const kwd = (minor: bigint) => `${Money.ofMinor(minor, CURRENCY).toDecimalString()} KWD`;
const reference = (n: number) => `Q-${String(n).padStart(6, '0')}`;
const versionConflict = () =>
  new AppError(409, 'VERSION_CONFLICT', 'This record was changed by someone else. Reload it.');

function toPublicItem(r: ItemRow): PublicOfferItem {
  return {
    id: r.id,
    kind: r.kind as PublicOfferItem['kind'],
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    descriptionAr: r.descriptionAr,
    descriptionEn: r.descriptionEn,
    price: money(r.priceMinor),
    icon: r.icon as PublicOfferItem['icon'],
    imageUrl: r.imageKey ? `/api/v1/public/pricing/images/${r.id}?v=${r.version}` : null,
    maxQuantity: r.maxQuantity,
  };
}

function toItem(r: ItemRow): OfferItem {
  return {
    ...toPublicItem(r),
    status: r.status as OfferItem['status'],
    sortOrder: r.sortOrder,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toRequest(r: RequestRow): Omit<SalesRequest, 'lines'> {
  return {
    id: r.id,
    reference: reference(r.number),
    companyName: r.companyName,
    contactName: r.contactName,
    phone: r.phone,
    email: r.email,
    notes: r.notes,
    language: r.language as SalesRequest['language'],
    system: money(r.systemMinor),
    devices: money(r.devicesMinor),
    total: money(r.totalMinor),
    status: r.status as SalesRequest['status'],
    operatorNote: r.operatorNote,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

/**
 * Public pricing page and purchase requests (ADR-0114). Prices are always taken from the stored
 * items on the server; the page's totals are display only. No money is taken online.
 */
@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------ public
  async publicOffer(): Promise<PublicOffer> {
    const rows = await this.database.db
      .select()
      .from(offerItems)
      .where(eq(offerItems.status, 'active'))
      .orderBy(asc(offerItems.sortOrder), asc(offerItems.nameEn));
    const system = rows.find((r) => r.kind === 'system');
    if (!system) throw AppError.notFound('The pricing page is not set up.');
    return {
      system: toPublicItem(system),
      devices: rows.filter((r) => r.kind === 'device').map(toPublicItem),
    };
  }

  async image(id: string): Promise<{ data: Buffer; contentType: string }> {
    const [row] = await this.database.db.select().from(offerItems).where(eq(offerItems.id, id));
    if (!row?.imageKey || !row.imageContentType) throw AppError.notFound('Image not found.');
    const data = await this.storage.get(row.imageKey);
    if (!data) throw AppError.notFound('Image not found.');
    return { data, contentType: row.imageContentType };
  }

  async createRequest(
    input: O<typeof createSalesRequestSchema>,
    ip: string,
  ): Promise<SalesRequestCreated> {
    const quantities = new Map<string, number>();
    for (const line of input.devices)
      quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity);

    const result = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(offerItems)
        .where(eq(offerItems.status, 'active'))
        .orderBy(asc(offerItems.sortOrder));
      const system = rows.find((r) => r.kind === 'system');
      if (!system) throw AppError.notFound('The pricing page is not set up.');
      const devices = new Map(rows.filter((r) => r.kind === 'device').map((r) => [r.id, r]));
      const lines = [
        { item: system, quantity: 1 },
        ...[...quantities].map(([itemId, quantity], index) => {
          const item = devices.get(itemId);
          if (!item)
            throw AppError.validation([
              {
                path: `devices.${index}.itemId`,
                code: 'unavailable',
                message: 'This device is no longer offered. Reload the page.',
              },
            ]);
          if (quantity > item.maxQuantity)
            throw AppError.validation([
              {
                path: `devices.${index}.quantity`,
                code: 'too_many',
                message: `At most ${item.maxQuantity} of this device.`,
              },
            ]);
          return { item, quantity };
        }),
      ].map(({ item, quantity }) => ({
        item,
        quantity,
        lineTotal: item.priceMinor * BigInt(quantity),
      }));
      const systemMinor = lines[0]!.lineTotal;
      const devicesMinor = lines.slice(1).reduce((sum, l) => sum + l.lineTotal, 0n);
      const id = newId();
      const [created] = await tx
        .insert(salesRequests)
        .values({
          id,
          companyName: input.companyName,
          contactName: input.contactName,
          phone: input.phone,
          email: input.email,
          notes: input.notes,
          language: input.language,
          systemMinor,
          devicesMinor,
          totalMinor: systemMinor + devicesMinor,
          ip,
        })
        .returning();
      await tx.insert(salesRequestLines).values(
        lines.map((l) => ({
          id: newId(),
          requestId: id,
          itemId: l.item.id,
          kind: l.item.kind,
          nameAr: l.item.nameAr,
          nameEn: l.item.nameEn,
          unitPriceMinor: l.item.priceMinor,
          quantity: l.quantity,
          lineTotalMinor: l.lineTotal,
        })),
      );
      await this.audit.recordIn(tx, {
        merchantId: null,
        actorType: 'anonymous',
        actorId: null,
        action: 'pricing.request.created',
        targetType: 'sales_request',
        targetId: id,
        ip,
        details: { reference: reference(created!.number), total: kwd(systemMinor + devicesMinor) },
      });
      return { row: created!, lines };
    });

    await this.notify(result.row, result.lines);
    return {
      reference: reference(result.row.number),
      system: money(result.row.systemMinor),
      devices: money(result.row.devicesMinor),
      total: money(result.row.totalMinor),
    };
  }

  /** E-mails to the sales inbox and a confirmation to the customer; failures never lose the request. */
  private async notify(
    row: RequestRow,
    lines: { item: ItemRow; quantity: number; lineTotal: bigint }[],
  ): Promise<void> {
    const ref = reference(row.number);
    const list = (lang: 'ar' | 'en') =>
      lines
        .map(
          (l) =>
            `${lang === 'ar' ? l.item.nameAr : l.item.nameEn} × ${l.quantity} = ${kwd(l.lineTotal)}`,
        )
        .join('\n');
    const totals = {
      ar: `النظام سنوياً: ${kwd(row.systemMinor)} — الأجهزة (مرة واحدة): ${kwd(row.devicesMinor)} — الدفعة الأولى: ${kwd(row.totalMinor)}`,
      en: `System per year: ${kwd(row.systemMinor)} — devices (once): ${kwd(row.devicesMinor)} — first payment: ${kwd(row.totalMinor)}`,
    };
    const messages = [
      {
        to: this.env.SALES_NOTIFY_EMAIL,
        ...renderEmail({
          title: { ar: `طلب جديد ${ref}`, en: `New request ${ref}` },
          name: 'Arabat',
          intro: {
            ar: `${row.companyName} — ${row.contactName} — ${row.phone} — ${row.email}\n${list('ar')}\n${totals.ar}${row.notes ? `\n${row.notes}` : ''}`,
            en: `${row.companyName} — ${row.contactName} — ${row.phone} — ${row.email}\n${list('en')}\n${totals.en}${row.notes ? `\n${row.notes}` : ''}`,
          },
          note: {
            ar: 'تابع الطلب من صفحة الطلبات في منصة التشغيل.',
            en: 'Follow it up on the requests page of the platform console.',
          },
        }),
      },
      {
        to: row.email,
        ...renderEmail({
          title: { ar: `استلمنا طلبك ${ref}`, en: `We received your request ${ref}` },
          name: row.contactName,
          intro: {
            ar: `شكراً لاختيارك عربات. هذا ملخص طلبك لـ ${row.companyName}:\n${list('ar')}\n${totals.ar}`,
            en: `Thank you for choosing Arabat. Here is the summary of your request for ${row.companyName}:\n${list('en')}\n${totals.en}`,
          },
          note: {
            ar: `سيتواصل معك فريقنا قريباً لإتمام الطلب. لم يتم أي دفع إلكتروني. للاستفسار: ${this.env.SALES_NOTIFY_EMAIL}`,
            en: `Our team will contact you shortly to complete the order. Nothing has been charged. Questions: ${this.env.SALES_NOTIFY_EMAIL}`,
          },
        }),
      },
    ];
    for (const message of messages) {
      try {
        await this.mailer.send(message);
      } catch (error) {
        this.logger.error(`Sales request e-mail failed (${ref}): ${(error as Error).message}`);
      }
    }
  }

  // ------------------------------------------------------------ platform: items
  async items(): Promise<OfferItem[]> {
    const rows = await this.database.db
      .select()
      .from(offerItems)
      .orderBy(asc(offerItems.kind), asc(offerItems.sortOrder), asc(offerItems.nameEn));
    return rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'system' ? -1 : 1)).map(toItem);
  }

  async saveItem(
    actor: PlatformActor,
    id: string | null,
    input: O<typeof saveOfferItemSchema>,
    ip: string,
  ): Promise<OfferItem> {
    const values = {
      nameAr: input.nameAr,
      nameEn: input.nameEn,
      descriptionAr: input.descriptionAr,
      descriptionEn: input.descriptionEn,
      priceMinor: parseAmount(input.price, 'price'),
      icon: input.icon,
      maxQuantity: input.maxQuantity,
      status: input.status,
      sortOrder: input.sortOrder,
    };
    const itemId = id ?? newId();
    await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      if (id) {
        const current = await this.lockItem(tx, id);
        if (current.version !== input.version) throw versionConflict();
        if (current.kind === 'system' && input.status !== 'active')
          throw new AppError(409, 'INVALID_STATE', 'The system cannot be hidden.');
        await tx
          .update(offerItems)
          .set({
            ...values,
            ...(current.kind === 'system' ? { maxQuantity: 1 } : {}),
            version: sql`${offerItems.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(offerItems.id, id));
        await this.record(tx, actor, 'pricing.item.updated', itemId, ip, {
          kind: current.kind,
          price: input.price,
          previousPrice: Money.ofMinor(current.priceMinor, CURRENCY).toDecimalString(),
          status: input.status,
        });
      } else {
        // New items are always devices: there is exactly one system.
        await tx.insert(offerItems).values({ id: itemId, kind: 'device', ...values });
        await this.record(tx, actor, 'pricing.item.created', itemId, ip, {
          kind: 'device',
          price: input.price,
          status: input.status,
        });
      }
    });
    return this.item(itemId);
  }

  async setImage(
    actor: PlatformActor,
    id: string,
    data: Buffer | null,
    ip: string,
  ): Promise<OfferItem> {
    let contentType: string | null = null;
    let key: string | null = null;
    let stored: Buffer | null = null;
    if (data) {
      if (data.length === 0 || data.length > MAX_OFFER_IMAGE_BYTES)
        throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Images must be at most 2 MB.');
      const image = await toStorableImage(data);
      if (!image)
        throw new AppError(
          415,
          'UNSUPPORTED_MEDIA',
          'Only JPEG, PNG and WebP images are accepted.',
        );
      contentType = image.contentType;
      stored = image.data;
      key = `platform/offer/${id}/${newId()}.${image.extension}`;
    }
    const previous = await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      const current = await this.lockItem(tx, id);
      await tx
        .update(offerItems)
        .set({
          imageKey: key,
          imageContentType: contentType,
          version: sql`${offerItems.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(offerItems.id, id));
      // Written last inside the transaction: a storage failure rolls the row back.
      if (key && stored) await this.storage.put(key, stored);
      await this.record(
        tx,
        actor,
        data ? 'pricing.item.image_set' : 'pricing.item.image_removed',
        id,
        ip,
        {},
      );
      return current.imageKey;
    });
    if (previous)
      await this.storage.delete(previous).catch((error: unknown) => {
        this.logger.warn(`Old offer image not deleted: ${(error as Error).message}`);
      });
    return this.item(id);
  }

  // ------------------------------------------------------------ platform: requests
  async requests(status?: SalesRequest['status']): Promise<SalesRequestList> {
    const rows = await this.database.db
      .select()
      .from(salesRequests)
      .where(status ? eq(salesRequests.status, status) : undefined)
      .orderBy(desc(salesRequests.createdAt))
      .limit(200);
    const grouped = await this.database.db
      .select({ status: salesRequests.status, n: sql<number>`count(*)::int` })
      .from(salesRequests)
      .groupBy(salesRequests.status);
    const counts = Object.fromEntries(SALES_REQUEST_STATUSES.map((s) => [s, 0])) as Record<
      SalesRequest['status'],
      number
    >;
    for (const g of grouped) counts[g.status as SalesRequest['status']] = Number(g.n);
    return { requests: rows.map(toRequest), counts };
  }

  async request(id: string): Promise<SalesRequest> {
    const [row] = await this.database.db
      .select()
      .from(salesRequests)
      .where(eq(salesRequests.id, id));
    if (!row) throw AppError.notFound('Request not found.');
    const lines = await this.database.db
      .select()
      .from(salesRequestLines)
      .where(inArray(salesRequestLines.requestId, [id]))
      .orderBy(desc(salesRequestLines.kind), asc(salesRequestLines.nameEn));
    return {
      ...toRequest(row),
      lines: lines.map((l) => ({
        kind: l.kind as 'system' | 'device',
        nameAr: l.nameAr,
        nameEn: l.nameEn,
        unitPrice: money(l.unitPriceMinor),
        quantity: l.quantity,
        lineTotal: money(l.lineTotalMinor),
      })),
    };
  }

  async updateRequest(
    actor: PlatformActor,
    id: string,
    input: O<typeof updateSalesRequestSchema>,
    ip: string,
  ): Promise<SalesRequest> {
    await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      const [current] = await tx
        .select()
        .from(salesRequests)
        .where(eq(salesRequests.id, id))
        .for('update');
      if (!current) throw AppError.notFound('Request not found.');
      if (current.version !== input.version) throw versionConflict();
      await tx
        .update(salesRequests)
        .set({
          status: input.status,
          operatorNote: input.operatorNote,
          handledByOperatorId: actor.operatorId,
          version: sql`${salesRequests.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(salesRequests.id, id));
      await this.record(tx, actor, 'pricing.request.updated', id, ip, {
        reference: reference(current.number),
        from: current.status,
        to: input.status,
      });
    });
    return this.request(id);
  }

  // ------------------------------------------------------------ helpers
  private async item(id: string): Promise<OfferItem> {
    const [row] = await this.database.db.select().from(offerItems).where(eq(offerItems.id, id));
    if (!row) throw AppError.notFound('Item not found.');
    return toItem(row);
  }

  private async lockItem(tx: Transaction, id: string): Promise<ItemRow> {
    const [row] = await tx.select().from(offerItems).where(eq(offerItems.id, id)).for('update');
    if (!row) throw AppError.notFound('Item not found.');
    return row;
  }

  private record(
    tx: Transaction,
    actor: PlatformActor,
    action: string,
    targetId: string,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: null,
      actorType: 'operator',
      actorId: actor.operatorId,
      action,
      targetType: action.startsWith('pricing.request') ? 'sales_request' : 'offer_item',
      targetId,
      ip,
      details: { ...details, operatorRole: actor.role },
    });
  }
}
