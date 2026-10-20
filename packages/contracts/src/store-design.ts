import { z } from 'zod';

/*
 * Storefront design (ADR-0128): the header, navigation bar, side menu, footer and the sections
 * of the three designed pages (home, products, categories). The merchant edits a draft in the
 * console and publishes it; the storefront renders the published design, or the legacy layout
 * while nothing was published. The same schema validates what the API stores and what the
 * storefront reads, so a design is never half-understood.
 */

export const DESIGN_TEMPLATES = ['retail', 'restaurant'] as const;
export type DesignTemplate = (typeof DESIGN_TEMPLATES)[number];
export const DESIGN_PAGES = ['home', 'products', 'categories'] as const;
export type DesignPage = (typeof DESIGN_PAGES)[number];

export const SECTION_TYPES = [
  'slider',
  'banner',
  'products',
  'categories',
  'image',
  'video',
  'text',
  'features',
  'menu',
  'info',
  'catalog',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

/** A text in both languages; the storefront falls back to the other one when one is empty. */
const localized = (max: number) =>
  z.object({ en: text(max), ar: text(max) }).default({ en: null, ar: null });
export type Localized = { en: string | null; ar: string | null };

const id = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/);
const uuidLike = z.string().trim().min(1).max(64);

/** Outside links: https only (or a phone / e-mail); inside links start with one slash. */
export function isSafeLinkUrl(value: string): boolean {
  if (/^https:\/\/[^\s]+$/i.test(value)) return true;
  if (/^(tel:\+?[0-9 -]{3,20}|mailto:[^\s@]+@[^\s@]+)$/i.test(value)) return true;
  return /^\/(?!\/)[^\s]*$/.test(value);
}

export const designLinkSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('page'),
    page: z.enum(['home', 'products', 'categories', 'cart', 'account']),
  }),
  z.object({ kind: z.literal('category'), categoryId: uuidLike }),
  z.object({ kind: z.literal('product'), productId: uuidLike }),
  z.object({
    kind: z.literal('url'),
    url: z
      .string()
      .trim()
      .max(500)
      .refine(isSafeLinkUrl, 'Use an https:// address, a phone, an e-mail or a store path.'),
  }),
]);
export type DesignLink = z.infer<typeof designLinkSchema>;
const link = designLinkSchema.nullish().transform((v) => v ?? null);

/** An uploaded design image (`online_store_assets.id`), or null. */
const image = z
  .uuid()
  .nullish()
  .transform((v) => v ?? null);

/** The embed address of a YouTube, Vimeo or TikTok video, or null for anything else. */
export function videoEmbed(url: string): { provider: string; src: string } | null {
  const m = /^https:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i.exec(url.trim());
  if (!m) return null;
  const host = m[1]!.toLowerCase().replace(/^(www\.|m\.)/, '');
  const parts = m[2]!.split('/').filter(Boolean);
  const query = new Map(
    (m[3] ?? '')
      .slice(1)
      .split('&')
      .map((kv) => kv.split('=') as [string, string]),
  );
  const clean = (v: string | undefined | null) => (v && /^[A-Za-z0-9_-]{4,40}$/.test(v) ? v : null);
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const vid = clean(
      host === 'youtu.be'
        ? parts[0]
        : parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live'
          ? parts[1]
          : query.get('v'),
    );
    return vid
      ? { provider: 'youtube', src: `https://www.youtube-nocookie.com/embed/${vid}` }
      : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const vid = parts.find((p) => /^[0-9]{3,15}$/.test(p));
    return vid ? { provider: 'vimeo', src: `https://player.vimeo.com/video/${vid}` } : null;
  }
  if (host === 'tiktok.com') {
    const at = parts.indexOf('video');
    const vid = at >= 0 ? parts[at + 1] : undefined;
    return vid && /^[0-9]{5,25}$/.test(vid)
      ? { provider: 'tiktok', src: `https://www.tiktok.com/embed/v2/${vid}` }
      : null;
  }
  return null;
}

// ------------------------------------------------------------------------------- sections
const base = { id, visible: z.boolean().default(true) };

