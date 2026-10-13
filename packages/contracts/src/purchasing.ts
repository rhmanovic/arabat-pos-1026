import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';
import { quantitySchema } from './inventory.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));
const isoDate = z.iso.date();

// ---------------------------------------------------------------- suppliers
export const supplierSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  taxNumber: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
  orderCount: z.number().int(),
  purchasedTotal: moneySchema,
  version: z.number().int(),
});
export type Supplier = z.infer<typeof supplierSchema>;
export const supplierListSchema = z.object({ suppliers: z.array(supplierSchema) });
export const saveSupplierSchema = z
  .object({
    code: text(20),
    nameEn: text(120),
    nameAr: text(120),
    contactName: text(120),
    phone: text(40),
    email: z
      .email()
      .nullish()
      .or(z.literal(''))
      .transform((v) => (v ? v.toLowerCase() : null)),
    address: text(300),
    taxNumber: text(40),
    paymentTerms: text(120),
    notes: text(1000),
    status: z.enum(['active', 'inactive']).default('active'),
    version: z.number().int().positive().optional(),
  })
  .refine((v) => Boolean(v.nameAr || v.nameEn), { error: 'A name is required.', path: ['nameAr'] });
export type SaveSupplier = z.input<typeof saveSupplierSchema>;

// ---------------------------------------------------------------- purchase orders
export const PO_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'partially_received',
  'received',
  'cancelled',
  'closed',
] as const;
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number];

const itemFields = {
  variantId: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  sku: z.string().nullable(),
};

export const purchaseOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  supplierId: z.string(),
  supplierName: z.object({ nameEn: z.string().nullable(), nameAr: z.string().nullable() }),
  branchId: z.string(),
  status: z.enum(PO_STATUSES),
  expectedDate: z.string().nullable(),
  note: z.string().nullable(),
  total: moneySchema,
  receivedValue: moneySchema,
  /** Supplier payments recorded against this order, net of reversals (BR-166). */
  paidToDate: moneySchema,
  createdBy: z.string(),
  approvedBy: z.string().nullable(),
  closeReason: z.string().nullable(),
  createdAt: z.string(),
  lines: z.array(
    z.object({
      position: z.number().int(),
      ...itemFields,
      quantity: z.string(),
      receivedQuantity: z.string(),
      remainingQuantity: z.string(),
      unitCost: moneySchema,
      total: moneySchema,
    }),
  ),
  receipts: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      receivedBy: z.string(),
      createdAt: z.string(),
      supplierReference: z.string().nullable(),
      note: z.string().nullable(),
      lines: z.array(z.object({ position: z.number().int(), quantity: z.string() })),
    }),
  ),
  version: z.number().int(),
});
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export const purchaseOrderListSchema = z.object({
  orders: z.array(purchaseOrderSchema.omit({ lines: true, receipts: true })),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const purchaseOrderListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  status: z.enum(PO_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PurchaseOrderListQuery = z.input<typeof purchaseOrderListQuerySchema>;

export const savePurchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  branchId: z.uuid(),
  expectedDate: isoDate.nullish().transform((v) => v ?? null),
  note: text(1000),
  lines: z
    .array(z.object({ variantId: z.uuid(), quantity: quantitySchema, unitCost: moneyAmountSchema }))
    .min(1)
    .max(300),
  version: z.number().int().positive().optional(),
});
export type SavePurchaseOrder = z.input<typeof savePurchaseOrderSchema>;

export const purchaseOrderActionSchema = z.object({
  version: z.number().int().positive(),
  reason: text(500),
});

export const receivePurchaseSchema = z.object({
  idempotencyKey: z.uuid(),
  supplierReference: text(80),
  note: text(500),
  lines: z
    .array(z.object({ position: z.number().int().min(0), quantity: quantitySchema }))
    .min(1)
    .max(300),
});
export type ReceivePurchase = z.input<typeof receivePurchaseSchema>;

// ---------------------------------------------------------------- transfers
export const TRANSFER_STATUSES = [
  'requested',
  'approved',
  'in_transit',
  'received',
  'cancelled',
  'recalled',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const TRANSFER_LOSS_STATUSES = ['posted', 'pending', 'rejected'] as const;
export type TransferLossStatus = (typeof TRANSFER_LOSS_STATUSES)[number];

/** A written-off shortage of a transfer (BR-172). */
export const transferLossSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.enum(TRANSFER_LOSS_STATUSES),
  /** Σ quantity × dispatch cost; present only for users allowed to see costs. */
  value: moneySchema.optional(),
  explanation: z.string(),
  limitExceeded: z.boolean(),
  ownerOverride: z.boolean(),
  claimedBy: z.string(),
  claimedByUserId: z.string(),
  createdAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  lines: z.array(z.object({ position: z.number().int(), quantity: z.string() })),
});
export type TransferLoss = z.infer<typeof transferLossSchema>;

