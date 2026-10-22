import type { OverridablePermission } from '@arabat/contracts';
import { describe, expect, it } from 'vitest';
import {
  type CatalogPrice,
  type PosPaymentMethod,
  PosRuleError,
  type PricePolicy,
  type ProductDiscountRule,
  type SaleLine,
  assertDifferentSupervisor,
  assertOverrideUsable,
  assertSellingRights,
  assertSomethingToLend,
  assertVoidable,
  checkCashBreakdown,
  checkPayments,
  closingNoteRequired,
  computeRefund,
  discountedPrice,
  offerAt,
  priceOffers,
  savedPercent,
  createRightCheck,
  evaluateSale,
  exchangeCreditUsed,
  formatDeviceReceiptNumber,
  formatReceiptNumber,
  formatRefundNumber,
  lendableRights,
  openingNoteRequired,
  otherCashOutExceedsLimit,
  parseAmount,
  paybackAllocation,
  refundApprovalReasons,
  requiredSaleRights,
  shiftOutcome,
  suggestPayback,
  toDiscount,
} from './index.js';

const TEA = 'tea';
const catalog = new Map<string, CatalogPrice>([[TEA, { priceMinor: 1250n, costMinor: 400n }]]);
const policy: PricePolicy = {
  maxDiscountPercent: '10',
  priceOverrideFloorPercent: '50',
  priceOverrideCeilingPercent: '200',
  priceOverrideBelowCost: false,
};
const line = (extra: Partial<SaleLine> = {}): SaleLine => ({
  variantId: TEA,
  quantityMilli: 2000n,
  priceOverrideMinor: null,
  priceOverrideReason: null,
  discount: null,
  extraMinor: 0n,
  ...extra,
});
const all = () => true;
const none = () => false;

/** The rule's refusal (status, code), or null when it passed. */
function refusal(run: () => unknown): [number, string] | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof PosRuleError) return [error.status, error.code];
    throw error;
  }
}

const sale = (overrides: Partial<Parameters<typeof evaluateSale>[0]> = {}) =>
  evaluateSale({
    lines: [line()],
    orderDiscount: null,
    catalog,
    policy,
    allowed: all,
    zeroTotalReason: null,
    expectedTotalMinor: null,
    ...overrides,
  });

