import { type PriceOffer, offerAt } from '@arabat/pos-core';
import type { BridgeDb } from './bridge.js';

/** A sellable variant with what the till shows and what pricing needs. */
export interface CatalogItem {
  variantId: string;
  productId: string;
  categoryId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  variantNameEn: string | null;
  variantNameAr: string | null;
  sku: string | null;
  barcodes: string[];
  /** The price in force: the discounted one while a product discount runs (see `catalogAt`). */
  priceMinor: bigint;
  /** The catalog price while a discount lowers `priceMinor`; null otherwise (ADR-0133). */
  regularPriceMinor: bigint | null;
  discountId: string | null;
  /** Every discounted price of the item with its dates. */
  offers: PriceOffer[];
  costMinor: bigint | null;
  trackInventory: boolean;
}

export interface CatalogCategory {
  id: string;
  parentId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  sortOrder: number;
}

export interface Catalog {
  items: Map<string, CatalogItem>;
  categories: CatalogCategory[];
  byBarcode: Map<string, string>;
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** Sellable products with active variants, as the device sells them now. */
export async function loadCatalog(db: BridgeDb): Promise<Catalog> {
  const rows = await db.query(
    `SELECT v.id, v.product_id, p.category_id, p.name_en, p.name_ar, v.name_en AS v_en, v.name_ar AS v_ar, v.sku,
            v.price_minor, v.cost_minor, p.track_inventory
     FROM variants v JOIN products p ON p.id = v.product_id
     WHERE p.sellable = 1 AND v.status = 'active'
     ORDER BY p.name_en, p.name_ar, v.position`,
  );
  const codes = await db.query(`SELECT barcode, variant_id FROM barcodes`);
  const offerRows = await db.query(
    `SELECT variant_id, discount_id, price_minor, starts_at, ends_at FROM price_offers`,
  );
  const offers = new Map<string, PriceOffer[]>();
  for (const o of offerRows) {
    const list = offers.get(String(o['variant_id'])) ?? [];
    list.push({
      discountId: String(o['discount_id']),
      priceMinor: BigInt(String(o['price_minor'])),
      startsAt: str(o['starts_at']),
      endsAt: str(o['ends_at']),
    });
    offers.set(String(o['variant_id']), list);
  }
  const byVariant = new Map<string, string[]>();
  for (const c of codes) {
    const list = byVariant.get(String(c['variant_id'])) ?? [];
    list.push(String(c['barcode']));
    byVariant.set(String(c['variant_id']), list);
  }
  const items = new Map<string, CatalogItem>();
  const byBarcode = new Map<string, string>();
  for (const r of rows) {
    const id = String(r['id']);
    const barcodes = byVariant.get(id) ?? [];
    items.set(id, {
      variantId: id,
      productId: String(r['product_id']),
      categoryId: str(r['category_id']),
      nameEn: str(r['name_en']),
      nameAr: str(r['name_ar']),
      variantNameEn: str(r['v_en']),
      variantNameAr: str(r['v_ar']),
      sku: str(r['sku']),
      barcodes,
      priceMinor: BigInt(String(r['price_minor'])),
      regularPriceMinor: null,
      discountId: null,
      offers: offers.get(id) ?? [],
      costMinor: r['cost_minor'] === null ? null : BigInt(String(r['cost_minor'])),
      trackInventory: r['track_inventory'] === 1,
    });
    for (const code of barcodes) byBarcode.set(code, id);
  }
  const cats = await db.query(
    `SELECT * FROM categories WHERE status = 'active' ORDER BY sort_order, id`,
  );
  return {
    items,
    byBarcode,
    categories: cats.map((c) => ({
      id: String(c['id']),
      parentId: str(c['parent_id']),
      nameEn: str(c['name_en']),
      nameAr: str(c['name_ar']),
      sortOrder: Number(c['sort_order']),
    })),
  };
}

/**
 * The catalog at a moment: each item's price is the one in force then (the largest running
 * product discount, ADR-0133), with the regular price kept. The till prices and sells with it.
 */
export function catalogAt(catalog: Catalog, now: Date = new Date()): Catalog {
  const items = new Map<string, CatalogItem>();
  for (const [id, item] of catalog.items) {
    const regular = item.regularPriceMinor ?? item.priceMinor;
    const offer = offerAt(item.offers, now);
    items.set(
      id,
      offer
        ? {
            ...item,
            priceMinor: offer.priceMinor,
            regularPriceMinor: regular,
            discountId: offer.discountId,
          }
        : { ...item, priceMinor: regular, regularPriceMinor: null, discountId: null },
    );
  }
  return { ...catalog, items };
}

/** Name, variant, SKU or barcode containing the text (case-insensitive); exact barcode first. */
export function searchCatalog(
  catalog: Catalog,
  query: string,
  categoryId: string | null = null,
): CatalogItem[] {
  const q = query.trim().toLowerCase();
  const all = [...catalog.items.values()].filter(
    (i) => categoryId === null || i.categoryId === categoryId,
  );
  if (!q) return all;
  const exact = catalog.byBarcode.get(query.trim());
  const hits = all.filter(
    (i) =>
      i.variantId !== exact &&
      [i.nameEn, i.nameAr, i.variantNameEn, i.variantNameAr, i.sku, ...i.barcodes].some((f) =>
        f?.toLowerCase().includes(q),
      ),
  );
  return exact && catalog.items.has(exact) ? [catalog.items.get(exact)!, ...hits] : hits;
}
