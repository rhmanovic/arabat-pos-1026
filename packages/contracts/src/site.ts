import { z } from 'zod';

/**
 * The "Our apps" menu of the public site (ADR-0117): every app we offer, listed in the landing
 * navbar and kept by platform operators (add, edit, hide, reorder, delete).
 */
export const SITE_APP_ICONS = [
  'dashboard',
  'till',
  'store',
  'links',
  'computer',
  'phone',
  'other',
] as const;
export type SiteAppIcon = (typeof SITE_APP_ICONS)[number];

/** A path on this site (`/manager/`) or an absolute http(s) address (an app store page). */
export const SITE_APP_URL = /^(\/\S*|https?:\/\/\S+)$/;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

export const publicSiteAppSchema = z.object({
  id: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  descriptionAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  url: z.string(),
  icon: z.enum(SITE_APP_ICONS),
  openInNewTab: z.boolean(),
});
export type PublicSiteApp = z.infer<typeof publicSiteAppSchema>;

export const publicSiteAppsSchema = z.object({ apps: z.array(publicSiteAppSchema) });
export type PublicSiteApps = z.infer<typeof publicSiteAppsSchema>;

export const siteAppSchema = publicSiteAppSchema.extend({
  status: z.enum(['active', 'hidden']),
  sortOrder: z.number().int(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type SiteApp = z.infer<typeof siteAppSchema>;
export const siteAppListSchema = z.object({ apps: z.array(siteAppSchema) });

export const saveSiteAppSchema = z.object({
  nameAr: z.string().trim().min(1).max(60),
  nameEn: z.string().trim().min(1).max(60),
  descriptionAr: optionalText(160),
  descriptionEn: optionalText(160),
  url: z
    .string()
    .trim()
    .max(500)
    .regex(SITE_APP_URL, { error: 'Enter a path such as /pos/ or a full https:// address.' }),
  icon: z.enum(SITE_APP_ICONS),
  openInNewTab: z.boolean(),
  status: z.enum(['active', 'hidden']),
  sortOrder: z.number().int().min(0).max(10000),
  /** 0 when creating; the current version when editing (409 VERSION_CONFLICT otherwise). */
  version: z.number().int().nonnegative(),
});
export type SaveSiteApp = z.input<typeof saveSiteAppSchema>;
