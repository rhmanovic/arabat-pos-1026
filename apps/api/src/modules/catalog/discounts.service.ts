import type {
  ProductDiscount,
  ProductDiscountPreview,
  saveProductDiscountSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { can } from '@arabat/permissions';
import { discountedPrice } from '@arabat/pos-core';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { parseAmount } from '../payments/payments.service.js';
import { type StoredDiscount, coverage, ruleOf } from './discount-offers.js';

type Row = Record<string, unknown>;
type SaveInput = z.output<typeof saveProductDiscountSchema>;
const CURRENCY = 'KWD' as const;
const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const str = (v: unknown) => (v as string | null) ?? null;

/** Active products with their variants' prices and costs, to count what a discount lowers. */
type Sellable = {
  productId: string;
  nameEn: string | null;
  nameAr: string | null;
  variants: { priceMinor: bigint; costMinor: bigint | null }[];
};

/**
 * Product discounts (ADR-0133), managed in the store console: a percentage or an amount off
 * chosen products, at the point of sale and / or online, optionally between two dates. Saving
 * changes no catalog price; sales and the store read the price in force (`discount-offers.ts`).
 */
@Injectable()
export class DiscountsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private assertRead(actor: MerchantActor) {
    if (!can(actor.access, 'online.manage') && !can(actor.access, 'catalog.prices.manage'))
      throw AppError.forbidden();
  }

  /** Discounts change selling prices: the right to manage prices is needed. */
  private assertManage(actor: MerchantActor) {
    if (!can(actor.access, 'catalog.prices.manage', null))
      throw AppError.forbidden('Discounts need the "Manage prices and costs" permission.');
  }

  async list(actor: MerchantActor): Promise<{ discounts: ProductDiscount[] }> {
    this.assertRead(actor);
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.rows(tx));
  }

  private async rows(tx: Transaction, onlyId?: string): Promise<{ discounts: ProductDiscount[] }> {
    const rows = (
      await tx.execute(sql`
        select * from product_discounts
        ${onlyId ? sql`where id = ${onlyId}` : sql``}
        order by (status = 'archived'), created_at desc, id`)
    ).rows as Row[];
    const sellable = rows.length ? await this.sellable(tx) : [];
    const counts = await this.lowered(
      tx,
      rows.map((r) => ruleOf(r)),
      sellable,
    );
    const now = Date.now();
    return {
      discounts: rows.map((r) => {
        const status = r['status'] as ProductDiscount['status'];
        const startsAt = iso(r['starts_at']);
        const endsAt = iso(r['ends_at']);
        const state: ProductDiscount['state'] =
          status === 'archived'
            ? 'archived'
            : status === 'paused'
              ? 'paused'
              : endsAt && Date.parse(endsAt) <= now
                ? 'ended'
                : startsAt && Date.parse(startsAt) > now
                  ? 'scheduled'
                  : 'running';
        return {
          id: r['id'] as string,
          nameEn: str(r['name_en']),
          nameAr: str(r['name_ar']),
          type: r['discount_type'] as ProductDiscount['type'],
          percent: r['percent'] === null ? null : String(r['percent']),
          amount: r['amount_minor'] === null ? null : money(BigInt(r['amount_minor'] as string)),
          appliesTo: r['applies_to'] as ProductDiscount['appliesTo'],
          targetIds: (r['target_ids'] as string[]) ?? [],
          pos: r['pos_enabled'] as boolean,
          online: r['online_enabled'] as boolean,
          startsAt,
          endsAt,
          status,
          state,
          productCount: counts.get(r['id'] as string)?.products ?? 0,
          version: r['version'] as number,
          createdAt: iso(r['created_at'])!,
        };
      }),
    };
  }

  private async sellable(tx: Transaction): Promise<Sellable[]> {
    const rows = (
      await tx.execute(sql`
        select p.id, p.name_en, p.name_ar, v.price_minor::text as price, v.cost_minor::text as cost
        from products p join product_variants v on v.product_id = p.id
        where p.status = 'active' and v.status = 'active'
        order by coalesce(p.name_ar, p.name_en), v.position`)
    ).rows as Row[];
    const out = new Map<string, Sellable>();
    for (const r of rows) {
      const id = r['id'] as string;
      const p = out.get(id) ?? {
        productId: id,
        nameEn: str(r['name_en']),
        nameAr: str(r['name_ar']),
        variants: [],
      };
      p.variants.push({
        priceMinor: BigInt(r['price'] as string),
        costMinor: r['cost'] === null ? null : BigInt(r['cost'] as string),
      });
      out.set(id, p);
    }
    return [...out.values()];
  }

  /** Per discount: the products it lowers, those it leaves alone and those below cost. */
  private async lowered(tx: Transaction, discounts: StoredDiscount[], sellable: Sellable[]) {
    const covers = await coverage(
      tx,
      discounts,
      sellable.map((p) => p.productId),
    );
    const result = new Map<
      string,
      { products: number; unchanged: number; belowCost: Sellable[]; lowered: Sellable[] }
    >();
    for (const d of discounts) {
      const set = covers.get(d.id);
      const entry = {
        products: 0,
        unchanged: 0,
        belowCost: [] as Sellable[],
        lowered: [] as Sellable[],
      };
      for (const p of sellable) {
        if (set !== null && !set?.has(p.productId)) continue;
        const prices = p.variants.map((v) => ({ v, price: discountedPrice(v.priceMinor, d) }));
        if (prices.every((x) => x.price === null)) {
          entry.unchanged++;
          continue;
        }
        entry.products++;
        entry.lowered.push(p);
        if (
          prices.some((x) => x.price !== null && x.v.costMinor !== null && x.price < x.v.costMinor)
        )
          entry.belowCost.push(p);
      }
      result.set(d.id, entry);
    }
    return result;
  }

  /** What a discount would do, before saving (how many products, which go below cost). */
  async preview(actor: MerchantActor, input: SaveInput): Promise<ProductDiscountPreview> {
    this.assertRead(actor);
    const rule = this.rule('preview', input);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.assertTargets(tx, input);
      const sellable = await this.sellable(tx);
      const entry = (await this.lowered(tx, [rule], sellable)).get(rule.id)!;
      const below = new Set(entry.belowCost.map((p) => p.productId));
      const ordered = [...entry.belowCost, ...entry.lowered.filter((p) => !below.has(p.productId))];
      return {
        products: entry.products,
        unchanged: entry.unchanged,
        belowCost: entry.belowCost.length,
        samples: ordered.slice(0, 20).map((p) => {
          const v = p.variants.find((x) => discountedPrice(x.priceMinor, rule) !== null)!;
          const price = discountedPrice(v.priceMinor, rule)!;
          return {
            productId: p.productId,
            nameEn: p.nameEn,
            nameAr: p.nameAr,
            price: money(v.priceMinor),
            discountedPrice: money(price),
            cost: v.costMinor === null ? null : money(v.costMinor),
            belowCost: below.has(p.productId),
          };
        }),
      };
    });
  }

  private rule(id: string, input: SaveInput): StoredDiscount {
    return {
      id,
      type: input.type,
      percent: input.type === 'percentage' ? input.percent : null,
      amountMinor: input.type === 'amount' ? parseAmount(input.amount!, 'amount') : null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      appliesTo: input.appliesTo,
      targetIds: input.appliesTo === 'all' ? [] : [...new Set(input.targetIds)],
    };
  }

  /** Every chosen category, list or product must be this company's. */
  private async assertTargets(tx: Transaction, input: SaveInput) {
    if (input.appliesTo === 'all') return;
    const ids = [...new Set(input.targetIds)];
    const table =
      input.appliesTo === 'categories'
        ? sql`categories`
        : input.appliesTo === 'collections'
          ? sql`online_collections`
          : sql`products`;
    const [row] = (
      await tx.execute(
        sql`select count(*)::int as n from ${table} where id in (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      )
    ).rows as { n: number }[];
    if ((row?.n ?? 0) !== ids.length)
      throw AppError.validation([
        { path: 'targetIds', code: 'not_found', message: 'Something chosen no longer exists.' },
      ]);
  }

  async create(actor: MerchantActor, input: SaveInput, ip: string): Promise<ProductDiscount> {
    this.assertManage(actor);
    const id = newId();
    const r = this.rule(id, input);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.assertTargets(tx, input);
      await tx.execute(sql`
        insert into product_discounts (id, merchant_id, name_en, name_ar, discount_type, percent, amount_minor,
          applies_to, target_ids, pos_enabled, online_enabled, starts_at, ends_at, status)
        values (${id}, ${actor.merchantId}, ${input.nameEn}, ${input.nameAr}, ${r.type}, ${r.percent}, ${r.amountMinor},
          ${r.appliesTo}, ${JSON.stringify(r.targetIds)}::jsonb, ${input.pos}, ${input.online},
          ${r.startsAt}::timestamptz, ${r.endsAt}::timestamptz, ${input.status})`);
      await this.record(tx, actor, 'catalog.discount_created', id, ip, this.details(input, r));
      return (await this.rows(tx, id)).discounts[0]!;
    });
  }

  async update(
    actor: MerchantActor,
    id: string,
    input: SaveInput,
    ip: string,
  ): Promise<ProductDiscount> {
    this.assertManage(actor);
    const r = this.rule(id, input);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(
          sql`select version, status from product_discounts where id = ${id} for update`,
        )
      ).rows as Row[];
      if (!row) throw AppError.notFound('Discount not found.');
      if (row['status'] === 'archived')
        throw new AppError(409, 'DISCOUNT_ARCHIVED', 'An archived discount cannot be changed.');
      if (input.version !== undefined && row['version'] !== input.version) throw versionConflict();
      await this.assertTargets(tx, input);
      await tx.execute(sql`
        update product_discounts set name_en = ${input.nameEn}, name_ar = ${input.nameAr},
          discount_type = ${r.type}, percent = ${r.percent}, amount_minor = ${r.amountMinor},
          applies_to = ${r.appliesTo}, target_ids = ${JSON.stringify(r.targetIds)}::jsonb,
          pos_enabled = ${input.pos}, online_enabled = ${input.online},
          starts_at = ${r.startsAt}::timestamptz, ends_at = ${r.endsAt}::timestamptz, status = ${input.status},
          version = version + 1, updated_at = now()
        where id = ${id}`);
      await this.record(tx, actor, 'catalog.discount_updated', id, ip, this.details(input, r));
      return (await this.rows(tx, id)).discounts[0]!;
    });
  }

  /** Pause, resume or archive (archived discounts stay for the sales that name them). */
  async setStatus(
    actor: MerchantActor,
    id: string,
    status: 'active' | 'paused' | 'archived',
    ip: string,
  ): Promise<ProductDiscount> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`select status from product_discounts where id = ${id} for update`)
      ).rows as Row[];
      if (!row) throw AppError.notFound('Discount not found.');
      if (row['status'] === 'archived' && status !== 'archived')
        throw new AppError(409, 'DISCOUNT_ARCHIVED', 'An archived discount cannot be changed.');
      if (row['status'] !== status) {
        await tx.execute(
          sql`update product_discounts set status = ${status}, version = version + 1, updated_at = now() where id = ${id}`,
        );
        await this.record(tx, actor, 'catalog.discount_status_changed', id, ip, {
          from: row['status'],
          to: status,
        });
      }
      return (await this.rows(tx, id)).discounts[0]!;
    });
  }

  private details(input: SaveInput, r: StoredDiscount): Row {
    return {
      name: input.nameAr ?? input.nameEn,
      type: r.type,
      value: r.type === 'percentage' ? r.percent : input.amount,
      appliesTo: r.appliesTo,
      targets: r.targetIds.length,
      pos: input.pos,
      online: input.online,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: input.status,
    };
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    id: string,
    ip: string,
    details: Row,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'product_discount',
      targetId: id,
      ip,
      details,
    });
  }
}
