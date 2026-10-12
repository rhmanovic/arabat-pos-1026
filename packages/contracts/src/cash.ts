import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';
import { CASH_EXPENSE_CATEGORIES, denominationSchema } from './payments.js';

/**
 * Cash custody (ADR-0090): register drawers and branch treasuries are accounts of one cash
 * ledger. Transfers move cash between them and never count as sales, revenue or expenses.
 */
const note = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

const names = { nameEn: z.string().nullable(), nameAr: z.string().nullable() };

export const cashRegisterBalanceSchema = z.object({
  accountId: z.string(),
  registerId: z.string(),
  code: z.string(),
  ...names,
  status: z.enum(['active', 'inactive']),
  balance: moneySchema,
  /** No verified count yet, or the last shift was force-closed without a count. */
  needsCount: z.boolean(),
  openShift: z
    .object({ id: z.string(), employeeName: z.string(), openedAt: z.string() })
    .nullable(),
});
export type CashRegisterBalance = z.infer<typeof cashRegisterBalanceSchema>;

export const cashBranchSchema = z.object({
  branchId: z.string(),
  ...names,
  treasury: z.object({
    accountId: z.string(),
    ...names,
    balance: moneySchema,
    /** null until the first physical count («رصيد افتتاحي بالجرد»). */
    countedAt: z.string().nullable(),
  }),
  registers: z.array(cashRegisterBalanceSchema),
  total: moneySchema,
});
export type CashBranch = z.infer<typeof cashBranchSchema>;

export const cashOverviewSchema = z.object({
  branches: z.array(cashBranchSchema),
  treasuriesTotal: moneySchema,
  registersTotal: moneySchema,
  /** Cash sent between branches and not yet received (ADR-0091). */
  inTransitTotal: moneySchema,
  /** All treasuries + all drawers (+ cash in transit) in scope: the company's cash on hand. */
  total: moneySchema,
});
export type CashOverview = z.infer<typeof cashOverviewSchema>;

