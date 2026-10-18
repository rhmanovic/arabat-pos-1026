import { z } from 'zod';

/**
 * Link page ("link in bio", ADR-0116): one public page per merchant that lists its links
 * (Instagram, WhatsApp, the online store, …) for social-media profiles. Managed in /manager,
 * shown at `/store/links/<slug>`. See BUSINESS_RULES.md BR-198…BR-201.
 */
export const LINK_PAGE_STATUSES = ['draft', 'published'] as const;
export const LINK_BUTTON_STYLES = ['rounded', 'pill', 'square'] as const;
export const LINK_BACKGROUNDS = ['light', 'dark', 'brand', 'custom', 'gradient'] as const;
export const LINK_BUTTON_VARIANTS = ['fill', 'outline', 'soft', 'shadow'] as const;
/** Self-hosted Arabic + Latin typefaces (loaded only when chosen; CSP allows fonts from self). */
export const LINK_FONTS = [
  'default',
  'cairo',
  'tajawal',
  'almarai',
  'changa',
  'el-messiri',
  'amiri',
  'reem-kufi',
] as const;
export type LinkFont = (typeof LINK_FONTS)[number];
export const LINK_ANIMATIONS = ['none', 'fade-up', 'pop', 'slide'] as const;
export const LINK_ITEM_EFFECTS = ['none', 'pulse', 'shake', 'glow'] as const;
export const LINK_ITEM_KINDS = [
  'link',
  'website',
  'store',
  'instagram',
  'tiktok',
  'snapchat',
  'x',
  'facebook',
  'youtube',
  'whatsapp',
  'telegram',
  'email',
  'phone',
  'location',
] as const;
export type LinkItemKind = (typeof LINK_ITEM_KINDS)[number];
export const LINK_ITEM_STATUSES = ['active', 'hidden'] as const;
/** Most links a page can hold (BR-199). */
export const MAX_LINK_ITEMS = 50;
/** Largest profile picture accepted (bytes). */
export const MAX_LINK_AVATAR_BYTES = 2 * 1024 * 1024;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