describe('sale rules', () => {
  it('prices the cart and checks the total the cashier saw', () => {
    expect(sale().priced.totalMinor).toBe(2500n);
    expect(sale({ expectedTotalMinor: 2500n }).aboveLimit).toBe(false);
    expect(refusal(() => sale({ expectedTotalMinor: 2499n }))).toEqual([409, 'TOTAL_CHANGED']);
  });

  it('refuses items not sellable at the branch, with the line path', () => {
    try {
      sale({ lines: [line(), line({ variantId: 'gone' })] });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        status: 409,
        code: 'ITEM_UNAVAILABLE',
        issues: [{ path: 'lines.1.variantId', code: 'unavailable' }],
      });
    }
  });

  it('needs the discount and price-change rights before anything else', () => {
    const discounted = [line({ discount: { type: 'percent', percent: '5' } })];
    expect(refusal(() => assertSellingRights(discounted, null, none))).toEqual([
      403,
      'DISCOUNT_LIMIT_EXCEEDED',
    ]);
    expect(
      refusal(() => assertSellingRights([line({ priceOverrideMinor: 1250n })], null, none)),
    ).toEqual([403, 'PRICE_OVERRIDE_DENIED']);
    expect(refusal(() => assertSellingRights([line()], null, none))).toBeNull();
  });

  it('requires a reason and bounds for a changed price (BR-178)', () => {
    expect(refusal(() => sale({ lines: [line({ priceOverrideMinor: 1000n })] }))).toEqual([
      400,
      'REASON_REQUIRED',
    ]);
    const reason = 'scratched box';
    // Below 50 % of the list price, above 200 %, below cost.
    for (const price of [600n, 2600n, 399n])
      expect(
        refusal(() =>
          sale({ lines: [line({ priceOverrideMinor: price, priceOverrideReason: reason })] }),
        ),
      ).toEqual([400, 'PRICE_OUT_OF_BOUNDS']);
    // The same price as the list price is not a change.
    expect(sale({ lines: [line({ priceOverrideMinor: 1250n })] }).priced.totalMinor).toBe(2500n);
  });

  it('applies the combined discount limit per line (BR-183)', () => {
    const big = [line({ discount: { type: 'percent', percent: '15' } })];
    expect(sale({ lines: big }).aboveLimit).toBe(true);
    const onlyDiscount = (p: OverridablePermission) => p === 'sales.discount';
    expect(refusal(() => sale({ lines: big, allowed: onlyDiscount }))).toEqual([
      403,
      'DISCOUNT_LIMIT_EXCEEDED',
    ]);
    // A lowered price counts towards the limit: 1.100 instead of 1.250 is 12 %.
    const lowered = [line({ priceOverrideMinor: 1100n, priceOverrideReason: 'x' })];
    expect(sale({ lines: lowered }).aboveLimit).toBe(true);
  });

  it('needs a right and a reason for a sale with nothing to pay (BR-179)', () => {
    const free = [line({ discount: { type: 'percent', percent: '100' } })];
    const noZero = (p: OverridablePermission) => p !== 'sales.zero_total';
    expect(refusal(() => sale({ lines: free, allowed: noZero }))).toEqual([
      403,
      'ZERO_TOTAL_DENIED',
    ]);
    expect(refusal(() => sale({ lines: free }))).toEqual([400, 'REASON_REQUIRED']);
    expect(sale({ lines: free, zeroTotalReason: 'tester' }).priced.totalMinor).toBe(0n);
  });

  it('reports pricing errors with their line', () => {
    const tooMuch = [line({ discount: { type: 'amount', amountMinor: 999999n } })];
    expect(refusal(() => sale({ lines: tooMuch }))?.[0]).toBe(400);
  });

  it('lists the rights a cart needs, by the same rules', () => {
    expect(requiredSaleRights([line()], null, catalog, '10')).toEqual([]);
    expect(
      requiredSaleRights(
        [line({ discount: { type: 'percent', percent: '100' } })],
        null,
        catalog,
        '10',
      ),
    ).toEqual(['sales.discount', 'sales.discount.override_limit', 'sales.zero_total']);
    expect(requiredSaleRights([line({ variantId: 'gone' })], null, catalog, '10')).toBeNull();
  });

  it('takes rights from the cashier, else from the grant, and records what the grant supplied', () => {
    const { allowed, supplied } = createRightCheck(
      (p) => p === 'sales.discount',
      ['sales.zero_total'],
    );
    expect(allowed('sales.discount')).toBe(true);
    expect(allowed('sales.zero_total')).toBe(true);
    expect(allowed('sales.price_override')).toBe(false);
    expect([...supplied]).toEqual(['sales.zero_total']);
  });

  it('spends at most the sale total of an exchange credit', () => {
    expect(exchangeCreditUsed(5000n, 3000n)).toBe(3000n);
    expect(exchangeCreditUsed(1000n, 3000n)).toBe(1000n);
  });
});

describe('payments', () => {
  const method = (extra: Partial<PosPaymentMethod> = {}): PosPaymentMethod => ({
    id: 'cash',
    kind: 'cash',
    status: 'active',
    availableInPos: true,
    gatewayProvider: null,
    financialAccountId: null,
    nameEn: 'Cash',
    nameAr: 'نقدًا',
    feeType: 'none',
    feeFixedMinor: 0n,
    feePercent: '0',
    ...extra,
  });
  const card = method({
    id: 'knet',
    kind: 'card',
    financialAccountId: 'bank',
    feeType: 'percentage',
    feePercent: '1.5',
  });
  const methods = new Map([
    ['cash', method()],
    ['knet', card],
  ]);
  const pay = (
    methodId: string,
    amount: string,
    extra: { tendered?: string; reference?: string } = {},
  ) => ({
    methodId,
    amount,
    tendered: extra.tendered ?? null,
    reference: extra.reference ?? null,
  });

  it('splits tenders, gives change for cash and charges card fees', () => {
    const checked = checkPayments(
      [pay('knet', '1.000', { reference: 'A1' }), pay('cash', '1.575', { tendered: '2' })],
      methods,
      2575n,
    );
    expect(checked.map((p) => [p.amountMinor, p.changeMinor, p.feeMinor])).toEqual([
      [1000n, 0n, 15n],
      [1575n, 425n, 0n],
    ]);
  });

  it('refuses each broken tender with its code', () => {
    const cases: [Parameters<typeof checkPayments>, string][] = [
      [[[], methods, 100n], 'PAYMENT_TOTAL_MISMATCH'],
      [[[pay('nope', '1')], methods, 1000n], 'PAYMENT_METHOD_UNAVAILABLE'],
      [
        [[pay('gw', '1')], new Map([['gw', method({ id: 'gw', gatewayProvider: 'tap' })]]), 1000n],
        'PAYMENT_NOT_VERIFIED',
      ],
      [
        [
          [pay('acc', '1', { reference: 'x' })],
          new Map([['acc', method({ id: 'acc', kind: 'card' })]]),
          1000n,
        ],
        'SETTLEMENT_ACCOUNT_REQUIRED',
      ],
      [[[pay('knet', '1')], methods, 1000n], 'REFERENCE_REQUIRED'],
      [[[pay('cash', '1.2345')], methods, 1000n], 'INVALID_PRICE'],
      [[[pay('cash', '0')], methods, 0n], 'PAYMENT_TOTAL_MISMATCH'],
      [
        [[pay('knet', '1', { reference: 'x', tendered: '2' })], methods, 1000n],
        'PAYMENT_TOTAL_MISMATCH',
      ],
      [[[pay('cash', '1', { tendered: '0.5' })], methods, 1000n], 'PAYMENT_TOTAL_MISMATCH'],
      [[[pay('cash', '0.900')], methods, 1000n], 'PAYMENT_TOTAL_MISMATCH'],
    ];
    for (const [args, code] of cases) expect(refusal(() => checkPayments(...args))?.[1]).toBe(code);
    expect(checkPayments([], methods, 0n)).toEqual([]);
    // The reference is optional when the company does not require it.
    expect(checkPayments([pay('knet', '1')], methods, 1000n, false)).toHaveLength(1);
  });
});