const slideSchema = z.object({
  id,
  imageId: image,
  title: localized(80),
  subtitle: localized(160),
  button: localized(30),
  link,
});
export const sliderSectionSchema = z.object({
  ...base,
  type: z.literal('slider'),
  variant: z.enum(['full', 'contained', 'cards']).default('contained'),
  autoplay: z.boolean().default(true),
  slides: z.array(slideSchema).max(8).default([]),
});
export const bannerSectionSchema = z.object({
  ...base,
  type: z.literal('banner'),
  variant: z.enum(['overlay', 'split', 'color']).default('overlay'),
  /** `store` = the store's banner picture (settings), `upload` = `imageId`. */
  imageSource: z.enum(['store', 'upload', 'none']).default('upload'),
  imageId: image,
  title: localized(80),
  subtitle: localized(200),
  button: localized(30),
  link,
  align: z.enum(['start', 'center']).default('start'),
});
export const productsSectionSchema = z.object({
  ...base,
  type: z.literal('products'),
  variant: z.enum(['grid', 'carousel', 'list']).default('grid'),
  title: localized(80),
  source: z.enum(['featured', 'all', 'category', 'manual']).default('featured'),
  categoryId: uuidLike.nullish().transform((v) => v ?? null),
  productIds: z.array(uuidLike).max(24).default([]),
  limit: z.number().int().min(1).max(24).default(8),
  columns: z.number().int().min(2).max(4).default(4),
});
export const categoriesSectionSchema = z.object({
  ...base,
  type: z.literal('categories'),
  variant: z.enum(['tiles', 'circles', 'chips', 'list']).default('tiles'),
  title: localized(80),
  /** Empty = every category of the store, in its order. */
  categoryIds: z.array(uuidLike).max(40).default([]),
});
export const imageSectionSchema = z.object({
  ...base,
  type: z.literal('image'),
  variant: z.enum(['contained', 'full']).default('contained'),
  imageId: image,
  alt: localized(120),
  link,
  aspect: z.enum(['wide', 'square', 'tall', 'auto']).default('wide'),
});
export const videoSectionSchema = z.object({
  ...base,
  type: z.literal('video'),
  variant: z.enum(['contained', 'full']).default('contained'),
  title: localized(80),
  url: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || videoEmbed(v) !== null, 'Use a YouTube, Vimeo or TikTok link.')
    .default(''),
  aspect: z.enum(['landscape', 'portrait']).default('landscape'),
});
export const textSectionSchema = z.object({
  ...base,
  type: z.literal('text'),
  variant: z.enum(['plain', 'card', 'highlight']).default('plain'),
  title: localized(120),
  body: localized(2000),
  align: z.enum(['start', 'center']).default('start'),
});
export const featuresSectionSchema = z.object({
  ...base,
  type: z.literal('features'),
  variant: z.enum(['row', 'grid', 'cards']).default('row'),
  items: z
    .array(
      z.object({
        id,
        icon: z.string().trim().max(8).default(''),
        title: localized(60),
        text: localized(160),
      }),
    )
    .max(6)
    .default([]),
});
/** The restaurant menu: products grouped by category with jump tabs. */
export const menuSectionSchema = z.object({
  ...base,
  type: z.literal('menu'),
  variant: z.enum(['list', 'grid', 'compact']).default('list'),
  title: localized(80),
  stickyTabs: z.boolean().default(true),
  showImages: z.boolean().default(true),
  showDescriptions: z.boolean().default(true),
  categoryIds: z.array(uuidLike).max(40).default([]),
});
/** Opening state, preparation / delivery times, minimum order and branches. */
export const infoSectionSchema = z.object({
  ...base,
  type: z.literal('info'),
  variant: z.enum(['strip', 'cards']).default('strip'),
  showHours: z.boolean().default(true),
  showDelivery: z.boolean().default(true),
  showBranches: z.boolean().default(false),
  showContact: z.boolean().default(false),
});
/** The browsable product list with search, sort and category filter. */
export const catalogSectionSchema = z.object({
  ...base,
  type: z.literal('catalog'),
  variant: z.enum(['grid', 'list']).default('grid'),
  showSearch: z.boolean().default(true),
  showSort: z.boolean().default(true),
  showCategories: z.boolean().default(true),
  showFeatured: z.boolean().default(true),
  columns: z.number().int().min(2).max(4).default(4),
});

