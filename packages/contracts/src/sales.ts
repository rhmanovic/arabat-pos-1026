import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';
import { quantitySchema } from './inventory.js';

/** Discount on the wire: percentage ("10", "12.5") or an amount ("0.500"). */
export const discountInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('percent'),
    value: z
      .string()
      .trim()
      .regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/, {
        error: 'Percent: 0–100, up to 2 decimals.',
      }),
  }),
  z.object({ type: z.literal('amount'), value: moneyAmountSchema }),
]);
export type DiscountInput = z.infer<typeof discountInputSchema>;

export const cartLineInputSchema = z.object({
  variantId: z.uuid(),
  quantity: quantitySchema,
  /** New unit price; requires `sales.price_override`. */
  priceOverride: moneyAmountSchema.nullish().transform((v) => v ?? null),
  discount: discountInputSchema.nullish().transform((v) => v ?? null),
});
export type CartLineInput = z.input<typeof cartLineInputSchema>;

const cartFields = {
  lines: z.array(cartLineInputSchema).min(1).max(200),
  orderDiscount: discountInputSchema.nullish().transform((v) => v ?? null),
  /** Registered customer; omitted or null for a walk-in sale. */
  customerId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
};

/** Customer shown on a sale or held order. */
export const saleCustomerSchema = z.object({
  id: z.string(),
  code: z.string(),
  fullName: z.string(),
});
export type SaleCustomer = z.infer<typeof saleCustomerSchema>;

