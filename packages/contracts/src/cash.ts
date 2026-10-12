import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';
import { denominationSchema } from './payments.js';

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
  /** All treasuries + all drawers in scope: the company's cash on hand. */
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
  /** pos_movement: a cashier's drop or top-up; manager: from the cash custody page. */
  origin: z.enum(['pos_movement', 'manager']),
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
