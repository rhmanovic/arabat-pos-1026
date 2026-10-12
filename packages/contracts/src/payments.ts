import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));
const nameRequired = (v: { nameEn?: string | null; nameAr?: string | null }) =>
  Boolean(v.nameAr || v.nameEn);

/** Fee percentage: up to 100 with at most 3 decimals ("2.5"). */
export const feePercentSchema = z
  .string()
  .trim()
  .regex(/^(100(\.0{1,3})?|\d{1,2}(\.\d{1,3})?)$/, {
    error: 'Enter a percentage from 0 to 100 with up to 3 decimals.',
  });

// ---------------------------------------------------------------- financial accounts
export const FINANCIAL_ACCOUNT_KINDS = [
  'cash',
  'bank',
  'card_clearing',
  'wallet',
  'other',
] as const;
export const financialAccountSchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  kind: z.enum(FINANCIAL_ACCOUNT_KINDS),
  currency: z.string(),
  status: z.enum(['active', 'inactive']),
  balance: moneySchema,
  version: z.number().int(),
});
export type FinancialAccount = z.infer<typeof financialAccountSchema>;
export const financialAccountListSchema = z.object({ accounts: z.array(financialAccountSchema) });
export const saveFinancialAccountSchema = z
  .object({
    nameEn: text(80),
    nameAr: text(80),
    kind: z.enum(FINANCIAL_ACCOUNT_KINDS),
    status: z.enum(['active', 'inactive']).default('active'),
    version: z.number().int().positive().optional(),
  })
  .refine(nameRequired, { error: 'A name is required.', path: ['nameAr'] });
export type SaveFinancialAccount = z.input<typeof saveFinancialAccountSchema>;

// ---------------------------------------------------------------- payment methods
export const PAYMENT_METHOD_KINDS = ['cash', 'card', 'bank_transfer', 'custom'] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];
export const FEE_TYPES = ['none', 'fixed', 'percentage', 'fixed_plus_percentage'] as const;
export const GATEWAY_PROVIDERS = ['tap', 'upayments', 'hesabe', 'bookeey', 'mock'] as const;

export const paymentMethodSchema = z.object({
  id: z.string(),
  kind: z.enum(PAYMENT_METHOD_KINDS),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
  availableInPos: z.boolean(),
  availableOnline: z.boolean(),
  feeType: z.enum(FEE_TYPES),
  feeFixed: moneySchema,
  feePercent: z.string(),
  financialAccountId: z.string().nullable(),
  gatewayProvider: z.enum(GATEWAY_PROVIDERS).nullable(),
  /** Always false until a gateway integration is implemented and approved. */
  gatewayLive: z.literal(false),
  sortOrder: z.number().int(),
  version: z.number().int(),
});
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export const paymentMethodListSchema = z.object({ methods: z.array(paymentMethodSchema) });

export const savePaymentMethodSchema = z
  .object({
    kind: z.enum(PAYMENT_METHOD_KINDS),
    nameEn: text(80),
    nameAr: text(80),
    status: z.enum(['active', 'inactive']).default('active'),
    availableInPos: z.boolean().default(true),
    availableOnline: z.boolean().default(false),
    feeType: z.enum(FEE_TYPES).default('none'),
    feeFixed: moneyAmountSchema.default('0'),
    feePercent: feePercentSchema.default('0'),
    financialAccountId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    gatewayProvider: z
      .enum(GATEWAY_PROVIDERS)
      .nullish()
      .transform((v) => v ?? null),
    sortOrder: z.number().int().min(0).max(1000).default(0),
    version: z.number().int().positive().optional(),
  })
  .refine(nameRequired, { error: 'A name is required.', path: ['nameAr'] })
  .refine((m) => m.kind !== 'cash' || m.gatewayProvider === null, {
    error: 'Cash cannot use a payment gateway.',
    path: ['gatewayProvider'],
  });
export type SavePaymentMethod = z.input<typeof savePaymentMethodSchema>;

export const posPaymentMethodSchema = z.object({
  id: z.string(),
  kind: z.enum(PAYMENT_METHOD_KINDS),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  sortOrder: z.number().int(),
});
export const posPaymentMethodListSchema = z.object({ methods: z.array(posPaymentMethodSchema) });

// ---------------------------------------------------------------- registers
export const registerSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  code: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
  accessMode: z.enum(['branch', 'restricted']),
  memberIds: z.array(z.string()),
  defaultOpeningFloat: moneySchema,
  discrepancyTolerance: moneySchema,
  openShift: z
    .object({ id: z.string(), employeeName: z.string(), openedAt: z.string() })
    .nullable(),
  version: z.number().int(),
});
export type Register = z.infer<typeof registerSchema>;
export const registerListSchema = z.object({ registers: z.array(registerSchema) });
export const saveRegisterSchema = z
  .object({
    branchId: z.uuid(),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,20}$/, { error: 'Code: 1–20 letters, digits, - or _.' }),
    nameEn: text(80),
    nameAr: text(80),
    accessMode: z.enum(['branch', 'restricted']).default('branch'),
    memberIds: z.array(z.uuid()).max(200).default([]),
    defaultOpeningFloat: moneyAmountSchema.default('0'),
    discrepancyTolerance: moneyAmountSchema.default('0'),
    version: z.number().int().positive().optional(),
  })
  .refine(nameRequired, { error: 'A name is required.', path: ['nameAr'] });
