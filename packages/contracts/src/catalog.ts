import { z } from 'zod';
import { optionalId } from './optional-id.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

/** Upper bound for prices and costs: 1,000,000,000 KWD (stored as fils, bigint). */
export const MAX_PRICE = '1000000000';

/**
 * Money input on the wire: a plain decimal string with at most 3 decimals (KWD), never a
 * JSON number. The API converts it exactly with @arabat/money.
 */
export const moneyAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, { error: 'Enter an amount with up to 3 decimal places.' });

/** Money on the wire (responses). */
export const moneySchema = z.object({ amount: z.string(), currency: z.string() });
export type MoneyValue = z.infer<typeof moneySchema>;

export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{3,64}$/, {
    error: 'Barcode: 3–64 letters, digits, dot, dash or underscore.',
  });

export const skuSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._/-]{1,64}$/, { error: 'SKU: up to 64 letters, digits or . _ / -' });

const nameRequired = (v: { nameEn?: string | null; nameAr?: string | null }) =>
  Boolean(v.nameAr || v.nameEn);

// ---------------------------------------------------------------- categories
export const categorySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  sortOrder: z.number().int(),
  status: z.enum(['active', 'archived']),
  productCount: z.number().int(),
  version: z.number().int(),
});
export type Category = z.infer<typeof categorySchema>;
export const categoryListSchema = z.object({ categories: z.array(categorySchema) });

export const saveCategorySchema = z
  .object({
    nameEn: text(80),
    nameAr: text(80),
    parentId: optionalId(),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    version: z.number().int().positive().optional(),
  })
  .refine(nameRequired, { error: 'A category name is required.', path: ['nameAr'] });
export type SaveCategory = z.input<typeof saveCategorySchema>;

// ---------------------------------------------------------------- products
export const variantSchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  sku: z.string().nullable(),
  barcodes: z.array(z.string()),
  price: moneySchema,
  /** Omitted for users without `catalog.prices.manage`. */
  cost: moneySchema.nullable().optional(),
  isDefault: z.boolean(),
  status: z.enum(['active', 'archived']),
  position: z.number().int(),
});
export type Variant = z.infer<typeof variantSchema>;

export const productImageSchema = z.object({
  id: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  url: z.string(),
});
export type ProductImage = z.infer<typeof productImageSchema>;