export const sectionSchema = z.discriminatedUnion('type', [
  sliderSectionSchema,
  bannerSectionSchema,
  productsSectionSchema,
  categoriesSectionSchema,
  imageSectionSchema,
  videoSectionSchema,
  textSectionSchema,
  featuresSectionSchema,
  menuSectionSchema,
  infoSectionSchema,
  catalogSectionSchema,
]);
export type DesignSection = z.infer<typeof sectionSchema>;
export type SectionOf<T extends SectionType> = Extract<DesignSection, { type: T }>;

// --------------------------------------------------------------------------- the shell
const navChildSchema = z.object({ id, label: localized(30), link: designLinkSchema });
/**
 * A navigation item: a link, optionally with a sub-menu, or `categories` (a menu of the store's
 * categories, shown as a list or a picture mega-menu by `navbar.menuStyle`).
 */
const navItemSchema = z.object({
  id,
  label: localized(30),
  link: designLinkSchema,
  kind: z.enum(['link', 'categories']).default('link'),
  children: z.array(navChildSchema).max(10).default([]),
});
export type NavItem = z.infer<typeof navItemSchema>;

export const HEADER_LAYOUTS = [
  'classic',
  'centered',
  'split',
  'stacked',
  'minimal',
  'floating',
  'bold',
] as const;
export type HeaderLayout = (typeof HEADER_LAYOUTS)[number];
export const HEADER_ACTIONS = [
  'search',
  'account',
  'branch',
  'language',
  'whatsapp',
  'cart',
] as const;
export type HeaderAction = (typeof HEADER_ACTIONS)[number];
const DEFAULT_ACTIONS: { type: HeaderAction; visible: boolean }[] = [
  { type: 'search', visible: true },
  { type: 'account', visible: true },
  { type: 'branch', visible: true },
  { type: 'language', visible: true },
  { type: 'whatsapp', visible: false },
  { type: 'cart', visible: true },
];

/** Header items in the merchant's order: each kind once, the cart always shown. */
const actionsSchema = z
  .array(z.object({ type: z.enum(HEADER_ACTIONS), visible: z.boolean() }))
  .max(HEADER_ACTIONS.length * 2)
  .default(DEFAULT_ACTIONS)
  .transform((list) => {
    const seen = new Set<HeaderAction>();
    const out = list.filter((a) => (seen.has(a.type) ? false : (seen.add(a.type), true)));
    for (const a of DEFAULT_ACTIONS)
      if (!seen.has(a.type)) out.push({ ...a, visible: a.type === 'cart' });
    return out.map((a) => (a.type === 'cart' ? { ...a, visible: true } : a));
  });

const headerSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object') return value;
    const h = value as Record<string, unknown>;
    // Designs saved before the header system v2 (ADR-0128 amendment 1) had `showSearch`.
    if (h['actions'] === undefined && h['showSearch'] === false)
      return {
        ...h,
        actions: DEFAULT_ACTIONS.map((a) => (a.type === 'search' ? { ...a, visible: false } : a)),
      };
    return h;
  },
  z.object({
    layout: z.enum(HEADER_LAYOUTS).default('classic'),
    background: z.enum(['light', 'brand', 'dark', 'glass']).default('light'),
    border: z.enum(['none', 'line', 'shadow']).default('line'),
    height: z.enum(['compact', 'regular', 'tall']).default('regular'),
    width: z.enum(['contained', 'full']).default('contained'),
    sticky: z.boolean().default(true),
    /** Slides away while scrolling down, comes back when scrolling up. */
    hideOnScroll: z.boolean().default(false),
    logoSize: z.enum(['small', 'medium', 'large']).default('medium'),
    showName: z.boolean().default(true),
    showTagline: z.boolean().default(true),
    /** Search as an icon, or as a search bar in the header (the search-first layout always shows the bar). */
    searchStyle: z.enum(['icon', 'bar']).default('icon'),
    cartStyle: z.enum(['pill', 'icon', 'text']).default('pill'),
    languageStyle: z.enum(['compact', 'full']).default('compact'),
    actions: actionsSchema,
    mobileLayout: z.enum(['start', 'center']).default('start'),
    /** A search bar under the header on phones. */
    mobileSearch: z.boolean().default(false),
  }),
);
export type HeaderDesign = z.output<typeof headerSchema>;
const footerBlockSchema = z.object({
  id,
  type: z.enum(['about', 'links', 'categories', 'contact', 'hours', 'social', 'payments']),
  title: localized(40),
  text: localized(400),
  links: z
    .array(z.object({ id, label: localized(30), link: designLinkSchema }))
    .max(8)
    .default([]),
});
export type FooterBlock = z.infer<typeof footerBlockSchema>;

