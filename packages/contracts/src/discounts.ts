import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';

/*
 * Product discounts (ADR-0133): a percentage or an amount off the price of chosen products, at
 * the point of sale and / or in the online store, optionally between two dates. Discounts never
 * add up: the largest one in force wins. Managed in the store console.
 */

export const PRODUCT_DISCOUNT_TYPES = ['percentage', 'amount'] as const;
/** What a discount covers: every product, categories (with their sub-categories), lists, products. */
export const PRODUCT_DISCOUNT_TARGETS = ['all', 'categories', 'collections', 'products'] as const;
export const PRODUCT_DISCOUNT_STATUSES = ['active', 'paused', 'archived'] as const;
/** Where a discount stands now: computed from the status and the dates. */
export const PRODUCT_DISCOUNT_STATES = [
  'running',
  'scheduled',
  'ended',
  'paused',
  'archived',
] as const;

const named = { nameEn: z.string().nullable(), nameAr: z.string().nullable() };
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const productDiscountSchema = z.object({
  id: z.string(),
  ...named,
  type: z.enum(PRODUCT_DISCOUNT_TYPES),
  percent: z.string().nullable(),
  amount: moneySchema.nullable(),
  appliesTo: z.enum(PRODUCT_DISCOUNT_TARGETS),
  targetIds: z.array(z.string()),
  /** At the point of sale (browser till and devices). */
  pos: z.boolean(),
  /** In the online store. */
  online: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  status: z.enum(PRODUCT_DISCOUNT_STATUSES),
  state: z.enum(PRODUCT_DISCOUNT_STATES),
  /** Products the discount lowers now (those it covers and whose price stays above zero). */
  productCount: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type ProductDiscount = z.infer<typeof productDiscountSchema>;
export const productDiscountListSchema = z.object({ discounts: z.array(productDiscountSchema) });
export type ProductDiscountList = z.infer<typeof productDiscountListSchema>;

export const saveProductDiscountSchema = z
  .object({
    nameEn: text(80),
    nameAr: text(80),
    type: z.enum(PRODUCT_DISCOUNT_TYPES),
    percent: z
      .string()
      .trim()
      .regex(/^\d{1,2}(\.\d{1,2})?$/, { error: 'Between 0 and 100, up to 2 decimals.' })
      .nullish()
      .transform((v) => v || null),
    amount: moneyAmountSchema.nullish().transform((v) => v || null),
    appliesTo: z.enum(PRODUCT_DISCOUNT_TARGETS),
    targetIds: z.array(z.uuid()).max(500).default([]),
    pos: z.boolean().default(true),
    online: z.boolean().default(true),
    startsAt: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    endsAt: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    status: z.enum(['active', 'paused']).default('active'),
    version: z.number().int().positive().optional(),
  })
  .refine((d) => Boolean(d.nameAr || d.nameEn), { error: 'A name is required.', path: ['nameAr'] })
  .refine((d) => d.type !== 'percentage' || (d.percent !== null && Number(d.percent) > 0), {
    error: 'Enter a percentage above 0 and below 100.',
    path: ['percent'],
  })
  .refine((d) => d.type !== 'amount' || (d.amount !== null && Number(d.amount) > 0), {
    error: 'Enter the amount off.',
    path: ['amount'],
  })
  .refine((d) => d.appliesTo === 'all' || d.targetIds.length > 0, {
    error: 'Choose at least one.',
    path: ['targetIds'],
  })
  .refine((d) => d.pos || d.online, {
    error: 'Choose the point of sale, the online store or both.',
    path: ['online'],
  })
  .refine((d) => !d.startsAt || !d.endsAt || Date.parse(d.endsAt) > Date.parse(d.startsAt), {
    error: 'The end must be after the start.',
    path: ['endsAt'],
  });
export type SaveProductDiscount = z.input<typeof saveProductDiscountSchema>;

/** What a discount would do, before it is saved: how many products, and which go below cost. */
export const productDiscountPreviewSchema = z.object({
  /** Products it lowers. */
  products: z.number().int(),
  /** Products it covers but leaves alone (the amount is as large as their price). */
  unchanged: z.number().int(),
  /** Products whose discounted price is below their cost. */
  belowCost: z.number().int(),
  /** A few examples, below-cost ones first (at most 20). */
  samples: z.array(
    z.object({
      productId: z.string(),
      ...named,
      price: moneySchema,
      discountedPrice: moneySchema,
      cost: moneySchema.nullable(),
      belowCost: z.boolean(),
    }),
  ),
});
export type ProductDiscountPreview = z.infer<typeof productDiscountPreviewSchema>;
