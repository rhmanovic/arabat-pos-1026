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
export const DESIGN_PAGES = ['home', 'products', 'categories', 'product', 'cart'] as const;
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
  'countdown',
  'testimonials',
  'faq',
  'gallery',
  'logos',
  'collage',
  'cta',
  'spacer',
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
/** A moment in time (ISO 8601 with an offset), or null. */
const moment = z
  .string()
  .trim()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Use a valid date and time.')
  .nullish()
  .transform((v) => v ?? null);

/**
 * How any section sits on the page (ADR-0128 amendment 3): its background, spacing, width,
 * heading (subtitle and alignment), the screens it shows on, and when it shows.
 */
export const sectionLookSchema = z
  .object({
    background: z.enum(['none', 'soft', 'tinted', 'brand', 'dark']).default('none'),
    spacing: z.enum(['compact', 'regular', 'roomy']).default('regular'),
    /** `full` = edge to edge; a coloured background always spans the screen. */
    width: z.enum(['contained', 'full']).default('contained'),
    titleAlign: z.enum(['start', 'center']).default('start'),
    subtitle: localized(200),
    devices: z.enum(['all', 'desktop', 'phone']).default('all'),
    showFrom: moment,
    showUntil: moment,
  })
  .refine((l) => !l.showFrom || !l.showUntil || Date.parse(l.showFrom) < Date.parse(l.showUntil), {
    message: 'The section must start before it ends.',
    path: ['showUntil'],
  });
export type SectionLook = z.output<typeof sectionLookSchema>;