export const cashEntrySchema = z.object({
  id: z.string(),
  amount: moneySchema,
  /** Running balance after this entry. */
  balance: moneySchema,
  entryType: z.string(),
  sourceType: z.string(),
  description: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type CashEntry = z.infer<typeof cashEntrySchema>;
export const cashStatementSchema = z.object({
  account: z.object({
    id: z.string(),
    kind: z.string(),
    ...names,
    branchId: z.string().nullable(),
    balance: moneySchema,
  }),
  entries: z.array(cashEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CashStatement = z.infer<typeof cashStatementSchema>;
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const createCashTransferSchema = z.object({
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  amount: moneyAmountSchema,
  note: note(500),
  idempotencyKey: z.uuid(),
});
export type CreateCashTransfer = z.input<typeof createCashTransferSchema>;

export const cashTransferSchema = z.object({
  id: z.string(),
  from: z.object({ accountId: z.string(), kind: z.string(), ...names }),
  to: z.object({ accountId: z.string(), kind: z.string(), ...names }),
  branchId: z.string().nullable(),
  amount: moneySchema,
  /**
   * pos_movement: a cashier's drop, top-up or deposit; manager: from the cash custody page;
   * deposit: a bank deposit from a treasury; branch_transfer: a step of a branch transfer.
   */
  origin: z.enum(['pos_movement', 'manager', 'deposit', 'branch_transfer']),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type CashTransfer = z.infer<typeof cashTransferSchema>;
export const cashTransferListSchema = z.object({
  transfers: z.array(cashTransferSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const cashTransferQuerySchema = pageQuerySchema.extend({
  branchId: z.uuid().optional(),
});

/**
 * A physical count of a treasury, or of a drawer with no open shift. `expectedCash` is the
 * balance the counter was shown; a balance that changed meanwhile is refused.
 */
export const cashCountSchema = z.object({
  countedCash: moneyAmountSchema,
  expectedCash: moneyAmountSchema,
  breakdown: z.array(denominationSchema).max(30).optional(),
  note: note(1000),
});
export type CashCount = z.input<typeof cashCountSchema>;

// ---------------------------------------------------------------- phase B (ADR-0091)
const dateParam = z.iso.date().optional();
const ref = z.object({ id: z.string(), ...names });

/** A real cash outflow: an operating expense or a payment to a supplier. */
export const cashDisbursementSchema = z.object({
  id: z.string(),
  number: z.string(),
  kind: z.enum(['expense', 'supplier_payment']),
  category: z.enum(CASH_EXPENSE_CATEGORIES).nullable(),
  supplier: ref.nullable(),
  purchaseOrder: z.object({ id: z.string(), number: z.string() }).nullable(),
  branch: ref,
  source: z.object({ accountId: z.string(), kind: z.enum(['register', 'treasury']), ...names }),
  shiftId: z.string().nullable(),
  amount: moneySchema,
  description: z.string().nullable(),
  receiptReference: z.string().nullable(),
  /** Set on a reversal: the record it cancels. */
  reversesId: z.string().nullable(),
  /** Set on a record that has been reversed. */
  reversedById: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type CashDisbursement = z.infer<typeof cashDisbursementSchema>;
export const cashDisbursementListSchema = z.object({
  disbursements: z.array(cashDisbursementSchema),
  /** Net paid out by the listed filter (reversals subtracted). */
  netTotal: moneySchema,
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CashDisbursementList = z.infer<typeof cashDisbursementListSchema>;
export const cashDisbursementQuerySchema = pageQuerySchema.extend({
  kind: z.enum(['expense', 'supplier_payment']).optional(),
  category: z.enum(CASH_EXPENSE_CATEGORIES).optional(),
  supplierId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  from: dateParam,
  to: dateParam,
});
export type CashDisbursementQuery = z.input<typeof cashDisbursementQuerySchema>;

/** A manager pays from a branch treasury (payments from a drawer are made at the POS). */
export const createCashDisbursementSchema = z
  .object({
    branchId: z.uuid(),
    kind: z.enum(['expense', 'supplier_payment']),
    category: z.enum(CASH_EXPENSE_CATEGORIES).optional(),
    supplierId: z.uuid().optional(),
    purchaseOrderId: z.uuid().optional(),
    amount: moneyAmountSchema,
    description: note(500),
    receiptReference: note(80),
    idempotencyKey: z.uuid(),
  })
  .refine((d) => d.kind !== 'expense' || Boolean(d.category), {
    error: 'Choose the expense category.',
    path: ['category'],
  })
  .refine((d) => d.category !== 'other' || Boolean(d.description), {
    error: 'Describe the expense.',
    path: ['description'],
  })
  .refine((d) => d.kind !== 'supplier_payment' || Boolean(d.supplierId), {
    error: 'Choose the supplier.',
    path: ['supplierId'],
  });
export type CreateCashDisbursement = z.input<typeof createCashDisbursementSchema>;
export const reverseCashDisbursementSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.uuid(),
});
export type ReverseCashDisbursement = z.input<typeof reverseCashDisbursementSchema>;

/** Supplier page: what was paid to one supplier in cash. */
export const supplierPaymentsSchema = z.object({
  payments: z.array(cashDisbursementSchema),
  totalPaid: moneySchema,
});
export type SupplierPayments = z.infer<typeof supplierPaymentsSchema>;

/** A manager deposits cash from a branch treasury into a bank account (`cash.deposit`). */
export const createBankDepositSchema = z.object({
  fromAccountId: z.uuid(),
  bankAccountId: z.uuid(),
  amount: moneyAmountSchema,
  reference: note(80),
  note: note(500),
  idempotencyKey: z.uuid(),
});
export type CreateBankDeposit = z.input<typeof createBankDepositSchema>;

export const bankAccountOptionSchema = z.object({ id: z.string(), ...names });
export const bankAccountOptionsSchema = z.object({ accounts: z.array(bankAccountOptionSchema) });
export type BankAccountOption = z.infer<typeof bankAccountOptionSchema>;
export const supplierOptionsSchema = z.object({
  suppliers: z.array(z.object({ id: z.string(), code: z.string().nullable(), ...names })),
});
export type SupplierOptions = z.infer<typeof supplierOptionsSchema>;

export const BRANCH_TRANSFER_STATUSES = ['in_transit', 'received', 'cancelled'] as const;
export const cashBranchTransferSchema = z.object({
  id: z.string(),
  number: z.string(),
  fromBranch: ref,
  toBranch: ref,
  amountSent: moneySchema,
  amountReceived: moneySchema.nullable(),
  /** received − sent; null until received. */
  difference: moneySchema.nullable(),
  status: z.enum(BRANCH_TRANSFER_STATUSES),
  sendNote: z.string().nullable(),
  receiveNote: z.string().nullable(),
  cancelNote: z.string().nullable(),
  sentBy: z.string(),
  sentAt: z.string(),
  receivedBy: z.string().nullable(),
  receivedAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  version: z.number().int(),
});
export type CashBranchTransfer = z.infer<typeof cashBranchTransferSchema>;
export const cashBranchTransferListSchema = z.object({
  transfers: z.array(cashBranchTransferSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const cashBranchTransferQuerySchema = pageQuerySchema.extend({
  status: z.enum(BRANCH_TRANSFER_STATUSES).optional(),
  branchId: z.uuid().optional(),
});
export const createCashBranchTransferSchema = z
  .object({
    fromBranchId: z.uuid(),
    toBranchId: z.uuid(),
    amount: moneyAmountSchema,
    note: note(500),
    idempotencyKey: z.uuid(),
  })
  .refine((t) => t.fromBranchId !== t.toBranchId, {
    error: 'Choose a different branch.',
    path: ['toBranchId'],
  });
export type CreateCashBranchTransfer = z.input<typeof createCashBranchTransferSchema>;
/** The receiving branch confirms the amount it actually counted. */
export const receiveCashBranchTransferSchema = z.object({
  receivedAmount: moneyAmountSchema,
  note: note(500),
  version: z.number().int().positive(),
});
export type ReceiveCashBranchTransfer = z.input<typeof receiveCashBranchTransferSchema>;
export const cancelCashBranchTransferSchema = z.object({
  note: z.string().trim().min(1).max(500),
  version: z.number().int().positive(),
});
export type CancelCashBranchTransfer = z.input<typeof cancelCashBranchTransferSchema>;
