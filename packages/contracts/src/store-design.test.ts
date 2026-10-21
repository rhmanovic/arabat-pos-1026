import { describe, expect, it } from 'vitest';
import {
  HOME_LAYOUTS,
  PRODUCT_PAGE_PRESETS,
  READY_SECTIONS,
  designImageIds,
  homeLayout,
  legacyDesign,
  productPagePreset,
  readySection,
  sectionSchema,
  storeDesignSchema,
  templateDesign,
} from './store-design.js';

const PIC = (n: number) => `0198f0a2-5c3e-7d41-9a3b-2f6c8e1d4b7${n}`;

describe('home page sections (ADR-0128 amendment 3)', () => {
  it('gives sections saved before the amendment the default look', () => {
    const old = sectionSchema.parse({ id: 'banner', type: 'banner', variant: 'overlay' });
    expect(old.look).toEqual({
      background: 'none',
      spacing: 'regular',
      width: 'contained',
      titleAlign: 'start',
      subtitle: { en: null, ar: null },
      devices: 'all',
      showFrom: null,
      showUntil: null,
    });
  });

  it('refuses a schedule that ends before it starts, and a date that is not one', () => {
    const at = (look: Record<string, unknown>) =>
      sectionSchema.safeParse({ id: 's', type: 'spacer', look }).success;
    expect(at({ showFrom: '2030-01-02T00:00:00Z', showUntil: '2030-01-01T00:00:00Z' })).toBe(false);
    expect(at({ showFrom: 'next week' })).toBe(false);
    expect(at({ showFrom: '2030-01-01T00:00:00Z', showUntil: '2030-01-02T00:00:00Z' })).toBe(true);
  });

  it('counts the pictures of galleries, logos, collages and calls to action as in use', () => {
    const base = legacyDesign();
    const design = storeDesignSchema.parse({
      ...base,
      pages: {
        ...base.pages,
        home: [
          { id: 'g', type: 'gallery', items: [{ id: 'a', imageId: PIC(1) }] },
          { id: 'l', type: 'logos', items: [{ id: 'b', imageId: PIC(2) }] },
          { id: 'c', type: 'collage', tiles: [{ id: 'c1', imageId: PIC(3) }] },
          { id: 'x', type: 'cta', variant: 'image', imageId: PIC(4), title: { en: 'Hi' } },
        ],
      },
    });
    expect(designImageIds(design).sort()).toEqual([PIC(1), PIC(2), PIC(3), PIC(4)]);
  });

  it('builds every ready section and every ready home page as a valid design', () => {
    for (const name of READY_SECTIONS) expect(readySection(name, `r-${name}`).id).toBe(`r-${name}`);
    const base = legacyDesign();
    for (const layout of HOME_LAYOUTS) {
      const home = homeLayout(layout);
      expect(new Set(home.map((s) => s.id)).size).toBe(home.length);
      expect(storeDesignSchema.safeParse({ ...base, pages: { ...base.pages, home } }).success).toBe(
        true,
      );
    }
  });

  it('keeps invented content out of the ready sections', () => {
    // Reviews, answers and logos wait for the merchant; an offer has no end until set.
    expect(readySection('reviews', 'r')).toMatchObject({ type: 'testimonials', items: [] });
    expect(readySection('brands', 'b')).toMatchObject({ type: 'logos', items: [] });
    const faq = readySection('faq', 'f');
    expect(faq.type === 'faq' && faq.items.every((i) => !i.answer.en && !i.answer.ar)).toBe(true);
    expect(readySection('offerCountdown', 'o')).toMatchObject({ endsAt: null });
  });
});

describe('product page (ADR-0128 amendment 4)', () => {
  it('gives designs saved before the amendment a product page and no sections under it', () => {
    const { productPage: _, ...old } = legacyDesign();
    const { product: __, ...pages } = old.pages;
    const parsed = storeDesignSchema.parse({ ...old, pages });
    expect(parsed.pages.product).toEqual([]);
    expect(parsed.productPage).toMatchObject({
      layout: 'classic',
      gallery: { thumbs: 'below', ratio: 'square', zoom: true },
      buy: { options: 'buttons', quantity: 'stepper', stickyBar: true, buyNow: false },
      related: { enabled: true, source: 'category', limit: 4 },
      recent: { enabled: false },
    });
  });

  it('offers presets that parse, and template designs start from one', () => {
    for (const p of PRODUCT_PAGE_PRESETS) expect(productPagePreset(p)).toBeTruthy();
    expect(productPagePreset('food').layout).toBe('compact');
    expect(templateDesign('restaurant').productPage.layout).toBe('compact');
    expect(templateDesign('retail').productPage.highlights).toHaveLength(3);
  });

  it('keeps catalogs, menus and repeated ids off the product page', () => {
    const base = legacyDesign();
    const withProduct = (product: unknown[]) =>
      storeDesignSchema.safeParse({ ...base, pages: { ...base.pages, product } }).success;
    expect(withProduct([{ id: 'faq', type: 'faq' }])).toBe(true);
    expect(withProduct([{ id: 'c', type: 'catalog' }])).toBe(false);
    expect(withProduct([{ id: 'm', type: 'menu' }])).toBe(false);
    expect(
      withProduct([
        { id: 'x', type: 'faq' },
        { id: 'x', type: 'spacer' },
      ]),
    ).toBe(false);
  });

  it('bounds the settings', () => {
    const base = legacyDesign();
    const ok = (productPage: unknown) =>
      storeDesignSchema.safeParse({ ...base, productPage }).success;
    expect(ok({ info: { lowStockAt: 11 } })).toBe(false);
    expect(ok({ related: { limit: 1 } })).toBe(false);
    expect(ok({ layout: 'carousel' })).toBe(false);
    expect(ok({ highlights: Array.from({ length: 5 }, (_, i) => ({ id: `h${i}` })) })).toBe(false);
    expect(ok({ description: { style: 'tabs', blocks: [{ id: 'b' }] } })).toBe(true);
  });
});
