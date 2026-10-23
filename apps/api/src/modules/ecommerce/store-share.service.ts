import type { Storefront, StoreProduct } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { EcommerceService } from './ecommerce.service.js';

/*
 * Link previews of the store (ADR-0134): WhatsApp, Instagram, X and others read the page's
 * Open Graph tags without running scripts, so the store's HTML is sent with them already in:
 * the store's name and logo for the store, the category's name for a category, the product's
 * name, price and picture for a product. Pictures are given as a JPEG made for previews
 * (1200 × 630 on white), which every app shows; the stored pictures are WebP.
 */

const PREVIEW_W = 1200;
const PREVIEW_H = 630;
const IMAGE_PATH = /^\/api\/v1\/store\/[^/]+\/images\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/;

export type ShareTarget = { product: string | null; category: string | null };
type Meta = {
  title: string;
  description: string;
  url: string;
  image: string | null;
  type: 'website' | 'product';
  siteName: string;
  price: string | null;
};

const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const name = (v: { nameAr: string | null; nameEn: string | null }) =>
  (v.nameAr || v.nameEn || '').trim();
const oneLine = (v: string | null | undefined, max = 200) => {
  const text = (v ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class StoreShareService {
  constructor(
    private readonly store: EcommerceService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The public origin and store base, e.g. `https://www.arabatapp.com/store`. */
  private get base() {
    return this.env.PUBLIC_STORE_URL.replace(/\/+$/, '');
  }
  private get origin() {
    return new URL(this.base).origin;
  }

  /**
   * The tags for a storefront address (`/store/…` path and query), or null when it is not a
   * published store page (the plain page is sent then).
   */
  async tags(path: string, query: URLSearchParams): Promise<string | null> {
    const parts = path
      .replace(/^\/store\/?/, '')
      .split('/')
      .filter(Boolean);
    const slug = parts[0];
    if (!slug || ['pay', 'links', 'assets'].includes(slug)) return null;
    let front: Storefront;
    try {
      front = await this.store.storefront(slug);
    } catch {
      return null;
    }
    const meta = await this.meta(front, parts.slice(1), query);
    return render(meta);
  }

  private async meta(front: Storefront, rest: string[], query: URLSearchParams): Promise<Meta> {
    const storeName = name(front) || front.slug;
    const pageUrl = `${this.base}/${encodeURIComponent(front.slug)}`;
    const image = (target: Partial<ShareTarget> = {}) => {
      const q = new URLSearchParams();
      if (target.product) q.set('product', target.product);
      if (target.category) q.set('category', target.category);
      // The store's logo and pictures change with their version: the address follows.
      q.set('v', String(front.logoUrl?.split('v=')[1] ?? '1'));
      return `${this.origin}/api/v1/store/${encodeURIComponent(front.slug)}/share.jpg?${q}`;
    };
    const home: Meta = {
      title: storeName,
      description: oneLine(front.taglineAr || front.taglineEn) || `تسوّق من ${storeName} أونلاين`,
      url: pageUrl,
      image: front.logoUrl || front.bannerUrl ? image() : null,
      type: 'website',
      siteName: storeName,
      price: null,
    };
    // A product: /store/:slug/products/:productId
    if (rest[0] === 'products' && rest[1] && UUID.test(rest[1])) {
      let product: StoreProduct;
      try {
        product = await this.store.product(front.slug, rest[1]);
      } catch {
        return home;
      }
      const lowest = product.variants
        .map((v) => Money.fromJSON(v.price as { amount: string; currency: 'KWD' }))
        .reduce((a, b) => (b.compare(a) < 0 ? b : a));
      const price = `${lowest.toDecimalString()} د.ك`;
      const description = oneLine(product.descriptionAr || product.descriptionEn, 160);
      return {
        title: `${name(product)} | ${storeName}`,
        description: description ? `${price} — ${description}` : price,
        url: `${pageUrl}/products/${product.productId}`,
        image: product.images[0] || home.image ? image({ product: product.productId }) : null,
        type: 'product',
        siteName: storeName,
        price: lowest.toDecimalString(),
      };
    }
    // A category or a list: /store/:slug/products?category=… (or /categories?category=…)
    const groupId = query.get('category');
    if ((rest[0] === 'products' || rest[0] === 'categories') && groupId && UUID.test(groupId)) {
      const group =
        front.categories.find((c) => c.id === groupId) ??
        front.collections.find((c) => c.id === groupId);
      if (group)
        return {
          ...home,
          title: `${name(group)} | ${storeName}`,
          description: `تسوّق ${name(group)} من ${storeName}`,
          url: `${pageUrl}/products?category=${groupId}`,
          image: group.imageUrl || home.image ? image({ category: groupId }) : null,
        };
    }
    return home;
  }

  /** The preview picture: the product's or the category's, else the logo, else the banner. */
  async image(slug: string, target: ShareTarget): Promise<Buffer> {
    const sources: (() => Promise<Buffer | null>)[] = [];
    if (target.product && UUID.test(target.product))
      sources.push(async () => {
        const product = await this.store.product(slug, target.product!);
        const match = IMAGE_PATH.exec(product.images[0] ?? '');
        return match ? (await this.store.image(slug, match[1]!, match[2]!)).data : null;
      });
    if (target.category && UUID.test(target.category)) {
      const id = target.category;
      sources.push(async () => (await this.store.publicImage(slug, { categoryId: id })).data);
      sources.push(async () => (await this.store.publicImage(slug, { collectionId: id })).data);
    }
    sources.push(async () => (await this.store.publicImage(slug, 'logo')).data);
    sources.push(async () => (await this.store.publicImage(slug, 'banner')).data);
    for (const source of sources) {
      const data = await source().catch(() => null);
      if (!data) continue;
      try {
        return await sharp(data, { limitInputPixels: 50_000_000 })
          .rotate()
          .resize({
            width: PREVIEW_W - 120,
            height: PREVIEW_H - 80,
            fit: 'contain',
            background: '#ffffff',
            withoutEnlargement: false,
          })
          .extend({
            top: 40,
            bottom: 40,
            left: 60,
            right: 60,
            background: '#ffffff',
          })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
      } catch {
        continue;
      }
    }
    throw AppError.notFound('No picture to show.');
  }
}

function render(m: Meta): string {
  const tag = (property: string, content: string | null) =>
    content ? `<meta property="${property}" content="${escape(content)}" />` : '';
  const named = (n: string, content: string | null) =>
    content ? `<meta name="${n}" content="${escape(content)}" />` : '';
  return [
    `<title>${escape(m.title)}</title>`,
    named('description', m.description),
    `<link rel="canonical" href="${escape(m.url)}" />`,
    tag('og:type', m.type),
    tag('og:site_name', m.siteName),
    tag('og:title', m.title),
    tag('og:description', m.description),
    tag('og:url', m.url),
    tag('og:locale', 'ar_KW'),
    tag('og:image', m.image),
    m.image ? tag('og:image:type', 'image/jpeg') : '',
    m.image ? tag('og:image:width', String(PREVIEW_W)) : '',
    m.image ? tag('og:image:height', String(PREVIEW_H)) : '',
    m.image ? tag('og:image:alt', m.title) : '',
    m.price ? tag('product:price:amount', m.price) : '',
    m.price ? tag('product:price:currency', 'KWD') : '',
    named('twitter:card', m.image ? 'summary_large_image' : 'summary'),
    named('twitter:title', m.title),
    named('twitter:description', m.description),
    named('twitter:image', m.image),
  ]
    .filter(Boolean)
    .join('\n    ');
}