export type SaveRegister = z.input<typeof saveRegisterSchema>;
export const registerStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });

// ---------------------------------------------------------------- shifts
export const CASH_IN_REASONS = ['float_top_up', 'change_received', 'correction', 'other'] as const;
export const CASH_OUT_REASONS = [
  'safe_drop',
  'bank_deposit',
  'petty_expense',
  'supplier_payment',
  'correction',
  'other',
] as const;

export const cashMovementSchema = z.object({
  id: z.string(),
  kind: z.enum(['cash_in', 'cash_out']),
  amount: moneySchema,
  reason: z.string(),
  note: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type CashMovement = z.infer<typeof cashMovementSchema>;

export const denominationSchema = z.object({
  value: moneyAmountSchema,
  count: z.number().int().min(0).max(100000),
});

/** Cash reconciliation of a shift; every figure is derived from records, never typed in. */
export const shiftSummarySchema = z.object({
  openingFloat: moneySchema,
  cashIn: moneySchema,
  cashOut: moneySchema,
  /** Cash taken from sales (from Prompt 10). */
  cashSales: moneySchema,
  /** Cash paid back on refunds (from Prompt 11). */
  cashRefunds: moneySchema,
  expectedCash: moneySchema,
});

export const shiftSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  registerId: z.string(),
  registerName: z.object({ nameEn: z.string().nullable(), nameAr: z.string().nullable() }),
  membershipId: z.string(),
  employeeName: z.string(),
  status: z.enum(['open', 'closed']),
  openedAt: z.string(),
  openingNote: z.string().nullable(),
  closedAt: z.string().nullable(),
  closedByName: z.string().nullable(),
  closeType: z.enum(['normal', 'forced']).nullable(),
  summary: shiftSummarySchema,
  countedCash: moneySchema.nullable(),
  discrepancy: moneySchema.nullable(),
  /** balanced (within tolerance) | over | short — closed shifts only */
  outcome: z.enum(['balanced', 'over', 'short']).nullable(),
  countedBreakdown: z.array(denominationSchema).nullable(),
  closingNote: z.string().nullable(),
  movements: z.array(cashMovementSchema),
  version: z.number().int(),
});
export type Shift = z.infer<typeof shiftSchema>;

export const shiftSummaryRowSchema = shiftSchema.omit({ movements: true, countedBreakdown: true });
export type ShiftRow = z.infer<typeof shiftSummaryRowSchema>;
export const shiftListSchema = z.object({
  shifts: z.array(shiftSummaryRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
const isoDate = z.iso.date();
export const shiftListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  registerId: z.uuid().optional(),
  status: z.enum(['open', 'closed', 'all']).default('all'),
  outcome: z.enum(['balanced', 'over', 'short', 'discrepancy']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ShiftListQuery = z.input<typeof shiftListQuerySchema>;

export const discrepancyReportQuerySchema = z.object({
  branchId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type DiscrepancyReportQuery = z.input<typeof discrepancyReportQuerySchema>;
const discrepancyTotals = {
  shifts: z.number().int(),
  balanced: z.number().int(),
  over: z.number().int(),
  short: z.number().int(),
  totalOver: moneySchema,
  totalShort: moneySchema,
  net: moneySchema,
};
export const discrepancyReportSchema = z.object({
  totals: z.object(discrepancyTotals),
  byEmployee: z.array(
    z.object({ membershipId: z.string(), employeeName: z.string(), ...discrepancyTotals }),
  ),
  byRegister: z.array(
    z.object({
      registerId: z.string(),
      branchId: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      ...discrepancyTotals,
    }),
  ),
});
export type DiscrepancyReport = z.infer<typeof discrepancyReportSchema>;

export const openShiftSchema = z.object({
  registerId: z.uuid(),
  openingFloat: moneyAmountSchema,
  note: text(500),
});
export type OpenShift = z.input<typeof openShiftSchema>;

export const recordCashMovementSchema = z
  .object({
    kind: z.enum(['cash_in', 'cash_out']),
    amount: moneyAmountSchema,
    reason: z.string().trim().min(1).max(40),
    note: text(500),
    idempotencyKey: z.uuid().optional(),
  })
  .refine(
    (m) =>
      ((m.kind === 'cash_in' ? CASH_IN_REASONS : CASH_OUT_REASONS) as readonly string[]).includes(
        m.reason,
      ),
    { error: 'This reason is not valid for the movement.', path: ['reason'] },
  )
  .refine((m) => m.reason !== 'other' || Boolean(m.note), {
    error: 'Add a note explaining the movement.',
    path: ['note'],
  });
export type RecordCashMovement = z.input<typeof recordCashMovementSchema>;

export const closeShiftSchema = z.object({
  countedCash: moneyAmountSchema,
  breakdown: z.array(denominationSchema).max(30).optional(),
  note: text(1000),
  /** Optimistic lock: the shift version the closer reviewed. */
  version: z.number().int().positive(),
});
export type CloseShift = z.input<typeof closeShiftSchema>;

export const posRegisterSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  defaultOpeningFloat: moneySchema,
  /** free | mine | occupied */
  availability: z.enum(['free', 'mine', 'occupied']),
  occupiedBy: z.string().nullable(),
});
export const posRegisterListSchema = z.object({ registers: z.array(posRegisterSchema) });
export const currentShiftSchema = z.object({ shift: shiftSchema.nullable() });
