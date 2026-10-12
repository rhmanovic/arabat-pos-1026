import { z } from 'zod';
import { moneySchema } from './catalog.js';

/**
 * Reporting contracts (Prompt 14). Metric definitions live in BUSINESS_RULES.md §3
 * (BR-120…BR-129); every amount is exact (integer fils on the server, decimal strings on
 * the wire) and every period uses the merchant's local calendar days.
 */
const isoDate = z.iso.date();
const MAX_DAYS = 366;

export const reportQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    branchId: z.uuid().optional(),
    /** Membership id of an employee (sales, payments and shift reports). */
    employeeId: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, {
    error: 'The start date must not be after the end date.',
    path: ['to'],
  })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_DAYS, {
    error: `A report covers at most ${MAX_DAYS} days.`,
    path: ['to'],
  });
export type ReportQuery = z.input<typeof reportQuerySchema>;

export const reportPeriodSchema = z.object({
  from: z.string(),
  to: z.string(),
  timezone: z.string(),
  /** The period of the same length just before `from` (for comparisons). */
  previousFrom: z.string(),
  previousTo: z.string(),
});
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

const named = {
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
};

// ---------------------------------------------------------------- sales
export const salesSummarySchema = z.object({
  saleCount: z.number().int(),
  itemsSold: z.string(),
  /** Σ unit price × quantity before any discount. */
  gross: moneySchema,
  lineDiscounts: moneySchema,
  orderDiscounts: moneySchema,
  discounts: moneySchema,
  /** Sales revenue: gross − discounts = Σ sale totals. */
  netSales: moneySchema,
  refundCount: z.number().int(),
  /** Completed refunds in the period (by completion time), incl. voids and exchange returns. */
  refunds: moneySchema,
  /** netSales − refunds. */
  netAfterRefunds: moneySchema,
  /** netSales ÷ saleCount, half-up to the fils. */
  averageSale: moneySchema,
});
export type SalesSummary = z.infer<typeof salesSummarySchema>;

export const salesProfitSchema = z.object({
  /** False when some sale in the period has no known cost (`missingCostSales` > 0). */
  available: z.boolean(),
  missingCostSales: z.number().int(),
  /** Cost of goods sold at weighted-average cost when sold. */
  costOfSales: moneySchema.nullable(),
  /** Cost of refunded units that went back to stock. */
  restockedCost: moneySchema.nullable(),
  /** netAfterRefunds − (costOfSales − restockedCost). Fees are not deducted. */
  grossProfit: moneySchema.nullable(),
  /** grossProfit ÷ netAfterRefunds × 100, one decimal; null when not computable. */
  marginPercent: z.string().nullable(),
});

export const salesReportSchema = z.object({
  period: reportPeriodSchema,
  summary: salesSummarySchema,
  previous: salesSummarySchema,
  byDay: z.array(
    z.object({
      date: z.string(),
      saleCount: z.number().int(),
      netSales: moneySchema,
      refunds: moneySchema,
    }),
  ),
  byHour: z.array(
    z.object({ hour: z.number().int(), saleCount: z.number().int(), netSales: moneySchema }),
  ),
  byBranch: z.array(
    z.object({
      branchId: z.string(),
      saleCount: z.number().int(),
      gross: moneySchema,
      discounts: moneySchema,
      netSales: moneySchema,
      refunds: moneySchema,
      netAfterRefunds: moneySchema,
    }),
  ),
  byEmployee: z.array(
    z.object({
      membershipId: z.string(),
      name: z.string(),
      saleCount: z.number().int(),
      discounts: moneySchema,
      netSales: moneySchema,
      refunds: moneySchema,
    }),
  ),
  /** Amounts applied to the period's sales per tender (incl. exchange credit). */
  byPaymentMethod: z.array(
    z.object({ kind: z.string(), ...named, count: z.number().int(), amount: moneySchema }),
  ),
  byProduct: z.array(
    z.object({
      variantId: z.string(),
      ...named,
      variantNameEn: z.string().nullable(),
      variantNameAr: z.string().nullable(),
      sku: z.string().nullable(),
      quantity: z.string(),
      netSales: moneySchema,
      refundedQuantity: z.string(),
      refunds: moneySchema,
    }),
  ),
  /** POS vs. online store (Prompt 16). */
  byChannel: z.array(
    z.object({
      channel: z.enum(['pos', 'online']),
      saleCount: z.number().int(),
      netSales: moneySchema,
    }),
  ),
  /** Retail sales vs. restaurant service types (Prompt 15). */
  byServiceType: z.array(
    z.object({
      serviceType: z.enum(['retail', 'dine_in', 'takeaway', 'pickup']),
      saleCount: z.number().int(),
      netSales: moneySchema,
    }),
  ),
  byCategory: z.array(
    z.object({
      categoryId: z.string().nullable(),
      ...named,
      quantity: z.string(),
      netSales: moneySchema,
    }),
  ),
  /** Only with `reports.financial` for every branch in the report. */
  profit: salesProfitSchema.nullable(),
});
export type SalesReport = z.infer<typeof salesReportSchema>;

