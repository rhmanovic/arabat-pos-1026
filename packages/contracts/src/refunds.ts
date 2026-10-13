import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';
import { quantitySchema } from './inventory.js';
import { cartLineInputSchema, discountInputSchema, paymentInputSchema } from './sales.js';

export const REFUND_REASONS = [
  'changed_mind',
  'defective',
  'wrong_item',
  'damaged',
  'price_adjustment',
  'other',
] as const;
export const VOID_REASONS = ['cashier_error', 'customer_cancelled', 'other'] as const;
export const REFUND_STATUSES = [
  'pending_approval',
  'processing',
  'completed',
  'rejected',
  'cancelled',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

const note = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v == null || v === '' ? null : v));

export const returnLineInputSchema = z.object({
  /** Position of the line on the original sale. */
  position: z.number().int().min(0),
  quantity: quantitySchema,
  /**
   * Put the item back into sellable stock. Omitted = decided by the refund reason: damaged and
   * defective goods stay out of stock (BR-175).
   */
  restock: z.boolean().optional(),
});

export const refundAllocationSchema = z.object({
  paymentId: z.uuid(),
  amount: moneyAmountSchema,
  reference: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});

export const refundPreviewRequestSchema = z.object({
  saleId: z.uuid(),
  lines: z.array(returnLineInputSchema).min(1).max(200),
});

export const createRefundSchema = z
  .object({
    idempotencyKey: z.uuid(),
    saleId: z.uuid(),
    lines: z.array(returnLineInputSchema).min(1).max(200),
    reason: z.enum(REFUND_REASONS),
    note,
    /** Optional: how to pay back; defaults to the suggested allocation. */
    allocation: z.array(refundAllocationSchema).max(10).optional(),
    /** Customer phone or name, asked for on refunds that wait for approval (BR-180). */
    customerContact: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .transform((v) => (v == null || v === '' ? null : v)),
  })
  .refine((r) => r.reason !== 'other' || Boolean(r.note), {
    error: 'Add a note explaining the refund.',
    path: ['note'],
  })
  .refine((r) => new Set(r.lines.map((l) => l.position)).size === r.lines.length, {
    error: 'Each item may appear only once.',
    path: ['lines'],
  });
export type CreateRefund = z.input<typeof createRefundSchema>;

export const voidSaleSchema = z
  .object({
    idempotencyKey: z.uuid(),
    reason: z.enum(VOID_REASONS),
    note,
  })
  .refine((r) => r.reason !== 'other' || Boolean(r.note), { error: 'Add a note.', path: ['note'] });
export type VoidSale = z.input<typeof voidSaleSchema>;

export const exchangeSchema = z
  .object({
    idempotencyKey: z.uuid(),
    saleId: z.uuid(),
    returnLines: z.array(returnLineInputSchema).min(1).max(200),
    reason: z.enum(REFUND_REASONS),
    note,
    /** The new items. */
    lines: z.array(cartLineInputSchema).min(1).max(200),
    orderDiscount: discountInputSchema.nullish().transform((v) => v ?? null),
    /** Payments for the amount still due after the credit (empty when the credit covers it). */
    payments: z.array(paymentInputSchema).max(10),
    /** New sale total the cashier saw. */
    expectedTotal: moneyAmountSchema,
  })
  .refine((r) => r.reason !== 'other' || Boolean(r.note), { error: 'Add a note.', path: ['note'] })
  .refine((r) => new Set(r.returnLines.map((l) => l.position)).size === r.returnLines.length, {
    error: 'Each item may appear only once.',
    path: ['returnLines'],
  });
export type Exchange = z.input<typeof exchangeSchema>;

export const refundDecisionSchema = z.object({ note });

export const refundableLineSchema = z.object({
  position: z.number().int(),
  variantId: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  sku: z.string().nullable(),
  soldQuantity: z.string(),
  refundedQuantity: z.string(),
  refundableQuantity: z.string(),
  net: moneySchema,
  trackInventory: z.boolean(),
});
export const refundablePaymentSchema = z.object({
  paymentId: z.string(),
  kind: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  amount: moneySchema,
  refunded: moneySchema,
  refundable: moneySchema,
  verification: z.enum(['manual', 'gateway', 'internal']),
});
export const refundableSaleSchema = z.object({
  saleId: z.string(),
  receiptNumber: z.string(),
  createdAt: z.string(),
  branchId: z.string(),
  cashierName: z.string(),
  total: moneySchema,
  refunded: moneySchema,
  refundable: moneySchema,
  withinWindow: z.boolean(),
  /** True when the sale belongs to the current open shift and has no refunds (void allowed). */
  voidable: z.boolean(),
  lines: z.array(refundableLineSchema),
  payments: z.array(refundablePaymentSchema),
});
export type RefundableSale = z.infer<typeof refundableSaleSchema>;

