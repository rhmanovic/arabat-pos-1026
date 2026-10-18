import { z } from 'zod';
import { emailSchema } from './auth.js';
import { moneyAmountSchema, moneySchema } from './catalog.js';

/**
 * Public pricing page and purchase requests (ADR-0114). One yearly system price per company,
 * devices sold once; the operator manages both in the platform console. Nothing is paid online:
 * a request is followed up by hand (BR-155).
 */
export const OFFER_ITEM_KINDS = ['system', 'device'] as const;
export const OFFER_ITEM_ICONS = [
  'system',
  'tablet',
  'ipad',
  'scanner',
  'printer',
  'drawer',
  'other',
] as const;
export type OfferItemIcon = (typeof OFFER_ITEM_ICONS)[number];
export const SALES_REQUEST_STATUSES = ['new', 'contacted', 'won', 'lost'] as const;
export type SalesRequestStatus = (typeof SALES_REQUEST_STATUSES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

// ---------------------------------------------------------------- public page
export const publicOfferItemSchema = z.object({
  id: z.string(),
  kind: z.enum(OFFER_ITEM_KINDS),
  nameAr: z.string(),
  nameEn: z.string(),
  descriptionAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  price: moneySchema,
  icon: z.enum(OFFER_ITEM_ICONS),
  /** Relative URL of the uploaded picture, or null to draw the icon. */
  imageUrl: z.string().nullable(),
  maxQuantity: z.number().int(),
});
export type PublicOfferItem = z.infer<typeof publicOfferItemSchema>;

export const publicOfferSchema = z.object({
  system: publicOfferItemSchema,
  devices: z.array(publicOfferItemSchema),
});
export type PublicOffer = z.infer<typeof publicOfferSchema>;

export const createSalesRequestSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, { error: 'Enter a phone number.' }),
  email: emailSchema,
  notes: optionalText(1000),
  language: z.enum(['ar', 'en']),
  devices: z
    .array(z.object({ itemId: z.uuid(), quantity: z.number().int().min(1).max(100) }))
    .max(50),
});
export type CreateSalesRequest = z.input<typeof createSalesRequestSchema>;

export const salesRequestCreatedSchema = z.object({
  reference: z.string(),
  system: moneySchema,
  devices: moneySchema,
  total: moneySchema,
});
export type SalesRequestCreated = z.infer<typeof salesRequestCreatedSchema>;

// ---------------------------------------------------------------- platform console
export const offerItemSchema = publicOfferItemSchema.extend({
  status: z.enum(['active', 'hidden']),
  sortOrder: z.number().int(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type OfferItem = z.infer<typeof offerItemSchema>;
export const offerItemListSchema = z.object({ items: z.array(offerItemSchema) });

export const saveOfferItemSchema = z.object({
  nameAr: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  descriptionAr: optionalText(300),
  descriptionEn: optionalText(300),
  price: moneyAmountSchema,
  icon: z.enum(OFFER_ITEM_ICONS),
  maxQuantity: z.number().int().min(1).max(100),
  status: z.enum(['active', 'hidden']),
  sortOrder: z.number().int().min(0).max(10000),
  version: z.number().int().nonnegative(),
});
export type SaveOfferItem = z.input<typeof saveOfferItemSchema>;

export const salesRequestLineSchema = z.object({
  kind: z.enum(OFFER_ITEM_KINDS),
  nameAr: z.string(),
  nameEn: z.string(),
  unitPrice: moneySchema,
  quantity: z.number().int(),
  lineTotal: moneySchema,
});

export const salesRequestSchema = z.object({
  id: z.string(),
  reference: z.string(),
  companyName: z.string(),
  contactName: z.string(),
  phone: z.string(),
  email: z.string(),
  notes: z.string().nullable(),
  language: z.enum(['ar', 'en']),
  system: moneySchema,
  devices: moneySchema,
  total: moneySchema,
  status: z.enum(SALES_REQUEST_STATUSES),
  operatorNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  version: z.number().int(),
  lines: z.array(salesRequestLineSchema),
});
export type SalesRequest = z.infer<typeof salesRequestSchema>;

export const salesRequestListSchema = z.object({
  requests: z.array(salesRequestSchema.omit({ lines: true })),
  counts: z.record(z.enum(SALES_REQUEST_STATUSES), z.number().int()),
});
export type SalesRequestList = z.infer<typeof salesRequestListSchema>;

export const salesRequestQuerySchema = z.object({
  status: z.enum(SALES_REQUEST_STATUSES).optional(),
});

export const updateSalesRequestSchema = z.object({
  status: z.enum(SALES_REQUEST_STATUSES),
  operatorNote: optionalText(1000),
  version: z.number().int().nonnegative(),
});
export type UpdateSalesRequest = z.input<typeof updateSalesRequestSchema>;
