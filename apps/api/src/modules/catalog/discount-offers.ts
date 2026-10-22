import { type PriceOffer, type ProductDiscountRule, offerAt, priceOffers } from '@arabat/pos-core';
import { type SQL, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';

/*
 * Which products each product discount covers, turned into price offers per variant (ADR-0133).
 * Plain functions over a merchant transaction, so the catalog, sales, the online store and the
 * device sync all read the same offers without depending on each other.
 */

export type DiscountChannel = 'pos' | 'online';
type Row = Record<string, unknown>;

/** A covering discount as stored, with what it covers. */
export type StoredDiscount = ProductDiscountRule & {
  appliesTo: 'all' | 'categories' | 'collections' | 'products';
  targetIds: string[];
};

export function ruleOf(r: Row): StoredDiscount {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: r['id'] as string,
    type: r['discount_type'] as 'percentage' | 'amount',
    percent: r['percent'] === null ? null : String(r['percent']),
    amountMinor: r['amount_minor'] === null ? null : BigInt(r['amount_minor'] as string),
    startsAt: iso(r['starts_at']),
    endsAt: iso(r['ends_at']),
    appliesTo: r['applies_to'] as StoredDiscount['appliesTo'],
    targetIds: (r['target_ids'] as string[]) ?? [],
  };
}

/** Active discounts of a channel that have not ended (running now or scheduled). */
export async function liveDiscounts(
  tx: Transaction,
  channel: DiscountChannel,
  now = new Date(),
): Promise<StoredDiscount[]> {
  const rows = (
    await tx.execute(sql`
      select * from product_discounts
      where status = 'active' and (ends_at is null or ends_at > ${now.toISOString()}::timestamptz)
        and ${channel === 'pos' ? sql`pos_enabled` : sql`online_enabled`}
      order by created_at, id`)
  ).rows as Row[];
  return rows.map(ruleOf);
}

/** The variants a discount may touch, with what decides whether it covers them. */
export type DiscountSubject = {
  variantId: string;
  productId: string;
  priceMinor: bigint;
};

/**
 * Whether each discount covers each product: categories include their sub-categories; lists
 * are the store's collections. Returns, per discount, the set of covered product ids (null =
 * every product).
 */
export async function coverage(
  tx: Transaction,
  discounts: readonly StoredDiscount[],
  productIds: readonly string[],
): Promise<Map<string, Set<string> | null>> {
  const out = new Map<string, Set<string> | null>();
  if (discounts.length === 0) return out;
  const ids = [...new Set(productIds)];
  const inList = (list: readonly string[]): SQL =>
    sql.join(
      list.map((id) => sql`${id}`),
      sql`, `,
    );
  const needsCategories = discounts.some((d) => d.appliesTo === 'categories');
  const needsCollections = discounts.some((d) => d.appliesTo === 'collections');
  // Every category's ancestors (the tree is shallow; a cycle is cut at 20 levels).
  const ancestors = new Map<string, string[]>();
  const productCategory = new Map<string, string | null>();
  if (needsCategories && ids.length) {
    const cats = (await tx.execute(sql`select id, parent_id from categories`)).rows as Row[];
    const parent = new Map(cats.map((c) => [c['id'] as string, c['parent_id'] as string | null]));
    for (const id of parent.keys()) {
      const chain = [id];
      let at = parent.get(id) ?? null;
      while (at && chain.length < 20 && !chain.includes(at)) {
        chain.push(at);
        at = parent.get(at) ?? null;
      }
      ancestors.set(id, chain);
    }
    const rows = (
      await tx.execute(sql`select id, category_id from products where id in (${inList(ids)})`)
    ).rows as Row[];
    for (const r of rows)
      productCategory.set(r['id'] as string, (r['category_id'] as string | null) ?? null);
  }
  const productLists = new Map<string, string[]>();
  if (needsCollections && ids.length) {
    const rows = (
      await tx.execute(
        sql`select product_id, collection_id from online_collection_products where product_id in (${inList(ids)})`,
      )
    ).rows as Row[];
    for (const r of rows) {
      const list = productLists.get(r['product_id'] as string) ?? [];
      list.push(r['collection_id'] as string);
      productLists.set(r['product_id'] as string, list);
    }
  }
  for (const d of discounts) {
    if (d.appliesTo === 'all') {
      out.set(d.id, null);
      continue;
    }
    const targets = new Set(d.targetIds);
    const covered = new Set<string>();
    for (const productId of ids) {
      const hit =
        d.appliesTo === 'products'
          ? targets.has(productId)
          : d.appliesTo === 'categories'
            ? (ancestors.get(productCategory.get(productId) ?? '') ?? []).some((c) =>
                targets.has(c),
              )
            : (productLists.get(productId) ?? []).some((c) => targets.has(c));
      if (hit) covered.add(productId);
    }
    out.set(d.id, covered);
  }
  return out;
}

/** Every price offer of the given variants on a channel (running and scheduled discounts). */
export async function offersFor(
  tx: Transaction,
  channel: DiscountChannel,
  subjects: readonly DiscountSubject[],
  now = new Date(),
): Promise<Map<string, PriceOffer[]>> {
  const result = new Map<string, PriceOffer[]>();
  if (subjects.length === 0) return result;
  const discounts = await liveDiscounts(tx, channel, now);
  if (discounts.length === 0) return result;
  const covers = await coverage(
    tx,
    discounts,
    subjects.map((s) => s.productId),
  );
  for (const s of subjects) {
    const rules = discounts.filter((d) => {
      const set = covers.get(d.id);
      return set === null || Boolean(set?.has(s.productId));
    });
    const offers = priceOffers(s.priceMinor, rules);
    if (offers.length) result.set(s.variantId, offers);
  }
  return result;
}

/** The price in force now for each variant: the offer's, with the regular price kept. */
export function inForce(
  offers: ReadonlyMap<string, PriceOffer[]>,
  variantId: string,
  regularMinor: bigint,
  now = new Date(),
): {
  priceMinor: bigint;
  regularPriceMinor: bigint | null;
  discountId: string | null;
  endsAt: string | null;
} {
  const offer = offerAt(offers.get(variantId) ?? [], now);
  return offer
    ? {
        priceMinor: offer.priceMinor,
        regularPriceMinor: regularMinor,
        discountId: offer.discountId,
        endsAt: offer.endsAt,
      }
    : { priceMinor: regularMinor, regularPriceMinor: null, discountId: null, endsAt: null };
}
