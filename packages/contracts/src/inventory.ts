import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';

/** Quantity on the wire: decimal string with up to 3 decimals ("2", "1.250"), never a number. */
export const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,11}(\.\d{1,3})?$/, { error: 'Enter a quantity with up to 3 decimal places.' });

export const ADJUSTMENT_KINDS = ['opening', 'increase', 'decrease', 'count'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/** Allowed reasons per adjustment kind (BR-063). "other" requires a note. */
export const ADJUSTMENT_REASONS = {
  opening: ['opening'],
  increase: ['found', 'customer_return', 'received_other', 'correction', 'other'],
  decrease: ['damaged', 'expired', 'lost', 'theft', 'internal_use', 'correction', 'other'],
  count: ['stock_count'],
} as const satisfies Record<AdjustmentKind, readonly string[]>;

export const MOVEMENT_TYPES = [
  'opening',
  'adjustment',
  'count',
  'sale',
  'sale_void',
  'refund',
  'transfer_out',
  'transfer_in',
  'purchase_receipt',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const STOCK_STATUSES = ['in_stock', 'low', 'out', 'negative'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const COSTING_METHOD = 'weighted_average' as const;

// ---------------------------------------------------------------- levels
export const stockLevelSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  sku: z.string().nullable(),
  /** null when the list aggregates several branches. */
  branchId: z.string().nullable(),
  onHand: z.string(),
  lowStockThreshold: z.string().nullable(),
  status: z.enum(STOCK_STATUSES),
  /** Present only for users allowed to see costs. */
  avgCost: moneySchema.nullable().optional(),
  value: moneySchema.nullable().optional(),
  lastMovementAt: z.string().nullable(),
});
export type StockLevel = z.infer<typeof stockLevelSchema>;

export const stockLevelListSchema = z.object({
  levels: z.array(stockLevelSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  costVisible: z.boolean(),
});

export const stockLevelQuerySchema = z.object({
  branchId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  stock: z.enum(['all', 'low', 'out', 'in_stock']).default('all'),
  sort: z.enum(['name', 'on_hand', 'updated']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type StockLevelQuery = z.input<typeof stockLevelQuerySchema>;

export const inventorySummarySchema = z.object({
  branchId: z.string().nullable(),
  trackedVariants: z.number().int(),
  lowStock: z.number().int(),
  outOfStock: z.number().int(),
  /** Stock value at weighted-average cost; omitted without cost permission. */
  totalValue: moneySchema.nullable().optional(),
  /** Number of in-stock variants without a known cost (excluded from the value). */
  unvaluedVariants: z.number().int(),
  costingMethod: z.literal(COSTING_METHOD),
  allowNegativeStock: z.boolean(),
});
export type InventorySummary = z.infer<typeof inventorySummarySchema>;

export const variantStockSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  sku: z.string().nullable(),
  trackInventory: z.boolean(),
  branches: z.array(
    z.object({
      branchId: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      onHand: z.string(),
      lowStockThreshold: z.string().nullable(),
      status: z.enum(STOCK_STATUSES),
      avgCost: moneySchema.nullable().optional(),
      value: moneySchema.nullable().optional(),
    }),
  ),
  total: z.string(),
});
export type VariantStock = z.infer<typeof variantStockSchema>;

export const setThresholdSchema = z.object({
  branchId: z.uuid(),
  variantId: z.uuid(),
  threshold: quantitySchema.nullable(),
});

// ---------------------------------------------------------------- adjustments
export const adjustmentLineInputSchema = z.object({
  variantId: z.uuid(),
  /** The change (opening/increase/decrease, > 0) or the counted quantity (count, ≥ 0). */
  quantity: quantitySchema,
  /** Unit cost for opening/increase; requires `catalog.prices.manage`. Defaults to the variant cost. */
  unitCost: moneyAmountSchema.nullish().transform((v) => v ?? null),
});

export const createAdjustmentSchema = z
  .object({
    branchId: z.uuid(),
    kind: z.enum(ADJUSTMENT_KINDS),
    reason: z.string().trim().min(1).max(40),
    note: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => (v == null || v === '' ? null : v)),
    /** Client-generated key: retrying the same request never applies it twice. */
    idempotencyKey: z.uuid().optional(),
    lines: z.array(adjustmentLineInputSchema).min(1).max(200),
  })
  .refine((a) => (ADJUSTMENT_REASONS[a.kind] as readonly string[]).includes(a.reason), {
    error: 'This reason is not valid for the adjustment type.',
    path: ['reason'],
  })
  .refine((a) => a.reason !== 'other' || Boolean(a.note), {
    error: 'Add a note explaining the adjustment.',
    path: ['note'],
  })
  .refine((a) => new Set(a.lines.map((l) => l.variantId)).size === a.lines.length, {
    error: 'Each item may appear only once.',
    path: ['lines'],
  });
export type CreateAdjustment = z.input<typeof createAdjustmentSchema>;

export const adjustmentSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  kind: z.enum(ADJUSTMENT_KINDS),
  reason: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  createdBy: z.object({ userId: z.string(), fullName: z.string() }),
  lines: z.array(
    z.object({
      variantId: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      variantNameEn: z.string().nullable(),
      variantNameAr: z.string().nullable(),
      sku: z.string().nullable(),
      quantity: z.string(),
      previousOnHand: z.string(),
      delta: z.string(),
      newOnHand: z.string(),
      unitCost: moneySchema.nullable().optional(),
    }),
  ),
});
export type Adjustment = z.infer<typeof adjustmentSchema>;