describe('numbers and amounts', () => {
  it('formats receipt and refund numbers', () => {
    expect(formatReceiptNumber('MAIN', '28')).toBe('MAIN-000028');
    expect(formatDeviceReceiptNumber('MAIN', 'R1', 123n)).toBe('MAIN-R1-000123');
    expect(formatRefundNumber('MAIN-000028', 2)).toBe('MAIN-000028-R2');
  });

  it('parses amounts and discounts', () => {
    expect(parseAmount('1.25', 'x')).toBe(1250n);
    expect(refusal(() => parseAmount('1.2345', 'x'))).toEqual([400, 'INVALID_PRICE']);
    expect(toDiscount({ type: 'amount', value: '0.5' }, 'd')).toEqual({
      type: 'amount',
      amountMinor: 500n,
    });
    expect(toDiscount(null, 'd')).toBeNull();
  });
});

describe('supervisor overrides', () => {
  const grant = {
    status: 'granted',
    expiresAt: new Date('2026-10-17T10:05:00Z'),
    cashierMembershipId: 'm1',
    branchId: 'b1',
  };
  const at = { cashierMembershipId: 'm1', branchId: 'b1', now: new Date('2026-10-17T10:00:00Z') };

  it('accepts a live grant for this cashier and branch only', () => {
    expect(refusal(() => assertOverrideUsable(grant, at))).toBeNull();
    for (const bad of [
      null,
      { ...grant, status: 'used' },
      { ...grant, expiresAt: at.now },
      { ...grant, cashierMembershipId: 'm2' },
      { ...grant, branchId: 'b2' },
    ])
      expect(refusal(() => assertOverrideUsable(bad, at))).toEqual([409, 'OVERRIDE_INVALID']);
  });

  it('lends only what the supervisor holds and the cashier lacks, never to oneself', () => {
    expect(
      lendableRights(
        () => true,
        (p) => p === 'sales.discount',
      ),
    ).not.toContain('sales.discount');
    expect(
      lendableRights(
        () => false,
        () => false,
      ),
    ).toEqual([]);
    expect(refusal(() => assertSomethingToLend([]))).toEqual([403, 'OVERRIDE_NOT_ALLOWED']);
    expect(refusal(() => assertDifferentSupervisor('u1', 'u1'))).toEqual([403, 'OVERRIDE_SELF']);
  });
});