// ---------------------------------------------------------------- payments & cash
export const paymentsReportSchema = z.object({
  period: reportPeriodSchema,
  collections: z.array(
    z.object({
      kind: z.string(),
      methodId: z.string().nullable(),
      ...named,
      count: z.number().int(),
      collected: moneySchema,
      fees: moneySchema,
      refunded: moneySchema,
      /** collected − refunded (fees are shown separately). */
      net: moneySchema,
    }),
  ),
  totals: z.object({
    collected: moneySchema,
    fees: moneySchema,
    refunded: moneySchema,
    net: moneySchema,
    netAfterFees: moneySchema,
    previousCollected: moneySchema,
  }),
  cash: z.object({
    cashSales: moneySchema,
    cashRefunds: moneySchema,
    cashIn: moneySchema,
    cashOut: moneySchema,
    /** cashSales − cashRefunds + cashIn − cashOut. */
    netCash: moneySchema,
  }),
  /**
   * Cash custody by type (ADR-0090/0091), from the cash ledger of registers and treasuries in
   * scope. Transfers between them are never sales, revenue or expenses.
   */
  custody: z.object({
    cashSales: moneySchema,
    cashRefunds: moneySchema,
    /** Register → treasury. */
    drops: moneySchema,
    /** Treasury → register. */
    topUps: moneySchema,
    /** Register or treasury → bank. */
    deposits: moneySchema,
    /** Net of reversals. */
    expenses: moneySchema,
    supplierPayments: moneySchema,
    /** Corrections and other manual cash in/out (signed). */
    corrections: moneySchema,
    /** Count differences: shift close and opening, register and treasury counts (signed). */
    countDifferences: moneySchema,
    /** First physical counts (opening balances), never a difference. */
    openingCounts: moneySchema,
    /** Sent to (−) and received from (+) other branches, with receiving differences. */
    branchTransfers: moneySchema,
  }),
  refundAllocations: z.array(
    z.object({
      kind: z.string(),
      ...named,
      status: z.string(),
      count: z.number().int(),
      amount: moneySchema,
    }),
  ),
  byDay: z.array(z.object({ date: z.string(), collected: moneySchema, refunded: moneySchema })),
});
export type PaymentsReport = z.infer<typeof paymentsReportSchema>;

export const shiftsReportSchema = z.object({
  period: reportPeriodSchema,
  shifts: z.array(
    z.object({
      id: z.string(),
      branchId: z.string(),
      registerCode: z.string(),
      employeeName: z.string(),
      openedAt: z.string(),
      closedAt: z.string(),
      closeType: z.string().nullable(),
      openingFloat: moneySchema,
      cashSales: moneySchema,
      cashRefunds: moneySchema,
      cashIn: moneySchema,
      cashOut: moneySchema,
      expectedCash: moneySchema,
      countedCash: moneySchema,
      discrepancy: moneySchema,
      /** `uncounted`: force-closed without a count (ADR-0090), no difference booked. */
      outcome: z.enum(['balanced', 'over', 'short', 'uncounted']),
    }),
  ),
  registers: z.array(
    z.object({
      registerId: z.string(),
      registerCode: z.string(),
      branchId: z.string(),
      shiftCount: z.number().int(),
      expectedCash: moneySchema,
      countedCash: moneySchema,
      discrepancy: moneySchema,
    }),
  ),
  totals: z.object({
    shiftCount: z.number().int(),
    balanced: z.number().int(),
    over: z.number().int(),
    short: z.number().int(),
    totalOver: moneySchema,
    totalShort: moneySchema,
    netDiscrepancy: moneySchema,
  }),
});
export type ShiftsReport = z.infer<typeof shiftsReportSchema>;