/** Only web, e-mail and phone addresses: never `javascript:` or `data:` (BR-200). */
const LINK_URL = /^(https?:\/\/[^\s/?#]+\S*|mailto:[^\s@]+@\S+|tel:\+?[\d\s()-]{3,})$/i;
export function isAllowedLinkUrl(value: string): boolean {
  return LINK_URL.test(value);
}
export const linkUrlSchema = z.string().trim().min(1).max(2000).refine(isAllowedLinkUrl, {
  error: 'Use a full address starting with https://, mailto: or tel:.',
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const optionalHex = hex
  .nullish()
  .or(z.literal(''))
  .transform((v) => v || null);

/** An emoji shown on a button: pictographs only (no letters or digits), up to 16 code units. */
export const linkEmojiSchema = z
  .string()
  .trim()
  .max(16)
  .nullish()
  .transform((v) => (v == null || v === '' ? null : v))
  .refine(
    (v) =>
      v === null ||
      (/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(v) &&
        !/[\p{L}\p{N}]/u.test(v.replace(/[#*]/g, ''))),
    {
      error: 'Use an emoji only.',
    },
  );

/** Look of the page shared by the manager and public shapes (ADR-0116 amendment 2). */
const styleShape = {
  themeColor: z.string(),
  buttonStyle: z.enum(LINK_BUTTON_STYLES),
  buttonVariant: z.enum(LINK_BUTTON_VARIANTS),
  buttonTextColor: z.string().nullable(),
  background: z.enum(LINK_BACKGROUNDS),
  backgroundColor: z.string().nullable(),
  backgroundColor2: z.string().nullable(),
  textColor: z.string().nullable(),
  font: z.enum(LINK_FONTS),
  animation: z.enum(LINK_ANIMATIONS),
};
export type LinkPageStyle = z.infer<z.ZodObject<typeof styleShape>>;

// ---------------------------------------------------------------- manager
export const linkItemSchema = z.object({
  id: z.string(),
  kind: z.enum(LINK_ITEM_KINDS),
  labelAr: z.string().nullable(),
  labelEn: z.string().nullable(),
  emoji: z.string().nullable(),
  effect: z.enum(LINK_ITEM_EFFECTS),
  url: z.string(),
  status: z.enum(LINK_ITEM_STATUSES),
  sortOrder: z.number().int(),
  /** Visitors who opened this link from the public page. */
  clicks: z.number().int(),
  version: z.number().int(),
});
export type LinkItem = z.infer<typeof linkItemSchema>;

export const linkPageSchema = z.object({
  slug: z.string(),
  status: z.enum(LINK_PAGE_STATUSES),
  titleAr: z.string().nullable(),
  titleEn: z.string().nullable(),
  bioAr: z.string().nullable(),
  bioEn: z.string().nullable(),
  ...styleShape,
  avatarUrl: z.string().nullable(),
  /** The public address to put in a social-media profile. */
  url: z.string(),
  /** The online store's public address when it is open, to add as a link. */
  storeUrl: z.string().nullable(),
  items: z.array(linkItemSchema),
  version: z.number().int(),
});
export type LinkPage = z.infer<typeof linkPageSchema>;

export const saveLinkPageSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, {
        error: 'Letters, digits and dashes (2–41 characters).',
      }),
    status: z.enum(LINK_PAGE_STATUSES),
    titleAr: optionalText(80),
    titleEn: optionalText(80),
    bioAr: optionalText(300),
    bioEn: optionalText(300),
    themeColor: hex,
    buttonStyle: z.enum(LINK_BUTTON_STYLES),
    buttonVariant: z.enum(LINK_BUTTON_VARIANTS).default('fill'),
    buttonTextColor: optionalHex,
    background: z.enum(LINK_BACKGROUNDS),
    backgroundColor: optionalHex,
    backgroundColor2: optionalHex,
    textColor: optionalHex,
    font: z.enum(LINK_FONTS).default('default'),
    animation: z.enum(LINK_ANIMATIONS).default('fade-up'),
    version: z.number().int().nonnegative(),
  })
  .refine((s) => Boolean(s.titleAr || s.titleEn), {
    error: 'A page title is required.',
    path: ['titleAr'],
  })
  .refine((s) => !['custom', 'gradient'].includes(s.background) || s.backgroundColor !== null, {
    error: 'Choose the background colour.',
    path: ['backgroundColor'],
  })
  .refine((s) => s.background !== 'gradient' || s.backgroundColor2 !== null, {
    error: 'Choose the second gradient colour.',
    path: ['backgroundColor2'],
  });
export type SaveLinkPage = z.input<typeof saveLinkPageSchema>;

export const saveLinkItemSchema = z
  .object({
    kind: z.enum(LINK_ITEM_KINDS),
    labelAr: optionalText(80),
    labelEn: optionalText(80),
    emoji: linkEmojiSchema,
    effect: z.enum(LINK_ITEM_EFFECTS).default('none'),
    url: linkUrlSchema,
    status: z.enum(LINK_ITEM_STATUSES),
    /** 0 for a new link. */
    version: z.number().int().nonnegative(),
  })
  .refine((s) => Boolean(s.labelAr || s.labelEn), {
    error: 'A button label is required.',
    path: ['labelAr'],
  });
export type SaveLinkItem = z.input<typeof saveLinkItemSchema>;

export const reorderLinkItemsSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(MAX_LINK_ITEMS),
});

// ---------------------------------------------------------------- public page
export const publicLinkPageSchema = z.object({
  slug: z.string(),
  titleAr: z.string().nullable(),
  titleEn: z.string().nullable(),
  bioAr: z.string().nullable(),
  bioEn: z.string().nullable(),
  ...styleShape,
  avatarUrl: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(LINK_ITEM_KINDS),
      labelAr: z.string().nullable(),
      labelEn: z.string().nullable(),
      emoji: z.string().nullable(),
      effect: z.enum(LINK_ITEM_EFFECTS),
      url: z.string(),
    }),
  ),
});
export type PublicLinkPage = z.infer<typeof publicLinkPageSchema>;