export const transferSchema = z.object({
  id: z.string(),
  number: z.string(),
  sourceBranchId: z.string(),
  destinationBranchId: z.string(),
  status: z.enum(TRANSFER_STATUSES),
  note: z.string().nullable(),
  discrepancyNote: z.string().nullable(),
  requestedBy: z.string(),
  approvedBy: z.string().nullable(),
  dispatchedBy: z.string().nullable(),
  receivedBy: z.string().nullable(),
  recalledBy: z.string().nullable(),
  recallNote: z.string().nullable(),
  createdAt: z.string(),
  dispatchedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  recalledAt: z.string().nullable(),
  /** dispatched − received summed over lines (negative when more arrived than was sent). */
  discrepancyQuantity: z.string(),
  /** Dispatched, not received, not recalled and not written off by a posted loss (BR-173). */
  inTransitQuantity: z.string(),
  inTransitValue: moneySchema.optional(),
  /** Quantity written off by posted losses. */
  lostQuantity: z.string(),
  losses: z.array(transferLossSchema),
  lines: z.array(
    z.object({
      position: z.number().int(),
      ...itemFields,
      requestedQuantity: z.string(),
      dispatchedQuantity: z.string().nullable(),
      receivedQuantity: z.string().nullable(),
      recalledQuantity: z.string().nullable(),
      /** dispatched − received (negative = surplus). */
      discrepancyQuantity: z.string().nullable(),
      lostQuantity: z.string(),
      inTransitQuantity: z.string(),
      unitCost: moneySchema.nullable().optional(),
    }),
  ),
  version: z.number().int(),
});
export type Transfer = z.infer<typeof transferSchema>;
export const transferListSchema = z.object({
  transfers: z.array(transferSchema.omit({ lines: true, losses: true })),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const transferListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(TRANSFER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type TransferListQuery = z.input<typeof transferListQuerySchema>;

export const createTransferSchema = z
  .object({
    sourceBranchId: z.uuid(),
    destinationBranchId: z.uuid(),
    note: text(500),
    lines: z
      .array(z.object({ variantId: z.uuid(), quantity: quantitySchema }))
      .min(1)
      .max(300),
  })
  .refine((t) => t.sourceBranchId !== t.destinationBranchId, {
    error: 'Choose two different branches.',
    path: ['destinationBranchId'],
  })
  .refine((t) => new Set(t.lines.map((l) => l.variantId)).size === t.lines.length, {
    error: 'Each item may appear only once.',
    path: ['lines'],
  });
export type CreateTransfer = z.input<typeof createTransferSchema>;

export const transferActionSchema = z.object({ version: z.number().int().positive() });
/** Recall (BR-173): the goods in transit return to the source; a reason is required. */
export const recallTransferSchema = z.object({
  version: z.number().int().positive(),
  note: z.string().trim().min(1).max(500),
});
export type RecallTransfer = z.input<typeof recallTransferSchema>;
/** Claims the remaining in-transit quantity of a received transfer as a loss (BR-172). */
export const claimTransferLossSchema = z.object({
  explanation: z.string().trim().min(1).max(500),
});
export type ClaimTransferLoss = z.input<typeof claimTransferLossSchema>;
export const decideTransferLossSchema = z
  .object({ decision: z.enum(['approve', 'reject']), note: text(500) })
  .refine((d) => d.decision !== 'reject' || Boolean(d.note), {
    error: 'Explain why the loss is rejected.',
    path: ['note'],
  });
export type DecideTransferLoss = z.input<typeof decideTransferLossSchema>;
/** Goods on the road right now, valued at dispatch cost, with their age (BR-173). */
export const inTransitSummarySchema = z.object({
  transfers: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      sourceBranchId: z.string(),
      destinationBranchId: z.string(),
      status: z.enum(TRANSFER_STATUSES),
      dispatchedAt: z.string(),
      ageDays: z.number().int(),
      quantity: z.string(),
      value: moneySchema.optional(),
      /** Received short with no posted loss yet (a loss is pending, rejected or not claimed). */
      unresolved: z.boolean(),
      pendingLoss: z.boolean(),
    }),
  ),
  quantity: z.string(),
  value: moneySchema.optional(),
});
export type InTransitSummary = z.infer<typeof inTransitSummarySchema>;
export const transferQuantitiesSchema = z.object({
  version: z.number().int().positive(),
  lines: z
    .array(z.object({ position: z.number().int().min(0), quantity: quantitySchema }))
    .min(1)
    .max(300),
  note: text(500),
});
export type TransferQuantities = z.input<typeof transferQuantitiesSchema>;