const handle = z
  .string()
  .trim()
  .max(60)
  .regex(/^[A-Za-z0-9._-]*$/, 'Letters, digits, dots, dashes and underscores only.')
  .default('');

export const storeDesignSchema = z
  .object({
    template: z.enum(DESIGN_TEMPLATES).default('retail'),
    style: z
      .object({
        radius: z.enum(['sharp', 'soft', 'round']).default('soft'),
        background: z.enum(['white', 'tinted', 'dark']).default('white'),
        cards: z.enum(['bordered', 'shadow', 'flat']).default('bordered'),
        buttons: z.enum(['solid', 'pill']).default('solid'),
      })
      .default({ radius: 'soft', background: 'white', cards: 'bordered', buttons: 'solid' }),
    /** The top bar: the store's announcement and up to three rotating messages, with shortcuts. */
    announcement: z
      .object({
        style: z.enum(['brand', 'dark', 'soft']).default('brand'),
        messages: z.array(localized(120)).max(3).default([]),
        showContact: z.boolean().default(false),
        showSocial: z.boolean().default(false),
      })
      .prefault({}),
    header: headerSchema.prefault({}),
    navbar: z
      .object({
        style: z.enum(['links', 'underline', 'pills', 'boxed', 'hidden']).default('links'),
        align: z.enum(['start', 'center', 'end']).default('center'),
        menuStyle: z.enum(['dropdown', 'mega']).default('mega'),
        items: z.array(navItemSchema).max(8).default([]),
      })
      .prefault({}),
    drawer: z
      .object({
        enabled: z.boolean().default(true),
        style: z.enum(['side', 'full']).default('side'),
        showCategories: z.boolean().default(true),
        showContact: z.boolean().default(true),
        showSocial: z.boolean().default(true),
      })
      .prefault({}),
    footer: z
      .object({
        style: z.enum(['simple', 'columns', 'centered', 'dark']).default('simple'),
        blocks: z.array(footerBlockSchema).max(6).default([]),
        showPoweredBy: z.boolean().default(true),
      })
      .default({ style: 'simple', blocks: [], showPoweredBy: true }),
    social: z
      .object({
        instagram: handle,
        tiktok: handle,
        snapchat: handle,
        x: handle,
        youtube: handle,
        whatsapp: z
          .string()
          .trim()
          .max(20)
          .regex(/^\+?[0-9]*$/, 'Digits only, with the country code.')
          .default(''),
      })
      .default({ instagram: '', tiktok: '', snapchat: '', x: '', youtube: '', whatsapp: '' }),
    mobileBar: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
    pages: z.object({
      home: z.array(sectionSchema).max(30),
      products: z.array(sectionSchema).max(15),
      categories: z.array(sectionSchema).max(15),
    }),
  })
  .superRefine((d, ctx) => {
    // The products page lists the products (catalog or menu); the categories page lists them.
    if (!d.pages.products.some((s) => s.type === 'catalog' || s.type === 'menu'))
      ctx.addIssue({
        code: 'custom',
        path: ['pages', 'products'],
        message: 'The products page needs a product list (catalog or menu).',
      });
    if (!d.pages.categories.some((s) => s.type === 'categories'))
      ctx.addIssue({
        code: 'custom',
        path: ['pages', 'categories'],
        message: 'The categories page needs a categories section.',
      });
    for (const page of DESIGN_PAGES) {
      const ids = d.pages[page].map((s) => s.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: 'custom',
          path: ['pages', page],
          message: 'Two sections share an id.',
        });
    }
  });