export const adjustmentSummarySchema = z.object({
  id: z.string(),
  branchId: z.string(),
  kind: z.enum(ADJUSTMENT_KINDS),
  reason: z.string(),
  note: z.string().nullable(),
  lineCount: z.number().int(),
  createdAt: z.string(),
  createdBy: z.object({ userId: z.string(), fullName: z.string() }),
});
export const adjustmentListSchema = z.object({
  adjustments: z.array(adjustmentSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const adjustmentListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  kind: z.enum(ADJUSTMENT_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdjustmentListQuery = z.input<typeof adjustmentListQuerySchema>;

// ---------------------------------------------------------------- movements
export const movementSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  variantId: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  sku: z.string().nullable(),
  movementType: z.enum(MOVEMENT_TYPES),
  reason: z.string().nullable(),
  quantity: z.string(),
  balanceAfter: z.string(),
  unitCost: moneySchema.nullable().optional(),
  value: moneySchema.nullable().optional(),
  sourceType: z.string(),
  sourceId: z.string(),
  note: z.string().nullable(),
  createdBy: z.object({ userId: z.string(), fullName: z.string() }).nullable(),
  createdAt: z.string(),
});
export type Movement = z.infer<typeof movementSchema>;
export const movementListSchema = z.object({
  movements: z.array(movementSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
const isoDate = z.iso.date();
export const movementQuerySchema = z.object({
  branchId: z.uuid().optional(),
  variantId: z.uuid().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  /** Inclusive calendar dates (YYYY-MM-DD) in the merchant's time zone. */
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type MovementQuery = z.input<typeof movementQuerySchema>;

// ---------------------------------------------------------------- settings & POS
export const inventorySettingsSchema = z.object({
  allowNegativeStock: z.boolean(),
  costingMethod: z.literal(COSTING_METHOD),
  version: z.number().int(),
});
export type InventorySettings = z.infer<typeof inventorySettingsSchema>;
export const updateInventorySettingsSchema = z.object({
  allowNegativeStock: z.boolean(),
  version: z.number().int().positive(),
});

export const posAvailabilityQuerySchema = z.object({
  /** Comma-separated variant ids; omitted = every tracked item at the branch. */
  variantIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.uuid()).max(500).optional()),
});
export const posAvailabilitySchema = z.object({
  branchId: z.string(),
  allowNegativeStock: z.boolean(),
  items: z.array(
    z.object({
      variantId: z.string(),
      onHand: z.string(),
      status: z.enum(STOCK_STATUSES),
    }),
  ),
});
export type PosAvailability = z.infer<typeof posAvailabilitySchema>;