const base = { id, visible: z.boolean().default(true), look: sectionLookSchema.prefault({}) };

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
  /** Seconds per slide. */
  interval: z.union([z.literal(3), z.literal(5), z.literal(8)]).default(5),
  height: z.enum(['small', 'medium', 'large']).default('medium'),
  overlay: z.enum(['none', 'light', 'dark']).default('dark'),
  textAlign: z.enum(['start', 'center']).default('start'),
  showArrows: z.boolean().default(true),
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
  /** A second, quieter button. */
  button2: localized(30),
  link2: link,
  align: z.enum(['start', 'center']).default('start'),
  height: z.enum(['small', 'medium', 'large']).default('medium'),
  overlay: z.enum(['none', 'light', 'dark']).default('dark'),
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
  sort: z.enum(['position', 'name', 'priceAsc', 'priceDesc']).default('position'),
  /** One-tap "add" on products with a single option. */
  showAdd: z.boolean().default(false),
  showViewAll: z.boolean().default(true),
});
export const categoriesSectionSchema = z.object({
  ...base,
  type: z.literal('categories'),
  variant: z.enum(['tiles', 'circles', 'chips', 'list', 'cards', 'banners']).default('tiles'),
  title: localized(80),
  /** Empty = every category of the store, in its order. */
  categoryIds: z.array(uuidLike).max(40).default([]),
  columns: z.number().int().min(2).max(6).default(4),
  /** Columns on phones (tiles and cards). */
  mobileColumns: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** Picture shape of tiles and cards (ADR-0128 amendment 6). */
  aspect: z.enum(['landscape', 'square', 'portrait']).default('landscape'),
  /** How many products each category holds. */
  showCount: z.boolean().default(false),
  /** Only the main categories (when none is chosen by hand). */
  topOnly: z.boolean().default(false),
  /** Each category's subcategories as small links under it (tiles, cards, list). */
  showSub: z.boolean().default(false),
  showViewAll: z.boolean().default(false),
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
  button: localized(30),
  link,
});
export const featuresSectionSchema = z.object({
  ...base,
  type: z.literal('features'),
  variant: z.enum(['row', 'grid', 'cards']).default('row'),
  title: localized(80),
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

/** An offer that ends at a moment, with a live countdown; it hides itself once ended. */
export const countdownSectionSchema = z.object({
  ...base,
  type: z.literal('countdown'),
  variant: z.enum(['banner', 'card', 'minimal']).default('banner'),
  title: localized(80),
  subtitle: localized(200),
  endsAt: moment,
  button: localized(30),
  link,
});
/** Words from customers, entered by the merchant (never invented by the platform). */
export const testimonialsSectionSchema = z.object({
  ...base,
  type: z.literal('testimonials'),
  variant: z.enum(['cards', 'carousel', 'quote']).default('cards'),
  title: localized(80),
  items: z
    .array(
      z.object({
        id,
        name: text(60),
        detail: localized(60),
        quote: localized(400),
        rating: z.number().int().min(0).max(5).default(5),
      }),
    )
    .max(12)
    .default([]),
});
export const faqSectionSchema = z.object({
  ...base,
  type: z.literal('faq'),
  variant: z.enum(['accordion', 'columns']).default('accordion'),
  title: localized(80),
  items: z
    .array(z.object({ id, question: localized(160), answer: localized(1000) }))
    .max(15)
    .default([]),
});
export const gallerySectionSchema = z.object({
  ...base,
  type: z.literal('gallery'),
  variant: z.enum(['grid', 'carousel', 'mosaic']).default('grid'),
  title: localized(80),
  columns: z.number().int().min(2).max(4).default(3),
  items: z
    .array(z.object({ id, imageId: image, caption: localized(80), link }))
    .max(12)
    .default([]),
});
export const logosSectionSchema = z.object({
  ...base,
  type: z.literal('logos'),
  variant: z.enum(['row', 'grid']).default('row'),
  title: localized(80),
  grayscale: z.boolean().default(true),
  items: z
    .array(z.object({ id, imageId: image, alt: localized(60), link }))
    .max(16)
    .default([]),
});
/** Two to four promotion tiles with pictures; `mosaic` makes the first one big. */
export const collageSectionSchema = z.object({
  ...base,
  type: z.literal('collage'),
  variant: z.enum(['mosaic', 'even']).default('mosaic'),
  tiles: z
    .array(
      z.object({
        id,
        imageId: image,
        title: localized(60),
        subtitle: localized(120),
        button: localized(30),
        link,
      }),
    )
    .max(4)
    .default([]),
});
/** A call to action with up to two buttons. */
export const ctaSectionSchema = z.object({
  ...base,
  type: z.literal('cta'),
  variant: z.enum(['brand', 'soft', 'outline', 'image']).default('brand'),
  imageId: image,
  title: localized(80),
  text: localized(240),
  button: localized(30),
  link,
  button2: localized(30),
  link2: link,
  align: z.enum(['start', 'center']).default('center'),
});
/** Breathing room between sections, with an optional line. */
export const spacerSectionSchema = z.object({
  ...base,
  type: z.literal('spacer'),
  size: z.enum(['small', 'medium', 'large']).default('medium'),
  line: z.boolean().default(false),
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
  countdownSectionSchema,
  testimonialsSectionSchema,
  faqSectionSchema,
  gallerySectionSchema,
  logosSectionSchema,
  collageSectionSchema,
  ctaSectionSchema,
  spacerSectionSchema,
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
// ---------------------------------------------------------------------------- footer
/** Footer arrangements (ADR-0128 amendment 2); each one also works on phones. */
export const FOOTER_LAYOUTS = [
  'columns',
  'split',
  'stacked',
  'centered',
  'cards',
  'simple',
  'minimal',
] as const;
export type FooterLayout = (typeof FOOTER_LAYOUTS)[number];
export const FOOTER_BLOCK_TYPES = [
  'about',
  'links',
  'categories',
  'contact',
  'hours',
  'branches',
  'social',
  'payments',
  'text',
] as const;
export type FooterBlockType = (typeof FOOTER_BLOCK_TYPES)[number];

const footerLinkSchema = z.object({ id, label: localized(30), link: designLinkSchema });
export type FooterLink = z.infer<typeof footerLinkSchema>;

const footerBlockSchema = z.object({
  id,
  type: z.enum(FOOTER_BLOCK_TYPES),
  title: localized(40),
  text: localized(400),
  links: z.array(footerLinkSchema).max(10).default([]),
});
export type FooterBlock = z.infer<typeof footerBlockSchema>;

const footerBadgeSchema = z.object({
  id,
  icon: z.string().trim().max(8).default(''),
  title: localized(40),
  text: localized(80),
});
export type FooterBadge = z.infer<typeof footerBadgeSchema>;

/**
 * The first designs had one `style` (simple / columns / centred / dark); it maps onto the layout
 * and the colour, and those footers keep their bottom line as it was (no back-to-top button,
 * no copyright in the simple one).
 */
function footerCompat(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const old = input as Record<string, unknown> & { style?: unknown };
  if (old.layout !== undefined || typeof old.style !== 'string') return input;
  const { style, ...rest } = old;
  const simple = style === 'simple';
  return {
    layout: style === 'dark' ? 'columns' : style,
    background: style === 'dark' ? 'dark' : 'light',
    topEdge: simple ? 'none' : 'line',
    mobileCollapse: false,
    bottom: { showCopyright: !simple, showBackToTop: false },
    ...rest,
  };
}

const footerSchema = z.preprocess(
  footerCompat,
  z.object({
    layout: z.enum(FOOTER_LAYOUTS).default('columns'),
    background: z.enum(['light', 'tinted', 'brand', 'dark']).default('light'),
    /** The edge between the page and the footer. */
    topEdge: z.enum(['none', 'line', 'wave', 'curve']).default('line'),
    width: z.enum(['contained', 'full']).default('contained'),
    spacing: z.enum(['compact', 'regular', 'roomy']).default('regular'),
    /** Columns of blocks on large screens; auto = one per block, at most four. */
    columns: z.enum(['auto', '2', '3', '4']).default('auto'),
    /** The store's logo, name and words (split, stacked, centred and cards layouts). */
    brand: z
      .object({
        showLogo: z.boolean().default(true),
        showName: z.boolean().default(true),
        showTagline: z.boolean().default(true),
        /** Replaces the tagline when set. */
        text: localized(300),
      })
      .prefault({}),
    /** A call-to-action band at the top of the footer. */
    cta: z
      .object({
        enabled: z.boolean().default(false),
        title: localized(80),
        text: localized(200),
        button: localized(30),
        link: designLinkSchema.nullable().default(null),
      })
      .prefault({}),
    /** Reassurance strip: emoji + short words (fast delivery, secure payment…). */
    badges: z.array(footerBadgeSchema).max(4).default([]),
    socialStyle: z.enum(['icons', 'filled', 'labels']).default('icons'),
    blocks: z.array(footerBlockSchema).max(6).default([]),
    bottom: z
      .object({
        showCopyright: z.boolean().default(true),
        /** Replaces "© year store name" when set. */
        copyright: localized(120),
        /** Policies and other small links (returns, privacy, terms…). */
        links: z.array(footerLinkSchema).max(6).default([]),
        showPayments: z.boolean().default(false),
        showLanguage: z.boolean().default(false),
        showBackToTop: z.boolean().default(true),
      })
      .prefault({}),
    showPoweredBy: z.boolean().default(true),
    /** On phones the titled blocks fold into tappable rows. */
    mobileCollapse: z.boolean().default(true),
  }),
);
export type FooterDesign = z.output<typeof footerSchema>;

// ---------------------------------------------------------------------- product page
/**
 * How the page of one product is drawn (ADR-0128 amendment 4). Each arrangement also works
 * on phones, where the pictures always come first.
 */
export const PRODUCT_LAYOUTS = [
  'classic',
  'wide',
  'reverse',
  'stacked',
  'scroll',
  'compact',
] as const;
export type ProductLayout = (typeof PRODUCT_LAYOUTS)[number];

const productHighlightSchema = z.object({
  id,
  icon: z.string().trim().max(8).default(''),
  title: localized(40),
  text: localized(80),
});
export type ProductHighlight = z.infer<typeof productHighlightSchema>;

/** Store-wide words shown with every product's description (delivery, returns, care…). */
const productInfoBlockSchema = z.object({ id, title: localized(40), text: localized(1000) });
export type ProductInfoBlock = z.infer<typeof productInfoBlockSchema>;

export const productPageSchema = z.object({
  layout: z.enum(PRODUCT_LAYOUTS).default('classic'),
  gallery: z
    .object({
      /** Where the small pictures go; `side` falls back to `below` on phones. */
      thumbs: z.enum(['below', 'side', 'dots', 'none']).default('below'),
      ratio: z.enum(['square', 'portrait', 'landscape']).default('square'),
      fit: z.enum(['cover', 'contain']).default('cover'),
      /** Tap a picture to see it full screen. */
      zoom: z.boolean().default(true),
    })
    .prefault({}),
  info: z
    .object({
      /** Home › category › product, above the name. */
      breadcrumb: z.boolean().default(true),
      /** The product's category as a chip above the name. */
      category: z.boolean().default(false),
      sku: z.boolean().default(false),
      share: z.boolean().default(true),
      /** "In stock" / "Sold out" beside the price. */
      stock: z.boolean().default(true),
      /** "Only N left" when fewer can be ordered; 0 = never. */
      lowStockAt: z.number().int().min(0).max(10).default(0),
      titleSize: z.enum(['regular', 'large']).default('regular'),
      priceSize: z.enum(['regular', 'large']).default('large'),
      align: z.enum(['start', 'center']).default('start'),
    })
    .prefault({}),
  buy: z
    .object({
      /** How a product's options are chosen. */
      options: z.enum(['buttons', 'dropdown']).default('buttons'),
      quantity: z.enum(['stepper', 'dropdown', 'hidden']).default('stepper'),
      /** Replaces "Add to cart" when set. */
      addLabel: localized(30),
      /** A second button that adds the product and opens the cart. */
      buyNow: z.boolean().default(false),
      /** On phones the add button stays at the bottom of the screen. */
      stickyBar: z.boolean().default(true),
      /** "Ask on WhatsApp" with the product's name and link (needs the store's WhatsApp number). */
      whatsapp: z.boolean().default(false),
    })
    .prefault({}),
  /** Reassurance under the buttons: emoji + short words. */
  highlights: z.array(productHighlightSchema).max(4).default([]),
  description: z
    .object({
      style: z.enum(['plain', 'tabs', 'accordion']).default('plain'),
      blocks: z.array(productInfoBlockSchema).max(4).default([]),
    })
    .prefault({}),
  related: z
    .object({
      enabled: z.boolean().default(true),
      title: localized(80),
      /** Same category first; the featured, then any, fill the rest. */
      source: z.enum(['category', 'featured', 'all']).default('category'),
      limit: z.number().int().min(2).max(12).default(4),
      variant: z.enum(['grid', 'carousel']).default('carousel'),
      showAdd: z.boolean().default(false),
    })
    .prefault({}),
  /** The products this shopper opened before, kept on the shopper's device only. */
  recent: z.object({ enabled: z.boolean().default(false), title: localized(80) }).prefault({}),
});
export type ProductPageDesign = z.output<typeof productPageSchema>;

// ------------------------------------------------------------- cart and checkout pages
/**
 * The cart and checkout pages (ADR-0128 amendment 5). Only how they look and what they ask is
 * designed: prices, fees, promotions and stock always come from the server.
 */
export const cartPageSchema = z.object({
  /** `split` = the summary beside the lines on large screens; `stacked` = under them. */
  layout: z.enum(['split', 'stacked']).default('split'),
  /** Product pictures beside the lines. */
  images: z.boolean().default(true),
  /** A short note above the lines (delivery times, a gift note…). */
  message: localized(200),
  /** How far the cart is from the store's minimum order. */
  minimumBar: z.boolean().default(true),
  /** Replaces "Checkout" when set. */
  checkoutLabel: localized(30),
  /** On phones the total and the checkout button stay at the bottom of the screen. */
  stickyCheckout: z.boolean().default(true),
  continueShopping: z.boolean().default(true),
  /** Reassurance under the checkout button. */
  highlights: z.array(productHighlightSchema).max(4).default([]),
  /** Products offered with the cart (never one already in it, never a sold-out one). */
  upsell: z
    .object({
      enabled: z.boolean().default(true),
      title: localized(80),
      source: z.enum(['featured', 'all']).default('featured'),
      limit: z.number().int().min(2).max(8).default(4),
      variant: z.enum(['grid', 'carousel']).default('carousel'),
    })
    .prefault({}),
  /** The empty cart: own words and products to start from. */
  empty: z
    .object({
      title: localized(80),
      text: localized(200),
      showProducts: z.boolean().default(true),
    })
    .prefault({}),
});
export type CartPageDesign = z.output<typeof cartPageSchema>;

export const checkoutPageSchema = z.object({
  /** `split` = the order summary beside the form on large screens; `stacked` = one column. */
  layout: z.enum(['split', 'stacked']).default('split'),
  /** Numbered steps: details, receiving, payment. */
  steps: z.boolean().default(true),
  /** Pickup / delivery and the payment methods as large cards or a plain list. */
  choices: z.enum(['cards', 'list']).default('cards'),
  message: localized(200),
  email: z.enum(['optional', 'required', 'hidden']).default('optional'),
  note: z
    .object({
      enabled: z.boolean().default(true),
      /** Replaces "Note" when set ("Notes for the kitchen"…). */
      label: localized(60),
    })
    .prefault({}),
  /** The promotion code box; automatic offers apply either way. */
  promo: z.boolean().default(true),
  /** Product pictures in the order summary. */
  images: z.boolean().default(true),
  /** "I agree to the terms" before ordering, with a link to them. */
  terms: z
    .object({
      enabled: z.boolean().default(false),
      text: localized(200),
      link: designLinkSchema.nullable().default(null),
    })
    .prefault({}),
  /** Replaces "Place order and pay" when set. */
  submitLabel: localized(30),
  highlights: z.array(productHighlightSchema).max(4).default([]),
});
export type CheckoutPageDesign = z.output<typeof checkoutPageSchema>;

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
    footer: footerSchema.prefault({}),
    productPage: productPageSchema.prefault({}),
    cartPage: cartPageSchema.prefault({}),
    checkoutPage: checkoutPageSchema.prefault({}),
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
      /** Sections under the details of every product (reviews, questions, banners…). */
      product: z.array(sectionSchema).max(15).default([]),
      /** Sections under the cart (reassurance, questions, an offer…). */
      cart: z.array(sectionSchema).max(10).default([]),
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
    // The product page shows one product: lists with their own search do not belong there.
    for (const page of ['product', 'cart'] as const)
      if (d.pages[page].some((s) => s.type === 'catalog' || s.type === 'menu'))
        ctx.addIssue({
          code: 'custom',
          path: ['pages', page],
          message: `The ${page} page cannot hold a catalog or a menu.`,
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
      if (s.type === 'banner' || s.type === 'image' || s.type === 'cta') ids.push(s.imageId);
      if (s.type === 'gallery' || s.type === 'logos') ids.push(...s.items.map((x) => x.imageId));
      if (s.type === 'collage') ids.push(...s.tiles.map((x) => x.imageId));
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
    footer: {
      layout: 'simple',
      topEdge: 'none',
      mobileCollapse: false,
      blocks: [{ id: 'contact', type: 'contact' }],
      bottom: { showCopyright: false, showBackToTop: false },
      showPoweredBy: false,
    },
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

/** One-click footers offered in the console (ADR-0128 amendment 2). */
export const FOOTER_PRESETS = ['shop', 'restaurant', 'brand', 'minimal'] as const;
export type FooterPreset = (typeof FOOTER_PRESETS)[number];

/** Reassurance badges suggested to every store (the merchant edits or removes them). */
export function suggestedBadges(template: DesignTemplate = 'retail'): FooterBadge[] {
  const badge = (id: string, icon: string, title: Localized, text: Localized): FooterBadge => ({
    id,
    icon,
    title,
    text,
  });
  return template === 'restaurant'
    ? [
        badge(
          'badge-fresh',
          '🍳',
          l('Made fresh', 'يُحضّر طازجًا'),
          l('Cooked when you order', 'نجهّزه عند طلبك'),
        ),
        badge(
          'badge-fast',
          '🛵',
          l('Fast delivery', 'توصيل سريع'),
          l('Hot to your door', 'يصلك ساخنًا'),
        ),
        badge(
          'badge-pay',
          '💳',
          l('Pay your way', 'ادفع بطريقتك'),
          l('Card, link or on receipt', 'بطاقة أو رابط أو عند الاستلام'),
        ),
      ]
    : [
        badge(
          'badge-delivery',
          '🚚',
          l('Fast delivery', 'توصيل سريع'),
          l('To your door', 'لين باب البيت'),
        ),
        badge(
          'badge-secure',
          '🔒',
          l('Secure payment', 'دفع آمن'),
          l('Your data is protected', 'بياناتك محمية'),
        ),
        badge(
          'badge-support',
          '💬',
          l('We are here to help', 'جاهزين نساعدك'),
          l('Message us any time', 'راسلنا في أي وقت'),
        ),
      ];
}

export function footerPreset(preset: FooterPreset): FooterDesign {
  const block = (id: string, type: FooterBlockType, title: Localized) => ({ id, type, title });
  const quickLinks = {
    ...block('links', 'links', l('Quick links', 'روابط سريعة')),
    links: [
      {
        id: 'link-products',
        label: l('All products', 'كل المنتجات'),
        link: { kind: 'page', page: 'products' },
      },
      {
        id: 'link-categories',
        label: l('Categories', 'التصنيفات'),
        link: { kind: 'page', page: 'categories' },
      },
      {
        id: 'link-account',
        label: l('My account', 'حسابي'),
        link: { kind: 'page', page: 'account' },
      },
    ],
  };
  const input = {
    shop: {
      layout: 'split',
      background: 'tinted',
      topEdge: 'line',
      badges: suggestedBadges('retail'),
      blocks: [
        block('categories', 'categories', l('Shop', 'تسوّق')),
        quickLinks,
        block('contact', 'contact', l('Contact us', 'تواصل معنا')),
      ],
      bottom: { showPayments: true },
    },
    restaurant: {
      layout: 'stacked',
      background: 'dark',
      topEdge: 'curve',
      cta: {
        enabled: true,
        title: l('Hungry?', 'جوعان؟'),
        text: l('Order now for pickup or delivery.', 'اطلب الحين استلام أو توصيل.'),
        button: l('Order now', 'اطلب الآن'),
        link: { kind: 'page', page: 'products' },
      },
      blocks: [
        block('hours', 'hours', l('Opening hours', 'أوقات العمل')),
        block('branches', 'branches', l('Our branches', 'فروعنا')),
        block('contact', 'contact', l('Contact us', 'تواصل معنا')),
      ],
      bottom: { showPayments: true },
    },
    brand: {
      layout: 'centered',
      background: 'brand',
      topEdge: 'wave',
      spacing: 'roomy',
      socialStyle: 'filled',
      blocks: [],
      bottom: { links: [] },
    },
    minimal: {
      layout: 'minimal',
      background: 'light',
      topEdge: 'line',
      spacing: 'compact',
      blocks: [],
    },
  }[preset];
  return footerSchema.parse(input);
}

/** One-click product pages offered in the console (ADR-0128 amendment 4). */
export const PRODUCT_PAGE_PRESETS = ['classic', 'fashion', 'food', 'tech', 'minimal'] as const;
export type ProductPagePreset = (typeof PRODUCT_PAGE_PRESETS)[number];

/** Reassurance under the buttons suggested to a product page (the merchant edits them). */
export function suggestedHighlights(kind: 'shop' | 'food' | 'tech' = 'shop'): ProductHighlight[] {
  const h = (id: string, icon: string, title: Localized, text: Localized): ProductHighlight => ({
    id,
    icon,
    title,
    text,
  });
  if (kind === 'food')
    return [
      h(
        'fresh',
        '🔥',
        l('Made fresh', 'يُحضّر طازج'),
        l('Prepared when you order', 'نجهزه وقت طلبك'),
      ),
      h(
        'delivery',
        '🛵',
        l('Pickup or delivery', 'استلام أو توصيل'),
        l('Your choice', 'على راحتك'),
      ),
    ];
  if (kind === 'tech')
    return [
      h(
        'genuine',
        '✅',
        l('Genuine products', 'منتجات أصلية'),
        l('From trusted sources', 'من مصادر موثوقة'),
      ),
      h('warranty', '🛡️', l('Warranty', 'ضمان'), l('Ask us about the terms', 'اسألنا عن الشروط')),
      h('delivery', '🚚', l('Fast delivery', 'توصيل سريع'), l('To your door', 'لين باب بيتك')),
    ];
  return [
    h('delivery', '🚚', l('Fast delivery', 'توصيل سريع'), l('To your door', 'لين باب بيتك')),
    h('secure', '🔒', l('Secure payment', 'دفع آمن'), l('Pay your way', 'ادفع بطريقتك')),
    h(
      'help',
      '💬',
      l('Here to help', 'جاهزين نساعدك'),
      l('Message us any time', 'راسلنا في أي وقت'),
    ),
  ];
}

const deliveryBlock = {
  id: 'delivery',
  title: l('Delivery and returns', 'التوصيل والإرجاع'),
  text: l(
    'Orders are prepared quickly and delivered to your door. Message us if anything is not right.',
    'نجهز الطلب بسرعة ونوصله لين بابك. إذا فيه أي ملاحظة راسلنا ونحلها.',
  ),
};

export function productPagePreset(preset: ProductPagePreset): ProductPageDesign {
  const input = {
    classic: {
      layout: 'classic',
      highlights: suggestedHighlights('shop'),
      related: { title: l('You may also like', 'قد يعجبك أيضًا') },
    },
    fashion: {
      layout: 'scroll',
      gallery: { thumbs: 'none', ratio: 'portrait' },
      info: { category: true, lowStockAt: 3 },
      buy: { options: 'buttons', buyNow: true },
      highlights: suggestedHighlights('shop'),
      description: { style: 'accordion', blocks: [deliveryBlock] },
      related: { title: l('Complete the look', 'كمّل اللوك'), variant: 'grid' },
      recent: { enabled: true, title: l('Recently viewed', 'شاهدتها مؤخرًا') },
    },
    food: {
      layout: 'compact',
      gallery: { thumbs: 'dots', ratio: 'landscape' },
      info: { breadcrumb: false, stock: false, titleSize: 'large' },
      buy: { quantity: 'stepper', addLabel: l('Add to order', 'أضف للطلب') },
      highlights: suggestedHighlights('food'),
      related: { title: l('Goes well with', 'يتناسب معه'), showAdd: true },
    },
    tech: {
      layout: 'wide',
      gallery: { thumbs: 'side', fit: 'contain' },
      info: { sku: true, category: true, lowStockAt: 5 },
      buy: { buyNow: true, whatsapp: true },
      highlights: suggestedHighlights('tech'),
      description: {
        style: 'tabs',
        blocks: [
          deliveryBlock,
          {
            id: 'warranty',
            title: l('Warranty', 'الضمان'),
            text: l(
              'Every product comes with its maker’s warranty. Keep your receipt.',
              'كل منتج عليه ضمان الشركة المصنعة. احتفظ بالفاتورة.',
            ),
          },
        ],
      },
      related: { title: l('Similar products', 'منتجات مشابهة'), variant: 'grid' },
      recent: { enabled: true, title: l('Recently viewed', 'شاهدتها مؤخرًا') },
    },
    minimal: {
      layout: 'stacked',
      gallery: { thumbs: 'dots' },
      info: { breadcrumb: false, share: false, align: 'center' },
      buy: { stickyBar: false },
      related: { title: l('More to explore', 'اكتشف المزيد'), variant: 'grid' },
    },
  }[preset];
  return productPageSchema.parse(input);
}

/** One-click cart and checkout pages, set together (ADR-0128 amendment 5). */
export const CART_PRESETS = ['classic', 'express', 'food', 'minimal'] as const;
export type CartPreset = (typeof CART_PRESETS)[number];

export function cartPreset(preset: CartPreset): {
  cartPage: CartPageDesign;
  checkoutPage: CheckoutPageDesign;
} {
  const secure = [
    {
      id: 'secure',
      icon: '🔒',
      title: l('Secure checkout', 'دفع آمن'),
      text: l('Your details stay private', 'بياناتك محمية'),
    },
    {
      id: 'help',
      icon: '💬',
      title: l('Here to help', 'جاهزين نساعدك'),
      text: l('Message us any time', 'راسلنا في أي وقت'),
    },
  ];
  const input = {
    classic: {
      cartPage: {
        highlights: suggestedHighlights('shop'),
        upsell: { title: l('You may also like', 'قد يعجبك أيضًا') },
      },
      checkoutPage: { highlights: secure },
    },
    express: {
      cartPage: {
        layout: 'stacked',
        upsell: { enabled: false },
        checkoutLabel: l('Checkout now', 'ادفع الآن'),
      },
      checkoutPage: { steps: false, email: 'hidden', note: { enabled: false } },
    },
    food: {
      cartPage: {
        highlights: suggestedHighlights('food'),
        upsell: { title: l('Complete your order', 'كمّل طلبك'), source: 'all' },
        checkoutLabel: l('Continue', 'متابعة'),
      },
      checkoutPage: {
        email: 'hidden',
        note: { label: l('Notes for the kitchen', 'ملاحظات للمطبخ') },
        submitLabel: l('Send my order', 'أرسل طلبي'),
      },
    },
    minimal: {
      cartPage: {
        images: false,
        minimumBar: false,
        upsell: { enabled: false },
        empty: { showProducts: false },
      },
      checkoutPage: { steps: false, choices: 'list', images: false },
    },
  }[preset];
  return {
    cartPage: cartPageSchema.parse(input.cartPage),
    checkoutPage: checkoutPageSchema.parse(input.checkoutPage),
  };
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
      footer: footerPreset('restaurant'),
      productPage: productPagePreset('food'),
      ...cartPreset('food'),
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
    footer: footerPreset('shop'),
    productPage: productPagePreset('classic'),
    ...cartPreset('classic'),
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

// ------------------------------------------------------------- ready-made sections
/**
 * Sections filled in for a purpose (ADR-0128 amendment 3). Their words are neutral starting
 * points in both languages; reviews, answers and logos stay empty until the merchant adds real
 * ones, and an offer has no end until the merchant sets it (until then it does not show).
 */
export const READY_SECTIONS = [
  'heroSlider',
  'offerCountdown',
  'collage',
  'newArrivals',
  'featured',
  'shopByCategory',
  'trustStrip',
  'reviews',
  'faq',
  'contactCta',
  'brands',
  'story',
] as const;
export type ReadySection = (typeof READY_SECTIONS)[number];
type SectionInput = z.input<typeof sectionSchema>;
/** A section's input without its id (spread over every section type). */
type SectionDraft = SectionInput extends infer T
  ? T extends unknown
    ? Omit<T, 'id'>
    : never
  : never;

const products = { kind: 'page', page: 'products' } as const;
const categoriesPage = { kind: 'page', page: 'categories' } as const;

function readyInput(name: ReadySection): SectionDraft {
  switch (name) {
    case 'heroSlider':
      return {
        type: 'slider',
        variant: 'contained',
        height: 'large',
        slides: [
          {
            id: 'slide-1',
            title: l('New season', 'الموسم الجديد'),
            subtitle: l('Discover what is new in the store', 'اكتشف الجديد في متجرنا'),
            button: l('Shop now', 'تسوّق الآن'),
            link: products,
          },
          {
            id: 'slide-2',
            title: l('Shop by category', 'تسوّق حسب التصنيف'),
            subtitle: l('Find what you need faster', 'وصّل لطلبك أسرع'),
            button: l('Browse', 'تصفّح'),
            link: categoriesPage,
          },
        ],
      };
    case 'offerCountdown':
      return {
        type: 'countdown',
        title: l('Limited-time offer', 'عرض لفترة محدودة'),
        subtitle: l('It ends soon, do not miss it.', 'ينتهي قريبًا، لا يفوتك.'),
        button: l('Shop the offer', 'تسوّق العرض'),
        link: products,
      };
    case 'collage':
      return {
        type: 'collage',
        tiles: [
          {
            id: 'tile-1',
            title: l('New in', 'وصل حديثًا'),
            button: l('Shop', 'تسوّق'),
            link: products,
          },
          { id: 'tile-2', title: l('Our picks', 'اختياراتنا'), link: products },
          { id: 'tile-3', title: l('Gifts', 'هدايا'), link: categoriesPage },
        ],
      };
    case 'newArrivals':
      return {
        type: 'products',
        variant: 'carousel',
        source: 'all',
        limit: 12,
        title: l('New arrivals', 'وصل حديثًا'),
      };
    case 'featured':
      return {
        type: 'products',
        variant: 'grid',
        source: 'featured',
        showAdd: true,
        title: l('Picked for you', 'مختارات لك'),
      };
    case 'shopByCategory':
      return {
        type: 'categories',
        variant: 'circles',
        title: l('Shop by category', 'تسوّق حسب التصنيف'),
      };
    case 'trustStrip':
      return {
        type: 'features',
        variant: 'row',
        items: [
          {
            id: 'f1',
            icon: '🛍️',
            title: l('Order online', 'اطلب أونلاين'),
            text: l('Pickup or delivery', 'استلام أو توصيل'),
          },
          { id: 'f2', icon: '💳', title: l('Pay your way', 'ادفع بطريقتك') },
          { id: 'f3', icon: '💬', title: l('We are here to help', 'جاهزين نساعدك') },
        ],
      };
    case 'reviews':
      return { type: 'testimonials', title: l('What our customers say', 'آراء عملائنا') };
    case 'faq':
      return {
        type: 'faq',
        title: l('Questions and answers', 'أسئلة وأجوبة'),
        items: [
          { id: 'q1', question: l('How long does delivery take?', 'كم يستغرق التوصيل؟') },
          {
            id: 'q2',
            question: l('Which payment methods do you accept?', 'ما طرق الدفع المتاحة؟'),
          },
          { id: 'q3', question: l('Can I pick up my order?', 'هل أقدر أستلم طلبي بنفسي؟') },
          { id: 'q4', question: l('How do I return an item?', 'كيف أرجّع منتجًا؟') },
        ],
      };
    case 'contactCta':
      return {
        type: 'cta',
        variant: 'brand',
        title: l('Have a question?', 'عندك سؤال؟'),
        text: l('We are one message away.', 'راسلنا ونرد عليك.'),
        button: l('Message us', 'راسلنا'),
        button2: l('Shop now', 'تسوّق الآن'),
        link2: products,
      };
    case 'brands':
      return { type: 'logos', title: l('Brands we carry', 'الماركات المتوفرة') };
    case 'story':
      return { type: 'text', variant: 'card', align: 'center', title: l('Our story', 'قصتنا') };
  }
}

/** A ready-made section with its own id. */
export function readySection(name: ReadySection, sectionId: string): DesignSection {
  return sectionSchema.parse({ ...readyInput(name), id: sectionId });
}

/** Whole home pages for a kind of business, built from ready-made sections. */
export const HOME_LAYOUTS = [
  'fashion',
  'electronics',
  'grocery',
  'beauty',
  'restaurant',
  'cafe',
  'minimal',
] as const;
export type HomeLayout = (typeof HOME_LAYOUTS)[number];

export function homeLayout(layout: HomeLayout): DesignSection[] {
  const r = (name: ReadySection, extra: Record<string, unknown> = {}) =>
    sectionSchema.parse({ ...readyInput(name), ...extra, id: `${layout}-${name}` });
  const one = (sectionId: string, input: SectionDraft) =>
    sectionSchema.parse({ ...input, id: `${layout}-${sectionId}` });
  switch (layout) {
    case 'fashion':
      return [
        r('heroSlider', { variant: 'full' }),
        r('collage'),
        r('newArrivals'),
        r('shopByCategory', { variant: 'tiles' }),
        r('offerCountdown'),
        r('featured', { columns: 4 }),
        r('reviews'),
        r('trustStrip', { look: { background: 'soft' } }),
      ];
    case 'electronics':
      return [
        r('heroSlider'),
        r('trustStrip'),
        r('shopByCategory', { variant: 'chips' }),
        r('featured', { columns: 4 }),
        r('offerCountdown', { variant: 'card' }),
        r('brands'),
        r('newArrivals'),
        r('faq'),
      ];
    case 'grocery':
      return [
        one('hero', {
          type: 'banner',
          variant: 'color',
          imageSource: 'none',
          title: l('Your daily essentials', 'احتياجاتك اليومية'),
          subtitle: l(
            'Order in minutes, pick up or get it delivered.',
            'اطلب في دقائق، استلام أو توصيل.',
          ),
          button: l('Start shopping', 'ابدأ التسوق'),
          link: products,
        }),
        r('shopByCategory'),
        r('featured', { variant: 'carousel', showAdd: true }),
        r('collage', { variant: 'even' }),
        one('all', {
          type: 'products',
          source: 'all',
          limit: 12,
          showAdd: true,
          title: l('All products', 'كل المنتجات'),
        }),
        r('trustStrip'),
        r('faq'),
      ];
    case 'beauty':
      return [
        r('heroSlider', { variant: 'full', textAlign: 'center' }),
        r('shopByCategory'),
        r('featured', { columns: 3 }),
        r('story', { look: { background: 'tinted' } }),
        r('reviews', { variant: 'carousel' }),
        r('collage'),
        r('contactCta'),
      ];
    case 'restaurant':
      return [
        one('hero', {
          type: 'banner',
          variant: 'overlay',
          imageSource: 'store',
          align: 'center',
          height: 'large',
          title: l('Fresh from our kitchen', 'طازج من مطبخنا'),
          subtitle: l('Order for pickup or delivery', 'اطلب استلام أو توصيل'),
          button: l('Order now', 'اطلب الآن'),
          link: products,
        }),
        one('info', { type: 'info', variant: 'strip' }),
        r('featured', { variant: 'carousel', title: l('Most ordered', 'الأكثر طلبًا') }),
        one('menu', { type: 'menu', variant: 'list', title: l('Menu', 'المنيو') }),
        r('reviews'),
        r('contactCta', {
          title: l('Planning an event?', 'عندك مناسبة؟'),
          text: l('Message us for big orders.', 'راسلنا للطلبات الكبيرة.'),
        }),
      ];
    case 'cafe':
      return [
        one('hero', {
          type: 'banner',
          variant: 'split',
          imageSource: 'store',
          title: l('Your daily cup', 'كوبك اليومي'),
          subtitle: l('Order ahead and skip the line.', 'اطلب مسبقًا وتجنّب الانتظار.'),
          button: l('Order now', 'اطلب الآن'),
          link: products,
        }),
        one('info', { type: 'info', variant: 'cards', showBranches: true }),
        r('collage', { variant: 'even' }),
        one('menu', { type: 'menu', variant: 'compact', title: l('Menu', 'المنيو') }),
        one('gallery', { type: 'gallery', variant: 'mosaic', title: l('Moments', 'لحظات') }),
        r('faq'),
      ];
    case 'minimal':
      return [
        one('hero', {
          type: 'banner',
          variant: 'color',
          imageSource: 'none',
          align: 'center',
          title: l('Welcome', 'أهلًا بك'),
          button: l('Shop now', 'تسوّق الآن'),
          link: products,
        }),
        one('all', {
          type: 'products',
          source: 'all',
          limit: 12,
          columns: 3,
          title: l('Products', 'المنتجات'),
        }),
        r('story'),
      ];
  }
}

// -------------------------------------------------- section styles and categories page
/**
 * Ready styles per section type (ADR-0128 amendment 6): one tap sets how a section looks —
 * its variant, arrangement options and part of its frame — and never touches its content
 * (words, pictures, items, links, chosen products or categories). A style without its own
 * background or heading alignment resets them, so styles do not pile up.
 */
type StylePatch = Record<string, unknown> & {
  look?: { background?: string; titleAlign?: string };
};
export const SECTION_STYLES = {
  slider: {
    classic: { variant: 'contained', height: 'medium', overlay: 'dark', textAlign: 'start' },
    bold: { variant: 'full', height: 'large', overlay: 'dark', textAlign: 'center' },
    cards: { variant: 'cards', height: 'small', overlay: 'light', textAlign: 'start' },
    soft: {
      variant: 'contained',
      height: 'small',
      overlay: 'light',
      textAlign: 'center',
      look: { background: 'soft' },
    },
  },
  banner: {
    hero: { variant: 'overlay', height: 'large', overlay: 'dark', align: 'center' },
    classic: { variant: 'overlay', height: 'medium', overlay: 'dark', align: 'start' },
    split: { variant: 'split', height: 'medium', align: 'start' },
    color: { variant: 'color', height: 'small', align: 'center' },
  },
  products: {
    grid: { variant: 'grid', columns: 4, showAdd: false },
    swipe: { variant: 'carousel', showAdd: true },
    list: { variant: 'list', showAdd: true },
    spotlight: {
      variant: 'grid',
      columns: 3,
      showAdd: true,
      look: { background: 'tinted', titleAlign: 'center' },
    },
  },
  categories: {
    circles: { variant: 'circles', showCount: false },
    tiles: { variant: 'tiles', columns: 4, aspect: 'landscape', showCount: false },
    cards: { variant: 'cards', columns: 4, aspect: 'square', showCount: true },
    banners: { variant: 'banners', showCount: true },
    chips: { variant: 'chips', showCount: false },
    list: { variant: 'list', showCount: true },
  },
  image: {
    wide: { variant: 'contained', aspect: 'wide' },
    full: { variant: 'full', aspect: 'wide' },
    square: { variant: 'contained', aspect: 'square' },
  },
  video: {
    classic: { variant: 'contained', aspect: 'landscape' },
    full: { variant: 'full', aspect: 'landscape' },
    reel: { variant: 'contained', aspect: 'portrait' },
  },
  text: {
    plain: { variant: 'plain', align: 'start' },
    centered: { variant: 'plain', align: 'center', look: { titleAlign: 'center' } },
    card: { variant: 'card', align: 'start' },
    highlight: { variant: 'highlight', align: 'center' },
  },
  features: {
    row: { variant: 'row' },
    grid: { variant: 'grid' },
    cards: { variant: 'cards', look: { background: 'soft', titleAlign: 'center' } },
  },
  menu: {
    list: { variant: 'list', showImages: true, showDescriptions: true },
    grid: { variant: 'grid', showImages: true, showDescriptions: false },
    compact: { variant: 'compact', showImages: false, showDescriptions: false },
  },
  info: { strip: { variant: 'strip' }, cards: { variant: 'cards' } },
  catalog: {
    grid: { variant: 'grid', columns: 4 },
    roomy: { variant: 'grid', columns: 3 },
    list: { variant: 'list' },
  },
  countdown: {
    banner: { variant: 'banner' },
    card: { variant: 'card' },
    minimal: { variant: 'minimal' },
  },
  testimonials: {
    cards: { variant: 'cards' },
    swipe: { variant: 'carousel' },
    quote: { variant: 'quote', look: { background: 'soft', titleAlign: 'center' } },
  },
  faq: {
    accordion: { variant: 'accordion' },
    columns: { variant: 'columns' },
    centered: { variant: 'accordion', look: { background: 'soft', titleAlign: 'center' } },
  },
  gallery: {
    grid: { variant: 'grid', columns: 3 },
    mosaic: { variant: 'mosaic' },
    swipe: { variant: 'carousel' },
  },
  logos: { row: { variant: 'row', grayscale: true }, grid: { variant: 'grid', grayscale: false } },
  collage: { mosaic: { variant: 'mosaic' }, even: { variant: 'even' } },
  cta: {
    brand: { variant: 'brand', align: 'center' },
    soft: { variant: 'soft', align: 'center' },
    outline: { variant: 'outline', align: 'start' },
    picture: { variant: 'image', align: 'center' },
  },
  spacer: {
    small: { size: 'small', line: false },
    line: { size: 'medium', line: true },
    large: { size: 'large', line: false },
  },
} as const satisfies Record<SectionType, Record<string, StylePatch>>;

/** The ready styles of a section type, in the order the console offers them. */
export function sectionStyles(type: SectionType): string[] {
  return Object.keys(SECTION_STYLES[type]);
}

function stylePatch(type: SectionType, style: string): StylePatch | null {
  return (SECTION_STYLES[type] as Record<string, StylePatch>)[style] ?? null;
}

/** The section with a ready style applied; its content is kept. Unknown styles change nothing. */
export function applySectionStyle(section: DesignSection, style: string): DesignSection {
  const patch = stylePatch(section.type, style);
  if (!patch) return section;
  const { look, ...rest } = patch;
  return sectionSchema.parse({
    ...section,
    ...rest,
    look: { ...section.look, background: 'none', titleAlign: 'start', ...look },
  });
}

/** The ready style a section matches now, if any. */
export function currentSectionStyle(section: DesignSection): string | null {
  const record = section as unknown as Record<string, unknown>;
  for (const style of sectionStyles(section.type)) {
    const { look, ...rest } = stylePatch(section.type, style)!;
    const wanted = { background: 'none', titleAlign: 'start', ...look };
    if (
      Object.entries(rest).every(([k, v]) => record[k] === v) &&
      section.look.background === wanted.background &&
      section.look.titleAlign === wanted.titleAlign
    )
      return style;
  }
  return null;
}

/** Whole categories pages offered in the console (ADR-0128 amendment 6). */
export const CATEGORY_LAYOUTS = ['tiles', 'circles', 'cards', 'list', 'showcase'] as const;
export type CategoryLayout = (typeof CATEGORY_LAYOUTS)[number];

export function categoryLayout(layout: CategoryLayout): DesignSection[] {
  const r = (name: ReadySection, extra: Record<string, unknown> = {}) =>
    sectionSchema.parse({ ...readyInput(name), ...extra, id: `cat-${layout}-${name}` });
  const one = (sectionId: string, input: SectionDraft) =>
    sectionSchema.parse({ ...input, id: `cat-${layout}-${sectionId}` });
  const categories = (extra: Record<string, unknown>) =>
    one('categories', { type: 'categories', title: l('Categories', 'التصنيفات'), ...extra });
  switch (layout) {
    case 'tiles':
      return [categories({ variant: 'tiles', columns: 3 }), r('featured', { columns: 4 })];
    case 'circles':
      return [
        categories({ variant: 'circles', topOnly: true }),
        r('newArrivals'),
        r('featured', { variant: 'grid', columns: 4 }),
      ];
    case 'cards':
      return [
        categories({
          variant: 'cards',
          columns: 4,
          aspect: 'square',
          showCount: true,
          showSub: true,
        }),
        r('trustStrip', { look: { background: 'soft' } }),
      ];
    case 'list':
      return [
        categories({ variant: 'list', showCount: true, showSub: true, topOnly: true }),
        r('contactCta'),
      ];
    case 'showcase':
      return [
        r('collage'),
        categories({ variant: 'banners', showCount: true, topOnly: true }),
        r('featured'),
      ];
  }
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
