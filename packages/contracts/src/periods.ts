import { z } from 'zod';
import { moneySchema } from './catalog.js';

/**
 * Period close (BR-189, remediation R4.2): a month is closed once with a stored pack of the
 * figures an accountant needs, and accepts no document dated inside it afterwards. Months are
 * the merchant's local calendar months (BR-184).
 */
export const periodKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'A period is a month like 2026-09.' });
export type PeriodKey = z.infer<typeof periodKeySchema>;

export const PERIOD_STATUSES = ['closed', 'closable', 'open', 'current'] as const;

export const periodSummarySchema = z.object({
  period: z.string(),
  from: z.string(),
  to: z.string(),
  /**
   * closed: pack stored and locked; closable: ended and next in line; open: ended but an
   * earlier month is still open; current: not ended yet.
   */
  status: z.enum(PERIOD_STATUSES),
  closedAt: z.string().nullable(),
  closedBy: z.string().nullable(),
  note: z.string().nullable(),
});
export type PeriodSummary = z.infer<typeof periodSummarySchema>;
export const periodListSchema = z.object({
  timezone: z.string(),
  periods: z.array(periodSummarySchema),
});
export type PeriodList = z.infer<typeof periodListSchema>;

const named = { nameEn: z.string().nullable(), nameAr: z.string().nullable() };

/** The month-end pack: computed live for an open month, stored at close for a closed one. */
export const periodPackSchema = z.object({
  period: z.string(),
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  status: z.enum(PERIOD_STATUSES),
  closedAt: z.string().nullable(),
  closedBy: z.string().nullable(),
  note: z.string().nullable(),
  /** When the figures were computed (close time for a closed month). */
  computedAt: z.string(),
  sales: z.object({
    saleCount: z.number().int(),
    gross: moneySchema,
    discounts: moneySchema,
    netSales: moneySchema,
    refundCount: z.number().int(),
    refunds: moneySchema,
    netAfterRefunds: moneySchema,
  }),
  /** Gross profit on the costed part (BR-185); null without `reports.financial`. */
  profit: z
    .object({
      available: z.boolean(),
      costOfSales: moneySchema,
      grossProfit: moneySchema,
      marginPercent: z.string().nullable(),
      uncostedSales: moneySchema,
    })
    .nullable(),
  collections: z.array(
    z.object({
      kind: z.string(),
      methodId: z.string().nullable(),
      ...named,
      collected: moneySchema,
      fees: moneySchema,
      feesReversed: moneySchema,
      refunded: moneySchema,
      net: moneySchema,
    }),
  ),
  collectionTotals: z.object({
    collected: moneySchema,
    fees: moneySchema,
    feesReversed: moneySchema,
    refunded: moneySchema,
    netAfterFees: moneySchema,
  }),
  /** Card / transfer tenders recorded without a reference in the month (BR-181). */
  unreferencedTenders: z.object({ count: z.number().int(), amount: moneySchema }),
  /** Cash by place as at the end of the month, from the cash ledger (ADR-0090). */
  cash: z.object({
    places: z.array(
      z.object({
        accountId: z.string(),
        kind: z.enum(['treasury', 'register']),
        branchId: z.string(),
        ...named,
        balance: moneySchema,
      }),
    ),
    treasuriesTotal: moneySchema,
    registersTotal: moneySchema,
    /** Between branches, and deposited but not yet confirmed, at computation time. */
    inTransitTotal: moneySchema,
    depositsInTransitTotal: moneySchema,
    total: moneySchema,
  }),
  /** Closing stock at the end of the month, reconstructed from the ledger (BR-176). */
  stock: z.object({
    closingQuantity: z.string(),
    closingValue: moneySchema,
    unvaluedItems: z.number().int(),
    inTransit: z.object({ transfers: z.number().int(), quantity: z.string(), value: moneySchema }),
  }),
  /** Refund requests approved or waiting that were not paid at computation time. */
  refundsOwed: z.object({ count: z.number().int(), amount: moneySchema }),
  /** Open items at computation time: what the next month inherits. */
  open: z.object({
    variances: z.number().int(),
    transfersInTransit: z.number().int(),
    pendingRefunds: z.number().int(),
    pendingAdjustments: z.number().int(),
    pendingPayoutRequests: z.number().int(),
    pendingCashMovements: z.number().int(),
    pendingTransferLosses: z.number().int(),
    heldSales: z.number().int(),
  }),
  /** Goods received at order cost − cash paid, cumulative to the end of the month (BR-188). */
  suppliers: z.object({ received: moneySchema, paid: moneySchema, balance: moneySchema }),
  /** Documents dated in the month. */
  documents: z.object({
    sales: z.number().int(),
    refunds: z.number().int(),
    receipts: z.number().int(),
    disbursements: z.number().int(),
    purchaseOrders: z.number().int(),
  }),
});
export type PeriodPack = z.infer<typeof periodPackSchema>;

export const closePeriodSchema = z.object({
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v)),
});
export type ClosePeriod = z.input<typeof closePeriodSchema>;