describe('shifts and cash', () => {
  it('classifies the count against the tolerance', () => {
    expect(shiftOutcome(null, 100n)).toBeNull();
    expect(shiftOutcome(-100n, 100n)).toBe('balanced');
    expect(shiftOutcome(101n, 100n)).toBe('over');
    expect(shiftOutcome(-1n, null)).toBe('short');
  });

  it('asks for a note on a difference beyond the tolerance, except blind or first counts', () => {
    const base = { note: null, differenceMinor: 500n, toleranceMinor: 100n };
    expect(openingNoteRequired({ ...base, blind: false, initial: false })).toBe(true);
    expect(openingNoteRequired({ ...base, blind: true, initial: false })).toBe(false);
    expect(openingNoteRequired({ ...base, blind: false, initial: true })).toBe(false);
    expect(openingNoteRequired({ ...base, blind: false, initial: false, note: 'why' })).toBe(false);
    const close = { note: null, discrepancyMinor: -500n, toleranceMinor: 100n };
    expect(closingNoteRequired({ ...close, closeType: 'normal', blind: true })).toBe(false);
    expect(closingNoteRequired({ ...close, closeType: 'forced', blind: true })).toBe(true);
  });

  it('caps "other" cash-outs per movement and per shift', () => {
    const limits = { perMovementLimitMinor: 20000n, perShiftLimitMinor: 50000n };
    expect(
      otherCashOutExceedsLimit({ ...limits, amountMinor: 20001n, shiftOtherTotalMinor: 0n }),
    ).toBe(true);
    expect(
      otherCashOutExceedsLimit({ ...limits, amountMinor: 20000n, shiftOtherTotalMinor: 30000n }),
    ).toBe(false);
    expect(
      otherCashOutExceedsLimit({ ...limits, amountMinor: 1n, shiftOtherTotalMinor: 50000n }),
    ).toBe(true);
  });

  it('checks a denomination count against the counted cash', () => {
    const breakdown = [
      { value: '10', count: 2 },
      { value: '0.250', count: 4 },
    ];
    expect(refusal(() => checkCashBreakdown(breakdown, 21000n))).toBeNull();
    expect(refusal(() => checkCashBreakdown(breakdown, 21001n))).toEqual([
      400,
      'INVALID_BREAKDOWN',
    ]);
    expect(refusal(() => checkCashBreakdown(null, 1n))).toBeNull();
  });
});

describe('refunds', () => {
  const sold = [
    {
      position: 0,
      variantId: TEA,
      soldMilli: 3000n,
      netMinor: 1000n,
      unitCostMinor: 200n,
      trackInventory: true,
      refundedMilli: 0n,
      refundedMinor: 0n,
    },
  ];

  it('rounds cumulatively so partial refunds add up to the line net', () => {
    const first = computeRefund(sold, [{ position: 0, quantity: '1' }]);
    expect(first.totalMinor).toBe(333n);
    const second = computeRefund(
      [{ ...sold[0]!, refundedMilli: 1000n, refundedMinor: 333n }],
      [{ position: 0, quantity: '2' }],
    );
    expect(first.totalMinor + second.totalMinor).toBe(1000n);
  });

  it('keeps damaged goods out of stock by default and refuses too much or unknown lines', () => {
    expect(computeRefund(sold, [{ position: 0, quantity: '1' }], 'damaged').lines[0]!.restock).toBe(
      false,
    );
    expect(refusal(() => computeRefund(sold, [{ position: 0, quantity: '4' }]))).toEqual([
      409,
      'REFUND_EXCEEDS_SALE',
    ]);
    expect(refusal(() => computeRefund(sold, [{ position: 0, quantity: '0' }]))).toEqual([
      400,
      'INVALID_QUANTITY',
    ]);
    expect(refusal(() => computeRefund(sold, [{ position: 9, quantity: '1' }]))).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
  });

  const payments = [
    { id: 'p1', amountMinor: 1000n, refundedMinor: 0n },
    { id: 'p2', amountMinor: 3000n, refundedMinor: 1000n },
  ];

  it('suggests a proportional pay-back and validates a chosen one', () => {
    expect(suggestPayback(payments, 900n).map((a) => [a.payment.id, a.amountMinor])).toEqual([
      ['p1', 300n],
      ['p2', 600n],
    ]);
    expect(paybackAllocation(payments, 900n, null)).toHaveLength(2);
    expect(
      paybackAllocation(payments, 900n, [{ paymentId: 'p2', amount: '0.900', reference: null }]),
    ).toHaveLength(1);
    for (const custom of [
      [{ paymentId: 'nope', amount: '0.900', reference: null }],
      [{ paymentId: 'p1', amount: '1.100', reference: null }],
      [{ paymentId: 'p1', amount: '0.500', reference: null }],
      [
        { paymentId: 'p1', amount: '0.450', reference: null },
        { paymentId: 'p1', amount: '0.450', reference: null },
      ],
    ])
      expect(refusal(() => paybackAllocation(payments, 900n, custom))?.[1]).toBe(
        'REFUND_ALLOCATION_INVALID',
      );
  });

  it('lists why a refund waits for approval (BR-180)', () => {
    const settings = {
      refundApprovalLimitMinor: 20000n,
      refundWindowDays: 30,
      refundOwnSalesNeedApproval: true,
    };
    const now = new Date('2026-10-17T00:00:00Z');
    expect(
      refundApprovalReasons({
        totalMinor: 25000n,
        saleCreatedAt: new Date('2026-09-01T00:00:00Z'),
        saleUserId: 'u1',
        requesterUserId: 'u1',
        now,
        settings,
      }),
    ).toEqual(['over_limit', 'outside_window', 'own_sale']);
    expect(
      refundApprovalReasons({
        totalMinor: 100n,
        saleCreatedAt: now,
        saleUserId: 'u1',
        requesterUserId: 'u2',
        now,
        settings,
      }),
    ).toEqual([]);
  });

  it('voids only sales of the open shift without refunds', () => {
    expect(
      refusal(() => assertVoidable({ saleShiftId: 's1', openShiftId: 's1', activeRefunds: 0 })),
    ).toBeNull();
    expect(
      refusal(() => assertVoidable({ saleShiftId: 's0', openShiftId: 's1', activeRefunds: 0 })),
    ).toEqual([409, 'NOT_VOIDABLE']);
    expect(
      refusal(() => assertVoidable({ saleShiftId: 's1', openShiftId: 's1', activeRefunds: 1 })),
    ).toEqual([409, 'NOT_VOIDABLE']);
  });
});