// ---------------------------------------------------------------- inventory
export const inventoryReportSchema = z.object({
  period: reportPeriodSchema,
  /** Current values (not period-bound). */
  valuation: z.array(
    z.object({
      branchId: z.string(),
      trackedItems: z.number().int(),
      quantity: z.string(),
      value: moneySchema,
      unvaluedItems: z.number().int(),
    }),
  ),
  stock: z.array(
    z.object({
      variantId: z.string(),
      branchId: z.string(),
      ...named,
      variantNameEn: z.string().nullable(),
      variantNameAr: z.string().nullable(),
      sku: z.string().nullable(),
      onHand: z.string(),
      lowStockThreshold: z.string().nullable(),
      averageCost: moneySchema.nullable(),
      value: moneySchema.nullable(),
      status: z.enum(['in_stock', 'low', 'out', 'negative']),
    }),
  ),
  movements: z.array(
    z.object({
      movementType: z.string(),
      count: z.number().int(),
      quantityIn: z.string(),
      quantityOut: z.string(),
      value: moneySchema,
    }),
  ),
  adjustments: z.array(
    z.object({
      kind: z.string(),
      reason: z.string(),
      documents: z.number().int(),
      quantity: z.string(),
    }),
  ),
  productQuantities: z.array(
    z.object({
      variantId: z.string(),
      ...named,
      sku: z.string().nullable(),
      sold: z.string(),
      returnedToStock: z.string(),
      returnedNotRestocked: z.string(),
      netSold: z.string(),
    }),
  ),
});
export type InventoryReport = z.infer<typeof inventoryReportSchema>;

// ---------------------------------------------------------------- purchasing
export const purchasingReportSchema = z.object({
  period: reportPeriodSchema,
  summary: z.object({
    ordersCreated: z.number().int(),
    orderedValue: moneySchema,
    receipts: z.number().int(),
    receivedValue: moneySchema,
    openOrders: z.number().int(),
    openValue: moneySchema,
  }),
  bySupplier: z.array(
    z.object({
      supplierId: z.string(),
      ...named,
      orders: z.number().int(),
      orderedValue: moneySchema,
      receipts: z.number().int(),
      receivedValue: moneySchema,
      lastReceiptAt: z.string().nullable(),
    }),
  ),
  receipts: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      orderNumber: z.string(),
      supplierName: z.object(named),
      branchId: z.string(),
      receivedBy: z.string(),
      createdAt: z.string(),
      supplierReference: z.string().nullable(),
      value: moneySchema,
    }),
  ),
  transfers: z.array(
    z.object({
      sourceBranchId: z.string(),
      destinationBranchId: z.string(),
      transfers: z.number().int(),
      dispatched: z.string(),
      received: z.string(),
      missing: z.string(),
      dispatchedValue: moneySchema,
      missingValue: moneySchema,
    }),
  ),
});
export type PurchasingReport = z.infer<typeof purchasingReportSchema>;

// ---------------------------------------------------------------- expenses (ADR-0091)
const outflowTotals = { count: z.number().int(), net: moneySchema };
export const expensesReportSchema = z.object({
  period: reportPeriodSchema,
  totals: z.object({
    expenses: moneySchema,
    supplierPayments: moneySchema,
    /** Expenses + supplier payments. */
    total: moneySchema,
    previousExpenses: moneySchema,
  }),
  byCategory: z.array(z.object({ category: z.string(), ...outflowTotals })),
  byBranch: z.array(
    z.object({
      branchId: z.string(),
      ...named,
      expenses: moneySchema,
      supplierPayments: moneySchema,
    }),
  ),
  bySupplier: z.array(z.object({ supplierId: z.string(), ...named, ...outflowTotals })),
  /** Paid from drawers vs treasuries. */
  bySource: z.array(z.object({ source: z.enum(['register', 'treasury']), ...outflowTotals })),
  byDay: z.array(
    z.object({ date: z.string(), expenses: moneySchema, supplierPayments: moneySchema }),
  ),
});
export type ExpensesReport = z.infer<typeof expensesReportSchema>;