export const productSchema = z.object({
  id: z.string(),
  categoryId: z.string().nullable(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  type: z.enum(['standard', 'service']),
  hasVariants: z.boolean(),
  trackInventory: z.boolean(),
  availableInAllBranches: z.boolean(),
  branchIds: z.array(z.string()),
  /** Offered at the point of sale (ADR-0130); the website has its own switch in the store console. */
  posVisible: z.boolean(),
  status: z.enum(['active', 'archived']),
  variants: z.array(variantSchema),
  images: z.array(productImageSchema),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

export const productSummarySchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  categoryId: z.string().nullable(),
  type: z.enum(['standard', 'service']),
  hasVariants: z.boolean(),
  trackInventory: z.boolean(),
  posVisible: z.boolean(),
  status: z.enum(['active', 'archived']),
  variantCount: z.number().int(),
  skus: z.array(z.string()),
  minPrice: moneySchema.nullable(),
  maxPrice: moneySchema.nullable(),
  imageUrl: z.string().nullable(),
  updatedAt: z.string(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

export const productListSchema = z.object({
  products: z.array(productSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  branchId: z.uuid().optional(),
  trackInventory: z.enum(['true', 'false']).optional(),
  sort: z.enum(['name', 'updated', 'price']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ProductListQuery = z.input<typeof productListQuerySchema>;

export const saveVariantSchema = z.object({
  /** Existing variant id; omitted for a new variant. */
  id: z.uuid().optional(),
  nameEn: text(80),
  nameAr: text(80),
  sku: skuSchema.nullish().transform((v) => v ?? null),
  barcodes: z.array(barcodeSchema).max(10).default([]),
  price: moneyAmountSchema,
  cost: moneyAmountSchema.nullish().transform((v) => v ?? null),
});
export type SaveVariant = z.input<typeof saveVariantSchema>;

export const saveProductSchema = z
  .object({
    nameEn: text(160),
    nameAr: text(160),
    descriptionEn: text(2000),
    descriptionAr: text(2000),
    categoryId: optionalId(),
    type: z.enum(['standard', 'service']).default('standard'),
    hasVariants: z.boolean().default(false),
    trackInventory: z.boolean().default(true),
    availableInAllBranches: z.boolean().default(true),
    branchIds: z.array(z.uuid()).max(500).default([]),
    /** Offered at the point of sale (ADR-0130). A new product is also in the store at once. */
    posVisible: z.boolean().default(true),
    /** Simple product: exactly one variant. With variants: 1–100 named variants. Missing ones are archived. */
    variants: z.array(saveVariantSchema).min(1).max(100),
    version: z.number().int().positive().optional(),
  })
  .refine(nameRequired, { error: 'A product name is required.', path: ['nameAr'] })
  .refine((p) => p.hasVariants || p.variants.length === 1, {
    error: 'A simple product has exactly one variant.',
    path: ['variants'],
  })
  .refine((p) => !p.hasVariants || p.variants.every((v) => v.nameAr || v.nameEn), {
    error: 'Each variant needs a name.',
    path: ['variants'],
  })
  .refine((p) => p.type === 'standard' || !p.trackInventory, {
    error: 'Services cannot track inventory.',
    path: ['trackInventory'],
  })
  .refine((p) => p.availableInAllBranches || p.branchIds.length > 0, {
    error: 'Select at least one branch.',
    path: ['branchIds'],
  });
export type SaveProduct = z.input<typeof saveProductSchema>;

export const productStatusSchema = z.object({ status: z.enum(['active', 'archived']) });

// ---------------------------------------------------------------- POS catalog
/**
 * A discounted price of one variant and when it is valid (product discounts, ADR-0133). Tills receive every offer of an item
 * and choose the one in force at the moment of the sale (`offerAt` in pos-core), so a discount
 * that starts or ends needs no new catalog.
 */
export const priceOfferSchema = z.object({
  discountId: z.string(),
  price: moneySchema,
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
});
export type PriceOfferJson = z.infer<typeof priceOfferSchema>;

export const posCatalogItemSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  categoryId: z.string().nullable(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  sku: z.string().nullable(),
  barcodes: z.array(z.string()),
  price: moneySchema,
  /** Discounted prices with their dates; the till sells at the one in force (ADR-0133). */
  offers: z.array(priceOfferSchema).default([]),
  trackInventory: z.boolean(),
  imageUrl: z.string().nullable(),
});
export type PosCatalogItem = z.infer<typeof posCatalogItemSchema>;
export const posCatalogSchema = z.object({
  branchId: z.string(),
  categories: z.array(
    z.object({
      id: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      sortOrder: z.number().int(),
    }),
  ),
  items: z.array(posCatalogItemSchema),
  version: z.string(),
});
export type PosCatalog = z.infer<typeof posCatalogSchema>;

/** Price and cost history of a product's variants (BR-191, FND-222). */
export const priceHistoryEntrySchema = z.object({
  id: z.string(),
  variantId: z.string(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  kind: z.enum(['price', 'cost']),
  from: moneySchema.nullable(),
  to: moneySchema.nullable(),
  /** manual = edited in the catalog; created = set when the variant was created. */
  source: z.enum(['manual', 'created']),
  changedBy: z.string().nullable(),
  changedAt: z.string(),
});
export const priceHistorySchema = z.object({ entries: z.array(priceHistoryEntrySchema) });
export type PriceHistory = z.infer<typeof priceHistorySchema>;