export type StoreDesign = z.infer<typeof storeDesignSchema>;
export type StoreDesignInput = z.input<typeof storeDesignSchema>;

/** Every image a design refers to (to refuse deleting one in use). */
export function designImageIds(design: StoreDesign): string[] {
  const ids: (string | null)[] = [];
  for (const page of DESIGN_PAGES)
    for (const s of design.pages[page]) {
      if (s.type === 'slider') ids.push(...s.slides.map((x) => x.imageId));
      if (s.type === 'banner' || s.type === 'image') ids.push(s.imageId);
    }
  return [...new Set(ids.filter((x): x is string => Boolean(x)))];
}

// ----------------------------------------------------------------------- templates
const l = (en: string, ar: string): Localized => ({ en, ar });
const parse = (d: StoreDesignInput) => storeDesignSchema.parse(d);

/**
 * The layout of a store that never published a design: today's storefront (the store banner,
 * then the catalog with search, sort, categories and featured products).
 */
export function legacyDesign(template: DesignTemplate = 'retail'): StoreDesign {
  return parse({
    template,
    footer: { style: 'simple', blocks: [{ id: 'contact', type: 'contact' }], showPoweredBy: false },
    drawer: { enabled: false },
    mobileBar: { enabled: false },
    navbar: { style: 'links', items: [] },
    header: { layout: 'classic', showSearch: false },
    pages: {
      home: [
        { id: 'banner', type: 'banner', variant: 'overlay', imageSource: 'store' },
        { id: 'catalog', type: 'catalog' },
      ],
      products: [{ id: 'catalog', type: 'catalog' }],
      categories: [{ id: 'categories', type: 'categories', variant: 'tiles' }],
    },
  });
}