export const paymentInputSchema = z.object({
  methodId: z.uuid(),
  /** Amount applied to the sale. */
  amount: moneyAmountSchema,
  /** Cash only: cash handed over by the customer (≥ amount); the difference is change. */
  tendered: moneyAmountSchema.nullish().transform((v) => v ?? null),
  /** E.g. card terminal approval code or transfer reference. */
  reference: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const checkoutSchema = z.object({
  /** Client-generated once per cart; retries with the same key never create a second sale. */
  idempotencyKey: z.uuid(),
  /** Completes this suspended order instead of creating a new one. */
  orderId: z.uuid().optional(),
  ...cartFields,
  // Empty only for a zero total (e.g. a 100 % discount).
  payments: z.array(paymentInputSchema).max(10),
  /** The total the cashier saw; the server refuses the sale if its own total differs. */
  expectedTotal: moneyAmountSchema,
});
export type Checkout = z.input<typeof checkoutSchema>;

export const suspendOrderSchema = z.object({
  ...cartFields,
  label: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});
export type SuspendOrder = z.input<typeof suspendOrderSchema>;

export const saleLineSchema = z.object({
  position: z.number().int(),
  variantId: z.string(),
  productId: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.string(),
  listUnitPrice: moneySchema,
  unitPrice: moneySchema,
  priceOverridden: z.boolean(),
  gross: moneySchema,
  discount: discountInputSchema.nullable(),
  lineDiscount: moneySchema,
  orderDiscount: moneySchema,
  net: moneySchema,
  /** Restaurant modifiers (their prices are included in the unit price). */
  modifiers: z
    .array(
      z.object({
        nameEn: z.string().nullable(),
        nameAr: z.string().nullable(),
        price: moneySchema,
      }),
    )
    .default([]),
});

export const salePaymentSchema = z.object({
  id: z.string(),
  /** Null for exchange credit. */
  methodId: z.string().nullable(),
  kind: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  amount: moneySchema,
  tendered: moneySchema.nullable(),
  change: moneySchema,
  status: z.enum(['succeeded', 'pending', 'failed']),
  verification: z.enum(['manual', 'gateway', 'internal']),
  reference: z.string().nullable(),
  /** Manager view only. */
  fee: moneySchema.optional(),
});

export const saleSchema = z.object({
  id: z.string(),
  /** Null for online sales (no POS order, register or shift). */
  orderId: z.string().nullable(),
  receiptNumber: z.string(),
  branchId: z.string(),
  registerId: z.string().nullable(),
  shiftId: z.string().nullable(),
  cashierName: z.string(),
  createdAt: z.string(),
  subtotal: moneySchema,
  lineDiscounts: moneySchema,
  orderDiscount: moneySchema,
  total: moneySchema,
  paid: moneySchema,
  change: moneySchema,
  lines: z.array(saleLineSchema),
  payments: z.array(salePaymentSchema),
  /** Manager view only. */
  fees: moneySchema.optional(),
  cost: moneySchema.nullable().optional(),
  /** Completed refunds against this sale. */
  refunded: moneySchema,
  customer: saleCustomerSchema.nullable(),
  /** Restaurant bills: dine_in | takeaway | pickup; null for retail sales. */
  serviceType: z.enum(['dine_in', 'takeaway', 'pickup']).nullable().default(null),
  restaurantOrderId: z.string().nullable().default(null),
  /** pos | online (Prompt 16). */
  channel: z.enum(['pos', 'online']).default('pos'),
});
export type Sale = z.infer<typeof saleSchema>;

export const saleSummarySchema = z.object({
  id: z.string(),
  receiptNumber: z.string(),
  branchId: z.string(),
  cashierName: z.string(),
  createdAt: z.string(),
  total: moneySchema,
  itemCount: z.string(),
  paymentKinds: z.array(z.string()),
  refunded: moneySchema,
  customerName: z.string().nullable(),
  serviceType: z.enum(['dine_in', 'takeaway', 'pickup']).nullable().default(null),
  channel: z.enum(['pos', 'online']).default('pos'),
});
export type SaleSummary = z.infer<typeof saleSummarySchema>;
export const saleListSchema = z.object({
  sales: z.array(saleSummarySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totals: z.object({
    count: z.number().int(),
    amount: moneySchema,
    refunded: moneySchema,
    net: moneySchema,
  }),
});
const isoDate = z.iso.date();
export const saleListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  shiftId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  /** retail = no restaurant service type. */
  serviceType: z.enum(['retail', 'dine_in', 'takeaway', 'pickup']).optional(),
  channel: z.enum(['pos', 'online']).optional(),
  q: z.string().trim().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type SaleListQuery = z.input<typeof saleListQuerySchema>;

export const receiptSchema = z.object({
  sale: saleSchema,
  merchant: z.object({ nameEn: z.string().nullable(), nameAr: z.string().nullable() }),
  branch: z.object({
    nameEn: z.string().nullable(),
    nameAr: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    receiptHeader: z.string().nullable(),
    receiptFooter: z.string().nullable(),
  }),
  register: z.object({
    code: z.string(),
    nameEn: z.string().nullable(),
    nameAr: z.string().nullable(),
  }),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const suspendedOrderSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
  cashierName: z.string(),
  lineCount: z.number().int(),
  lines: z.array(
    z.object({
      variantId: z.string(),
      quantity: z.string(),
      priceOverride: moneySchema.nullable(),
      discount: discountInputSchema.nullable(),
    }),
  ),
  orderDiscount: discountInputSchema.nullable(),
  customer: saleCustomerSchema.nullable(),
  version: z.number().int(),
});
export type SuspendedOrder = z.infer<typeof suspendedOrderSchema>;
export const suspendedOrderListSchema = z.object({ orders: z.array(suspendedOrderSchema) });

export const salesSettingsSchema = z.object({
  maxDiscountPercent: z.string(),
  refundWindowDays: z.number().int(),
  refundApprovalLimit: moneySchema,
  /** Cashiers count the drawer without seeing the expected balance (BR-162). */
  blindCashCount: z.boolean(),
  /** "Other" cash-out above this amount waits for a manager (BR-164). */
  cashOutOtherLimit: moneySchema,
  /** "Other" cash-outs of one shift above this total wait for a manager (BR-164). */
  cashOutOtherShiftLimit: moneySchema,
  /** Largest discrepancy tolerance a register may be given (BR-164). */
  maxRegisterTolerance: moneySchema,
  /** Expenses above this amount wait for a second person (BR-166). */
  expenseApprovalLimit: moneySchema,
  /** Supplier payments above this amount wait for a second person (BR-166). */
  supplierPaymentApprovalLimit: moneySchema,
  /** Stock adjustments above this value at cost wait for a second person (BR-169). */
  adjustmentApprovalLimit: moneySchema,
  /** Count sheets hide the expected quantity (BR-170). */
  blindStockCount: z.boolean(),
  version: z.number().int(),
});
export type SalesSettings = z.infer<typeof salesSettingsSchema>;
export const updateSalesSettingsSchema = z.object({
  maxDiscountPercent: z
    .string()
    .trim()
    .regex(/^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/),
  refundWindowDays: z.number().int().min(0).max(3650),
  refundApprovalLimit: moneyAmountSchema,
  blindCashCount: z.boolean(),
  cashOutOtherLimit: moneyAmountSchema,
  cashOutOtherShiftLimit: moneyAmountSchema,
  maxRegisterTolerance: moneyAmountSchema,
  expenseApprovalLimit: moneyAmountSchema,
  supplierPaymentApprovalLimit: moneyAmountSchema,
  /** Omitted = unchanged. */
  adjustmentApprovalLimit: moneyAmountSchema.optional(),
  blindStockCount: z.boolean().optional(),
  version: z.number().int().positive(),
});