describe('product discounts (ADR-0133)', () => {
  const rule = (over: Partial<ProductDiscountRule>): ProductDiscountRule => ({
    id: 'd',
    type: 'percentage',
    percent: '20',
    amountMinor: null,
    startsAt: null,
    endsAt: null,
    ...over,
  });

  it('takes a percentage half-up to the fils, or an amount, never down to zero', () => {
    expect(discountedPrice(1250n, rule({ percent: '20' }))).toBe(1000n);
    // 12.5% of 1.005 = 0.125625 → 0.126 off.
    expect(discountedPrice(1005n, rule({ percent: '12.5' }))).toBe(879n);
    expect(discountedPrice(1250n, rule({ type: 'amount', percent: null, amountMinor: 250n }))).toBe(
      1000n,
    );
    // An amount as large as the price, a 100% discount or nothing off leave the price alone.
    expect(discountedPrice(200n, rule({ type: 'amount', percent: null, amountMinor: 200n }))).toBe(
      null,
    );
    expect(discountedPrice(1250n, rule({ percent: '100' }))).toBe(null);
    expect(discountedPrice(1n, rule({ percent: '10' }))).toBe(null);
    expect(discountedPrice(1250n, rule({ percent: '20.555' }))).toBe(null);
  });

  it('chooses the largest discount in force; dates are start inclusive, end exclusive', () => {
    const offers = priceOffers(1000n, [
      rule({ id: 'a', percent: '10' }),
      rule({ id: 'b', type: 'amount', percent: null, amountMinor: 300n }),
      rule({
        id: 'c',
        percent: '50',
        startsAt: '2026-11-01T00:00:00Z',
        endsAt: '2026-11-02T00:00:00Z',
      }),
    ]);
    expect(offers.map((o) => [o.discountId, o.priceMinor])).toEqual([
      ['a', 900n],
      ['b', 700n],
      ['c', 500n],
    ]);
    expect(offerAt(offers, new Date('2026-10-31T23:59:59Z'))?.discountId).toBe('b');
    expect(offerAt(offers, new Date('2026-11-01T00:00:00Z'))?.discountId).toBe('c');
    expect(offerAt(offers, new Date('2026-11-02T00:00:00Z'))?.discountId).toBe('b');
    expect(offerAt([], new Date())).toBe(null);
    // A tie keeps the first offer.
    const tie = priceOffers(1000n, [rule({ id: 'x' }), rule({ id: 'y' })]);
    expect(offerAt(tie, new Date())?.discountId).toBe('x');
  });

  it('shows the whole percentage saved', () => {
    expect(savedPercent(1250n, 1000n)).toBe(20);
    expect(savedPercent(1000n, 999n)).toBe(1);
    expect(savedPercent(1000n, 1000n)).toBe(0);
  });
});