/** Starting points offered in the console (ADR-0128): shops and restaurants differ. */
export function templateDesign(template: DesignTemplate): StoreDesign {
  const nav = [
    { id: 'nav-home', label: l('Home', 'الرئيسية'), link: { kind: 'page', page: 'home' } },
    {
      id: 'nav-products',
      label: template === 'restaurant' ? l('Menu', 'المنيو') : l('Shop', 'المنتجات'),
      link: { kind: 'page', page: 'products' },
    },
    {
      id: 'nav-categories',
      label: l('Categories', 'التصنيفات'),
      link: { kind: 'page', page: 'categories' },
      kind: 'categories',
    },
  ] as const;
  const footer = {
    style: 'columns' as const,
    showPoweredBy: true,
    blocks: [
      { id: 'about', type: 'about' as const, title: l('About us', 'من نحن') },
      { id: 'categories', type: 'categories' as const, title: l('Categories', 'التصنيفات') },
      { id: 'contact', type: 'contact' as const, title: l('Contact', 'تواصل معنا') },
      { id: 'social', type: 'social' as const, title: l('Follow us', 'تابعنا') },
    ],
  };
  if (template === 'restaurant')
    return parse({
      template,
      style: { radius: 'round', background: 'tinted', cards: 'shadow', buttons: 'pill' },
      header: {
        layout: 'centered',
        background: 'light',
        border: 'shadow',
        logoSize: 'large',
        cartStyle: 'pill',
        mobileLayout: 'center',
        actions: [
          { type: 'whatsapp', visible: true },
          { type: 'account', visible: true },
          { type: 'language', visible: true },
          { type: 'cart', visible: true },
        ],
      },
      navbar: { style: 'pills', align: 'center', items: [...nav] },
      footer: {
        ...footer,
        blocks: [
          ...footer.blocks.slice(0, 1),
          { id: 'hours', type: 'hours', title: l('Opening hours', 'أوقات العمل') },
          ...footer.blocks.slice(2),
        ],
      },
      pages: {
        home: [
          {
            id: 'hero',
            type: 'banner',
            variant: 'overlay',
            imageSource: 'store',
            align: 'center',
            title: l('Fresh from our kitchen', 'طازج من مطبخنا'),
            subtitle: l('Order for pickup or delivery', 'اطلب استلام أو توصيل'),
            button: l('Order now', 'اطلب الآن'),
            link: { kind: 'page', page: 'products' },
          },
          { id: 'info', type: 'info', variant: 'strip' },
          {
            id: 'popular',
            type: 'products',
            variant: 'carousel',
            source: 'featured',
            title: l('Most ordered', 'الأكثر طلبًا'),
          },
          { id: 'menu', type: 'menu', variant: 'list', title: l('Menu', 'المنيو') },
        ],
        products: [
          { id: 'info', type: 'info', variant: 'strip' },
          { id: 'menu', type: 'menu', variant: 'list' },
        ],
        categories: [{ id: 'categories', type: 'categories', variant: 'tiles' }],
      },
    });
  return parse({
    template,
    style: { radius: 'soft', background: 'white', cards: 'bordered', buttons: 'solid' },
    header: {
      layout: 'stacked',
      background: 'light',
      border: 'line',
      searchStyle: 'bar',
      cartStyle: 'pill',
      mobileSearch: true,
    },
    navbar: { style: 'underline', align: 'start', menuStyle: 'mega', items: [...nav] },
    footer,
    pages: {
      home: [
        {
          id: 'slider',
          type: 'slider',
          variant: 'contained',
          slides: [
            {
              id: 'slide-1',
              title: l('New arrivals', 'وصل حديثًا'),
              subtitle: l('Discover what is new this week', 'اكتشف جديد هذا الأسبوع'),
              button: l('Shop now', 'تسوّق الآن'),
              link: { kind: 'page', page: 'products' },
            },
          ],
        },
        {
          id: 'features',
          type: 'features',
          variant: 'row',
          items: [
            { id: 'f1', icon: '🚚', title: l('Fast delivery', 'توصيل سريع') },
            { id: 'f2', icon: '💳', title: l('Pay your way', 'ادفع بطريقتك') },
            { id: 'f3', icon: '⭐', title: l('Quality you trust', 'جودة مضمونة') },
          ],
        },
        {
          id: 'categories',
          type: 'categories',
          variant: 'circles',
          title: l('Shop by category', 'تسوّق حسب التصنيف'),
        },
        {
          id: 'featured',
          type: 'products',
          variant: 'carousel',
          source: 'featured',
          title: l('Featured', 'مختارات'),
        },
        {
          id: 'all',
          type: 'products',
          variant: 'grid',
          source: 'all',
          limit: 8,
          title: l('All products', 'كل المنتجات'),
        },
      ],
      products: [{ id: 'catalog', type: 'catalog' }],
      categories: [{ id: 'categories', type: 'categories', variant: 'tiles' }],
    },
  });
}

/** A new section of a type with its defaults (the console's "Add section"). */
export function newSection(type: SectionType, sectionId: string): DesignSection {
  return sectionSchema.parse({ id: sectionId, type });
}

// ------------------------------------------------------------------------------- API
export const storeDesignStateSchema = z.object({
  draft: storeDesignSchema,
  published: storeDesignSchema.nullable(),
  publishedAt: z.string().nullable(),
  /** Unpublished changes exist. */
  dirty: z.boolean(),
  /** The template suggested for the company (restaurant module on = restaurant). */
  suggestedTemplate: z.enum(DESIGN_TEMPLATES),
  version: z.number().int(),
});
export type StoreDesignState = z.infer<typeof storeDesignStateSchema>;
export const saveStoreDesignSchema = z.object({
  design: storeDesignSchema,
  version: z.number().int().nonnegative(),
});
export const storeDesignVersionSchema = z.object({ version: z.number().int().nonnegative() });

export const storeAssetSchema = z.object({
  id: z.string(),
  url: z.string(),
  contentType: z.string(),
  bytes: z.number().int(),
  createdAt: z.string(),
});
export type StoreAsset = z.infer<typeof storeAssetSchema>;
export const storeAssetListSchema = z.object({ assets: z.array(storeAssetSchema) });

/** What the storefront reads: the published design (or the legacy layout). */
export const publicStoreDesignSchema = z.object({ design: storeDesignSchema });