export const refundPreviewSchema = z.object({
  lines: z.array(
    z.object({ position: z.number().int(), quantity: z.string(), amount: moneySchema }),
  ),
  total: moneySchema,
  allocation: z.array(
    z.object({
      paymentId: z.string(),
      kind: z.string(),
      amount: moneySchema,
      /** The pay-back needs a terminal / transfer reference (BR-181). */
      referenceRequired: z.boolean().default(false),
    }),
  ),
  approvalRequired: z.boolean(),
  /** over_limit | outside_window | own_sale (BR-180). */
  approvalReasons: z.array(z.string()),
});
export type RefundPreview = z.infer<typeof refundPreviewSchema>;

export const refundSchema = z.object({
  id: z.string(),
  refundNumber: z.string(),
  saleId: z.string(),
  receiptNumber: z.string(),
  branchId: z.string(),
  kind: z.enum(['refund', 'void', 'exchange']),
  status: z.enum(REFUND_STATUSES),
  reason: z.string(),
  note: z.string().nullable(),
  total: moneySchema,
  exchangeCredit: moneySchema,
  exchangeSaleId: z.string().nullable(),
  approvalReasons: z.array(z.string()),
  requestedBy: z.string(),
  decidedBy: z.string().nullable(),
  decisionNote: z.string().nullable(),
  /** The owner completed a refund that would otherwise have waited (BR-180). */
  ownerOverride: z.boolean().default(false),
  customerContact: z.string().nullable().default(null),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  lines: z.array(
    z.object({
      position: z.number().int(),
      variantId: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      quantity: z.string(),
      amount: moneySchema,
      restock: z.boolean(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      amount: moneySchema,
      status: z.enum(['succeeded', 'pending', 'failed']),
      verification: z.enum(['manual', 'gateway', 'internal']),
      reference: z.string().nullable(),
      /** Processing fee given back with this pay-back (method policy, D6). */
      feeReversed: moneySchema.optional(),
    }),
  ),
  version: z.number().int(),
});
export type Refund = z.infer<typeof refundSchema>;
export const refundListSchema = z.object({
  refunds: z.array(refundSchema.omit({ lines: true, payments: true })),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
const isoDate = z.iso.date();
export const refundListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(REFUND_STATUSES).optional(),
  kind: z.enum(['refund', 'void', 'exchange']).optional(),
  saleId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type RefundListQuery = z.input<typeof refundListQuerySchema>;

export const refundActivitySchema = z.object({
  byEmployee: z.array(
    z.object({
      membershipId: z.string(),
      employeeName: z.string(),
      sales: z.number().int(),
      salesAmount: moneySchema,
      refunds: z.number().int(),
      voids: z.number().int(),
      refundAmount: moneySchema,
      /** Refunded amount as a percentage of sales (2 decimals). */
      refundRate: z.string(),
      outsideWindow: z.number().int(),
      /** Completed refunds of sales this employee rang up themselves (BR-180). */
      ownSaleRefunds: z.number().int().default(0),
      flagged: z.boolean(),
    }),
  ),
  /** Employees whose refund rate is above this percentage are flagged. */
  flagThresholdPercent: z.string(),
});
export type RefundActivity = z.infer<typeof refundActivitySchema>;
export const refundActivityQuerySchema = z.object({
  branchId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const refundReceiptSchema = z.object({
  refund: refundSchema,
  merchant: z.object({ nameEn: z.string().nullable(), nameAr: z.string().nullable() }),
  branch: z.object({
    nameEn: z.string().nullable(),
    nameAr: z.string().nullable(),
    receiptFooter: z.string().nullable(),
  }),
  cashierName: z.string(),
});
export type RefundReceipt = z.infer<typeof refundReceiptSchema>;
