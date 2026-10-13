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
  /** Cash deposited and not yet confirmed on the bank side (BR-168); no longer cash on hand. */
  depositsInTransitTotal: moneySchema,
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
const zero = { amount: '0.000', currency: 'KWD' };
/**
 * Statement of one treasury or drawer. With a period (BR-184) the entries are those of the
 * local days [from, to] in the merchant's time zone, with the balance brought forward.
 */
export const cashStatementSchema = z.object({
  account: z.object({
    id: z.string(),
    kind: z.string(),
    ...names,
    branchId: z.string().nullable(),
    balance: moneySchema,
  }),
  period: z
    .object({ from: z.string(), to: z.string(), timezone: z.string() })
    .nullable()
    .default(null),
  /** Balance before the first day of the period (0 without a period). */
  openingBalance: moneySchema.default(zero),
  /** Sum of the positive / negative entries of the period. */
  totalIn: moneySchema.default(zero),
  totalOut: moneySchema.default(zero),
  /** Balance at the end of the period (the current balance without a period). */
  closingBalance: moneySchema.default(zero),
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
export const cashStatementQuerySchema = pageQuerySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type CashStatementQuery = z.input<typeof cashStatementQuerySchema>;

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
   * deposit: a bank deposit from a treasury; branch_transfer: a step of a branch transfer;
   * deposit_confirmation / deposit_return: a deposit in transit confirmed by the bank or
   * returned to the treasury (BR-168).
   */
  origin: z.enum([
    'pos_movement',
    'manager',
    'deposit',
    'branch_transfer',
    'deposit_confirmation',
    'deposit_return',
  ]),
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
    /** Owner only: pay more than the order's value on purpose (audited, BR-166). */
    confirmOverpayment: z.boolean().optional(),
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

// ---------------------------------------------------------------- payout requests (BR-166)
export const PAYOUT_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export const cashPayoutRequestSchema = z.object({
  id: z.string(),
  kind: z.enum(['expense', 'supplier_payment']),
  category: z.enum(CASH_EXPENSE_CATEGORIES).nullable(),
  supplier: ref.nullable(),
  purchaseOrder: z.object({ id: z.string(), number: z.string() }).nullable(),
  branch: ref,
  amount: moneySchema,
  description: z.string().nullable(),
  receiptReference: z.string().nullable(),
  status: z.enum(PAYOUT_REQUEST_STATUSES),
  requestedBy: z.string(),
  requestedByUserId: z.string(),
  createdAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  disbursementId: z.string().nullable(),
});
export type CashPayoutRequest = z.infer<typeof cashPayoutRequestSchema>;
export const cashPayoutRequestListSchema = z.object({ requests: z.array(cashPayoutRequestSchema) });
export const cashPayoutRequestQuerySchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(['pending', 'all']).default('pending'),
});
export type CashPayoutRequestQuery = z.input<typeof cashPayoutRequestQuerySchema>;
export const decidePayoutRequestSchema = z
  .object({ decision: z.enum(['approve', 'reject']), note: note(500) })
  .refine((d) => d.decision !== 'reject' || Boolean(d.note), {
    error: 'Explain why the payment is rejected.',
    path: ['note'],
  });
export type DecidePayoutRequest = z.input<typeof decidePayoutRequestSchema>;

// ---------------------------------------------------------------- variance follow-up (BR-167)
export const VARIANCE_SOURCES = [
  'shift_close',
  'shift_opening',
  'account_count',
  'branch_transfer',
] as const;
export const VARIANCE_STATUSES = ['explained', 'settled', 'written_off'] as const;
export const cashVarianceSchema = z.object({
  sourceType: z.enum(VARIANCE_SOURCES),
  sourceId: z.string(),
  branchId: z.string(),
  /** Register, treasury or transfer the difference belongs to. */
  place: z.object({ ...names, kind: z.enum(['register', 'treasury', 'transfer']) }),
  /** counted − expected (or received − sent). */
  amount: moneySchema,
  occurredAt: z.string(),
  /** Who is answerable: the cashier of the shift, the counter, or null when between shifts. */
  accountable: z.string().nullable(),
  sourceNote: z.string().nullable(),
  followup: z
    .object({
      status: z.enum(VARIANCE_STATUSES),
      note: z.string(),
      resolvedBy: z.string(),
      resolvedAt: z.string(),
    })
    .nullable(),
});
export type CashVariance = z.infer<typeof cashVarianceSchema>;
export const cashVarianceListSchema = z.object({
  variances: z.array(cashVarianceSchema),
  openCount: z.number().int(),
});
export const cashVarianceQuerySchema = z.object({
  branchId: z.uuid().optional(),
  status: z.enum(['open', 'resolved', 'all']).default('open'),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type CashVarianceQuery = z.input<typeof cashVarianceQuerySchema>;
export const resolveVarianceSchema = z.object({
  status: z.enum(VARIANCE_STATUSES),
  note: z.string().trim().min(1).max(1000),
});
export type ResolveVariance = z.input<typeof resolveVarianceSchema>;

/** Supplier page: what was paid to one supplier in cash. */
export const supplierPaymentsSchema = z.object({
  payments: z.array(cashDisbursementSchema),
  totalPaid: moneySchema,
});
export type SupplierPayments = z.infer<typeof supplierPaymentsSchema>;

/**
 * Supplier statement (BR-188, bridge until supplier accounts payable): goods received at order
 * cost against cash paid, with the running difference "received − paid" (positive = still
 * owed to the supplier). Period by the merchant's local days (BR-184).
 */
export const supplierStatementQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type SupplierStatementQuery = z.input<typeof supplierStatementQuerySchema>;
export const supplierStatementLineSchema = z.object({
  id: z.string(),
  kind: z.enum(['receipt', 'payment', 'reversal']),
  occurredAt: z.string(),
  /** Receipt number, or the payment number. */
  document: z.string(),
  /** The purchase order concerned, when known. */
  orderNumber: z.string().nullable(),
  reference: z.string().nullable(),
  branchId: z.string(),
  received: moneySchema,
  /** Negative for a reversal. */
  paid: moneySchema,
  /** received − paid, cumulative, after this line. */
  balance: moneySchema,
  createdBy: z.string().nullable(),
});
export const supplierStatementSchema = z.object({
  supplier: z.object({ id: z.string(), ...names }),
  period: z.object({ from: z.string(), to: z.string(), timezone: z.string() }).nullable(),
  /** received − paid before the period (0 without a period). */
  openingBalance: moneySchema,
  totals: z.object({
    received: moneySchema,
    paid: moneySchema,
    reversed: moneySchema,
    /** openingBalance + received − paid, at the end of the period. */
    closingBalance: moneySchema,
  }),
  lines: z.array(supplierStatementLineSchema),
});
export type SupplierStatement = z.infer<typeof supplierStatementSchema>;

/**
 * A manager deposits cash from a branch treasury towards a bank account (`cash.deposit`). The
 * cash waits in "deposits in transit" until a second person confirms it on the bank side; the
 * deposit slip number is mandatory (BR-168).
 */
export const createBankDepositSchema = z.object({
  fromAccountId: z.uuid(),
  bankAccountId: z.uuid(),
  amount: moneyAmountSchema,
  reference: z.string().trim().min(1, 'Enter the deposit slip number.').max(80),
  note: note(500),
  idempotencyKey: z.uuid(),
});
export type CreateBankDeposit = z.input<typeof createBankDepositSchema>;

// ---------------------------------------------------------------- deposits in transit (BR-168)
/** A deposit recorded at the POS or by a manager and not yet confirmed on the bank side. */
export const depositInTransitSchema = z.object({
  id: z.string(),
  from: z.object({ accountId: z.string(), kind: z.enum(['register', 'treasury']), ...names }),
  branchId: z.string(),
  bank: z.object({ id: z.string(), ...names }),
  amount: moneySchema,
  /** The deposit slip number. */
  reference: z.string(),
  note: z.string().nullable(),
  createdBy: z.string(),
  createdByUserId: z.string(),
  createdAt: z.string(),
});
export type DepositInTransit = z.infer<typeof depositInTransitSchema>;
export const depositInTransitListSchema = z.object({
  deposits: z.array(depositInTransitSchema),
  total: moneySchema,
});
export type DepositInTransitList = z.infer<typeof depositInTransitListSchema>;
export const depositInTransitQuerySchema = z.object({ branchId: z.uuid().optional() });
/**
 * Settles a deposit in transit: `confirm` moves it into its bank account (with the bank's
 * reference), `return` moves it back into the branch treasury with a reason. Nobody settles
 * their own deposit; the owner may, and the exception is recorded.
 */
export const settleDepositSchema = z
  .object({
    decision: z.enum(['confirm', 'return']),
    reference: note(80),
    note: note(500),
  })
  .refine((d) => d.decision !== 'return' || Boolean(d.note), {
    error: 'Explain why the deposit is returned.',
    path: ['note'],
  });
export type SettleDeposit = z.input<typeof settleDepositSchema>;

// ---------------------------------------------------------------- bank reconciliation (BR-168)
export const bankEntrySchema = z.object({
  id: z.string(),
  amount: moneySchema,
  entryType: z.string(),
  sourceType: z.string(),
  description: z.string().nullable(),
  /** Deposit slip or bank reference carried by the transfer, when there is one. */
  reference: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type BankEntry = z.infer<typeof bankEntrySchema>;
export const bankReconciliationSchema = z.object({
  id: z.string(),
  statementDate: z.string(),
  statementBalance: moneySchema,
  bookBalance: moneySchema,
  clearedBalance: moneySchema,
  /** statement − cleared; a non-zero difference carries an explanation. */
  difference: moneySchema,
  itemCount: z.number().int(),
  note: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type BankReconciliation = z.infer<typeof bankReconciliationSchema>;
/** Everything needed to reconcile one bank account against its statement. */
export const bankReconciliationStateSchema = z.object({
  account: z.object({ id: z.string(), ...names, status: z.enum(['active', 'inactive']) }),
  bookBalance: moneySchema,
  /** Sum of every entry reconciled so far. */
  clearedBalance: moneySchema,
  /** Ledger entries that appeared on no statement yet, oldest first. */
  unreconciled: z.array(bankEntrySchema),
  last: bankReconciliationSchema.nullable(),
  history: z.array(bankReconciliationSchema),
});
export type BankReconciliationState = z.infer<typeof bankReconciliationStateSchema>;
export const signedAmountSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,10}(\.\d{1,3})?$/, { error: 'Enter an amount with up to 3 decimal places.' });
export const createBankReconciliationSchema = z.object({
  statementDate: z.iso.date(),
  statementBalance: signedAmountSchema,
  /** The unreconciled entries that appear on the statement. */
  entryIds: z.array(z.uuid()).max(1000),
  note: note(1000),
});
export type CreateBankReconciliation = z.input<typeof createBankReconciliationSchema>;

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
