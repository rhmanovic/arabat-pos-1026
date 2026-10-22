import type { DeviceRecordResult, DeviceSnapshot } from '@arabat/contracts';
import { argon2id } from 'hash-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogAt, loadCatalog, searchCatalog } from './catalog.js';
import { afterFailure, attemptPin, freshLock, isLocked, verifyPinHash } from './pin.js';
import { OFFLINE_RED_HOURS, offlineState } from './offline.js';
import { applyResults, listOutbox, nextBatch, outboxCounts } from './outbox.js';
import { commitRefund, prepareRefund, refundableSale } from './refunds.js';
import { receiptHtmlFor } from './receipt.js';
import {
  type Cart,
  commitSale,
  getSale,
  listSales,
  missingRights,
  prepareSale,
  priceCartLines,
} from './sales.js';
import { META, getMeta, migrate } from './schema.js';
import {
  closeShift,
  discardRefusedShift,
  getShift,
  openShift,
  openShiftOf,
  recordCashMovement,
  recordSignIn,
  shiftAcceptance,
  shiftSummary,
} from './shifts.js';
import { applySnapshot, loadContext, loadPaymentMethods, loadStaff } from './snapshot.js';
import { SyncEngine } from './sync.js';
import { type FakeBridge, createFakeBridge } from './testing/fake-bridge.js';

const U = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const CASH = U(900);
const CARD = U(901);
let PIN_HASH: string;

beforeAll(async () => {
  // A real argon2id hash (small parameters keep the test fast; verification ignores them).
  PIN_HASH = await argon2id({
    password: '482913',
    salt: 'saltsaltsalt',
    parallelism: 1,
    iterations: 1,
    memorySize: 1024,
    hashLength: 32,
    outputType: 'encoded',
  });
});

function snapshot(partial: Partial<DeviceSnapshot> = {}): DeviceSnapshot {
  return {
    version: '2026-10-18T10:00:00.000Z',
    full: true,
    catalogVersion: '2026-10-18T09:00:00.000Z',
    serverTime: '2026-10-18T10:00:00.000Z',
    offlineLimitHours: 72,
    priceOffers: [],
    device: {
      id: U(1),
      name: 'Till',
      merchantId: U(2),
      branchId: U(3),
      branchCode: 'MAIN',
      code: 'D1',
      registerId: U(4),
      registerCode: 'R1',
      registerName: { nameEn: 'Main drawer', nameAr: null },
      role: 'primary',
    },
    merchant: {
      id: U(2),
      nameEn: 'Arabat Café',
      nameAr: 'مقهى',
      currency: 'KWD',
      timezone: 'Asia/Kuwait',
    },
    branch: {
      id: U(3),
      code: 'MAIN',
      nameEn: 'Main',
      nameAr: null,
      phone: null,
      address: null,
      receiptHeader: null,
      receiptFooter: 'Thanks',
    },
    register: {
      id: U(4),
      code: 'R1',
      nameEn: 'Main drawer',
      nameAr: null,
      defaultOpeningFloatMinor: '0',
      discrepancyToleranceMinor: '0',
    },
    settings: {
      maxDiscountPercent: '10',
      priceOverrideFloorPercent: '50',
      priceOverrideCeilingPercent: '200',
      priceOverrideBelowCost: false,
      requireTenderReference: true,
      blindCashCount: true,
      cashOutOtherLimitMinor: '20000',
      cashOutOtherShiftLimitMinor: '50000',
      refundWindowDays: 30,
      refundApprovalLimitMinor: '20000',
      refundOwnSalesNeedApproval: true,
      allowNegativeStock: false,
      heldSaleExpiryHours: 24,
    },
    counters: { lastReceiptNumber: null },
    branchShift: null,
    primaryDevice: { id: U(1), name: 'Till' },
    paymentMethods: [
      {
        id: CASH,
        kind: 'cash',
        status: 'active',
        availableInPos: true,
        gatewayProvider: null,
        financialAccountId: null,
        nameEn: 'Cash',
        nameAr: 'نقدي',
        feeType: 'none',
        feeFixedMinor: '0',
        feePercent: '0',
        sortOrder: 0,
      },
      {
        id: CARD,
        kind: 'card',
        status: 'active',
        availableInPos: true,
        gatewayProvider: null,
        financialAccountId: U(902),
        nameEn: 'Card',
        nameAr: 'بطاقة',
        feeType: 'percentage',
        feeFixedMinor: '0',
        feePercent: '2',
        sortOrder: 1,
      },
    ],
    staff: [
      {
        membershipId: U(10),
        userId: U(11),
        fullName: 'Sara',
        isOwner: false,
        pinHash: PIN_HASH,
        permissions: [
          'pos.access',
          'sales.create',
          'shifts.operate',
          'cash.move',
          'refunds.create',
        ],
      },
      {
        membershipId: U(20),
        userId: U(21),
        fullName: 'Omar',
        isOwner: false,
        pinHash: PIN_HASH,
        permissions: [
          'pos.access',
          'sales.create',
          'sales.discount',
          'sales.discount.override_limit',
          'sales.price_override',
          'refunds.approve',
          'shifts.operate',
        ],
      },
      {
        membershipId: U(30),
        userId: U(31),
        fullName: 'Owner',
        isOwner: true,
        pinHash: null,
        permissions: [
          'pos.access',
          'sales.create',
          'refunds.approve',
          'shifts.operate',
          'cash.move',
          'refunds.create',
        ],
      },
    ],
    categories: [
      {
        id: U(50),
        parentId: null,
        nameEn: 'Drinks',
        nameAr: 'مشروبات',
        sortOrder: 0,
        status: 'active',
      },
    ],
    products: [
      {
        id: U(60),
        categoryId: U(50),
        nameEn: 'Tea',
        nameAr: 'شاي',
        type: 'standard',
        trackInventory: false,
        sellable: true,
        updatedAt: '2026-10-18T09:00:00.000Z',
        variants: [
          {
            id: U(61),
            nameEn: null,
            nameAr: null,
            sku: 'TEA-1',
            priceMinor: '250',
            costMinor: '80',
            isDefault: true,
            status: 'active',
            barcodes: ['6281000000017'],
          },
        ],
      },
      {
        id: U(70),
        categoryId: U(50),
        nameEn: 'Cup',
        nameAr: 'كوب',
        type: 'standard',
        trackInventory: true,
        sellable: true,
        updatedAt: '2026-10-18T09:00:00.000Z',
        variants: [
          {
            id: U(71),
            nameEn: 'Large',
            nameAr: 'كبير',
            sku: 'CUP-L',
            priceMinor: '1000',
            costMinor: '400',
            isDefault: true,
            status: 'active',
            barcodes: [],
          },
        ],
      },
    ],
    ...partial,
  };
}

/** A fake server: records what the device sends and answers as the real one would. */
function fakeServer(snap: DeviceSnapshot) {
  const uploads: unknown[][] = [];
  const accepted = new Map<string, string>();
  let fail = false;
  let answer: 'revoked' | 'suspended' | null = null;
  let delta: DeviceSnapshot | null = null;
  let refuseShiftOpen: string | null = null;
  const fetchImpl: typeof fetch = async (url, init) => {
    const u = String(url);
    const problem = (status: number, code: string) =>
      new Response(JSON.stringify({ status, code, title: code }), {
        status,
        headers: { 'content-type': 'application/problem+json' },
      });
    if (fail) throw new TypeError('fetch failed');
    if (answer === 'revoked') return problem(401, 'DEVICE_REVOKED');
    if (answer === 'suspended') return problem(403, 'MERCHANT_SUSPENDED');
    if (init?.method === 'GET' && u.includes('/device/sync')) {
      const since = new URL(u).searchParams.get('since');
      const body =
        since && delta
          ? delta
          : since
            ? { ...snap, full: false, products: [], version: `${since}+1` }
            : snap;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (init?.method === 'POST' && u.endsWith('/device/sync')) {
      const { records } = JSON.parse(String(init.body)) as {
        records: { id: string; kind: string }[];
      };
      uploads.push(records);
      const results: DeviceRecordResult[] = records.map((r) => {
        const hash = JSON.stringify(r);
        if (accepted.has(r.id))
          return accepted.get(r.id) === hash
            ? {
                id: r.id,
                kind: r.kind,
                status: 'duplicate',
                result: { ok: true },
                code: null,
                message: null,
                clockSkew: false,
              }
            : {
                id: r.id,
                kind: r.kind,
                status: 'refused',
                result: null,
                code: 'IDEMPOTENCY_CONFLICT',
                message: 'changed',
                clockSkew: false,
              };
        // The cascade of the first real test: a refused shift, then SHIFT_REQUIRED for the rest.
        if (r.kind === 'shift_open' && refuseShiftOpen)
          return {
            id: r.id,
            kind: r.kind,
            status: 'refused',
            result: null,
            code: refuseShiftOpen,
            message: 'stale shift elsewhere',
            clockSkew: false,
          };
        if (
          'shiftId' in r &&
          !accepted.has(String((r as { shiftId: string }).shiftId)) &&
          refuseShiftOpen
        )
          return {
            id: r.id,
            kind: r.kind,
            status: 'refused',
            result: null,
            code: 'SHIFT_REQUIRED',
            message: 'The shift has not been uploaded.',
            clockSkew: false,
          };
        if (r.kind === 'cash_movement' && (r as { note?: string }).note === 'refuse-me')
          return {
            id: r.id,
            kind: r.kind,
            status: 'refused',
            result: null,
            code: 'VALIDATION_FAILED',
            message: 'bad',
            clockSkew: false,
          };
        accepted.set(r.id, hash);
        return {
          id: r.id,
          kind: r.kind,
          status: 'accepted',
          result: { ok: true },
          code: null,
          message: null,
          clockSkew: false,
        };
      });
      return new Response(JSON.stringify({ serverTime: new Date().toISOString(), results }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return problem(404, 'ROUTE_NOT_FOUND');
  };
  return {
    fetch: fetchImpl,
    uploads,
    setFail: (v: boolean) => (fail = v),
    setAnswer: (v: typeof answer) => (answer = v),
    setDelta: (v: DeviceSnapshot | null) => (delta = v),
    setRefuseShiftOpen: (code: string | null) => (refuseShiftOpen = code),
  };
}

async function device(snap = snapshot()) {
  const server = fakeServer(snap);
  const bridge = await createFakeBridge({
    baseUrl: 'http://test/api/v1',
    fetch: server.fetch,
    token: 'tok',
  });
  await migrate(bridge.db);
  return { bridge, server, db: bridge.db };
}

async function ready() {
  const d = await device();
  await applySnapshot(d.db, snapshot());
  const ctx = (await loadContext(d.db))!;
  const staff = await loadStaff(d.db);
  const catalog = await loadCatalog(d.db);
  const methods = await loadPaymentMethods(d.db);
  const sara = staff.find((s) => s.fullName === 'Sara')!;
  const omar = staff.find((s) => s.fullName === 'Omar')!;
  const owner = staff.find((s) => s.isOwner)!;
  return { ...d, ctx, staff, catalog, methods, sara, omar, owner };
}

const teaCart = (quantity = '2', discount: Cart['lines'][number]['discount'] = null): Cart => ({
  lines: [
    {
      key: 'a',
      variantId: U(61),
      quantity,
      priceOverride: null,
      priceOverrideReason: null,
      discount,
    },
  ],
  orderDiscount: null,
});
const cash = (amount: string, tendered = amount) => [
  { methodId: CASH, amount, tendered, reference: null },
];

describe('schema and snapshot', () => {
  it('migrates once, stores a full snapshot and applies deltas per product', async () => {
    const d = await device();
    await migrate(d.db); // idempotent
    expect(await getMeta(d.db, META.schemaVersion)).toBe('3');
    await applySnapshot(d.db, snapshot());
    const ctx = (await loadContext(d.db))!;
    expect(ctx.branch.code).toBe('MAIN');
    expect(ctx.offlineLimitHours).toBe(72);
    expect((await loadStaff(d.db)).map((s) => s.fullName)).toEqual(['Omar', 'Owner', 'Sara']);
    const catalog = await loadCatalog(d.db);
    expect(catalog.items.size).toBe(2);
    expect(searchCatalog(catalog, '6281000000017')[0]!.variantId).toBe(U(61));
    expect(searchCatalog(catalog, 'كب').map((i) => i.sku)).toEqual(['CUP-L']);
    // A delta: tea archived (not sellable), cup repriced, a new staff list.
    await applySnapshot(
      d.db,
      snapshot({
        full: false,
        version: 'v2',
        staff: snapshot().staff.slice(0, 1),
        products: [
          { ...snapshot().products[0]!, sellable: false },
          {
            ...snapshot().products[1]!,
            variants: [{ ...snapshot().products[1]!.variants[0]!, priceMinor: '1250' }],
          },
        ],
      }),
    );
    const after = await loadCatalog(d.db);
    expect([...after.items.keys()]).toEqual([U(71)]);
    expect(after.items.get(U(71))!.priceMinor).toBe(1250n);
    expect((await loadStaff(d.db)).length).toBe(1);
    expect((await loadContext(d.db))!.version).toBe('v2');
  });

  it('continues the receipt series above the server’s counter after a reinstall', async () => {
    const d = await device();
    await applySnapshot(d.db, snapshot({ counters: { lastReceiptNumber: 'MAIN-D1-000041' } }));
    expect(await getMeta(d.db, META.receiptCounter)).toBe('41');
    await applySnapshot(d.db, snapshot({ counters: { lastReceiptNumber: 'MAIN-000099' } }));
    expect(await getMeta(d.db, META.receiptCounter)).toBe('41');
  });

  it('starts a new receipt series when the owner moves the device to another branch', async () => {
    const d = await device();
    await applySnapshot(d.db, snapshot({ counters: { lastReceiptNumber: 'MAIN-D1-000041' } }));
    const base = snapshot();
    await applySnapshot(d.db, {
      ...base,
      branch: { ...base.branch, id: U(30), code: 'MALL' },
      register: { ...base.register!, id: U(40), code: 'R1' },
      device: {
        ...base.device,
        branchId: U(30),
        branchCode: 'MALL',
        registerId: U(40),
        registerCode: 'R1',
        role: 'secondary',
      },
      counters: { lastReceiptNumber: null },
    });
    expect(await getMeta(d.db, META.receiptCounter)).toBe('0');
    expect((await loadContext(d.db))!.device.role).toBe('secondary');
  });
});

describe('offline limit', () => {
  it('warns at 24 h and 48 h and stops at the company limit', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const at = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
    expect(offlineState(at(1), 72, now).level).toBe('ok');
    expect(offlineState(at(24), 72, now).level).toBe('yellow');
    expect(offlineState(at(OFFLINE_RED_HOURS), 72, now).level).toBe('red');
    expect(offlineState(at(72), 72, now)).toMatchObject({ level: 'stopped', canSell: false });
    expect(offlineState(at(30), 24, now)).toMatchObject({ level: 'stopped', canSell: false });
    expect(offlineState(null, 72, now).canSell).toBe(false);
  });
});

describe('PIN', () => {
  it('verifies argon2id hashes and never matches a missing hash', async () => {
    expect(await verifyPinHash(PIN_HASH, '482913')).toBe(true);
    expect(await verifyPinHash(PIN_HASH, '482914')).toBe(false);
    expect(await verifyPinHash(null, '482913')).toBe(false);
    expect(await verifyPinHash(PIN_HASH, 'abc')).toBe(false);
  });

  it('locks after 3 wrong PINs (Plan A) for 5 minutes, doubling on repeat', async () => {
    const now = new Date('2026-10-18T12:00:00Z');
    let s = freshLock;
    for (let i = 0; i < 2; i += 1) s = afterFailure(s, now);
    expect(isLocked(s, now)).toBe(false);
    s = afterFailure(s, now);
    expect(s.lockedUntil!.getTime() - now.getTime()).toBe(5 * 60_000);
    expect(isLocked(s, new Date(now.getTime() + 4 * 60_000))).toBe(true);
    const later = new Date(now.getTime() + 6 * 60_000);
    expect(isLocked(s, later)).toBe(false);
    for (let i = 0; i < 3; i += 1) s = afterFailure(s, later);
    expect(s.lockedUntil!.getTime() - later.getTime()).toBe(10 * 60_000);

    const d = await ready();
    const member = { membershipId: d.sara.membershipId, pinHash: PIN_HASH };
    const verify = (hash: string, pin: string) => verifyPinHash(hash, pin);
    for (let i = 0; i < 2; i += 1)
      expect(await attemptPin(d.db, member, '000000', verify, now)).toEqual({
        ok: false,
        reason: 'wrong',
        failuresLeft: 2 - i,
      });
    const locked = await attemptPin(d.db, member, '000000', verify, now);
    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
    // Even the right PIN is refused while locked.
    expect((await attemptPin(d.db, member, '482913', verify, now)).ok).toBe(false);
    expect(await attemptPin(d.db, member, '482913', verify, later)).toEqual({ ok: true });
    expect(
      await attemptPin(
        d.db,
        { membershipId: d.owner.membershipId, pinHash: null },
        '482913',
        verify,
        now,
      ),
    ).toEqual({ ok: false, reason: 'no_pin' });
  });
});

describe('selling', () => {
  it('prices, decides rights and writes the sale with a gap-free receipt number and outbox record', async () => {
    const d = await ready();
    const shift = await openShift(d.db, {
      cashier: d.sara,
      countedCashMinor: 5000n,
      note: null,
      role: 'primary',
    });
    expect((await openShiftOf(d.db))?.id).toBe(shift.id);
    const cart = teaCart('2', { type: 'percent', value: '10' });
    const priced = priceCartLines(cart, d.catalog);
    expect(priced).toMatchObject({ ok: true, cart: { totalMinor: 450n } });
    // Sara may not give discounts: a supervisor is needed.
    expect(missingRights(cart, d.catalog, d.ctx, d.sara)).toEqual(['sales.discount']);
    expect(() =>
      prepareSale(
        {
          cart,
          payments: cash('0.450', '1'),
          cashier: d.sara,
          shift,
          supervisor: null,
          zeroTotalReason: null,
        },
        d.ctx,
        d.catalog,
        d.methods,
      ),
    ).toThrow(/not allowed to give discounts/);
    const prepared = prepareSale(
      {
        cart,
        payments: cash('0.450', '1.000'),
        cashier: d.sara,
        shift,
        supervisor: { member: d.omar, rights: ['sales.discount'], note: 'regular' },
        zeroTotalReason: null,
      },
      d.ctx,
      d.catalog,
      d.methods,
    );
    expect(prepared.changeMinor).toBe(550n);
    expect(prepared.record.override).toEqual({
      approverMembershipId: d.omar.membershipId,
      rights: ['sales.discount'],
      note: 'regular',
    });
    const sale = await commitSale(d.db, prepared, d.ctx);
    expect(sale.receiptNumber).toBe('MAIN-D1-000001');
    expect(sale.record.lines[0]).toMatchObject({
      grossMinor: '500',
      lineDiscountMinor: '50',
      netMinor: '450',
    });
    const second = await commitSale(
      d.db,
      prepareSale(
        {
          cart: teaCart('1'),
          payments: cash('0.250'),
          cashier: d.sara,
          shift,
          supervisor: null,
          zeroTotalReason: null,
        },
        d.ctx,
        d.catalog,
        d.methods,
      ),
      d.ctx,
    );
    expect(second.receiptNumber).toBe('MAIN-D1-000002');
    const outbox = await listOutbox(d.db);
    expect(outbox.map((o) => [o.seq, o.kind])).toEqual([
      [3, 'sale'],
      [2, 'sale'],
      [1, 'shift_open'],
    ]);
    expect(JSON.parse(outbox[1]!.body)).toEqual(sale.record);
    // The receipt is the server's document.
    const html = receiptHtmlFor((await getSale(d.db, sale.saleId))!, d.ctx, d.sara);
    expect(html).toContain('MAIN-D1-000001');
    expect(html).toContain('شاي');
    expect(html).toContain('0.550');
    expect((await listSales(d.db)).map((s) => s.receiptNumber)).toEqual([
      'MAIN-D1-000002',
      'MAIN-D1-000001',
    ]);
    const summary = await shiftSummary(d.db, shift);
    expect(summary).toMatchObject({
      salesCount: 2,
      salesTotalMinor: 700n,
      cashSalesMinor: 700n,
      expectedCashMinor: 5700n,
    });
  });

  it('sells at the product discount in force and keeps the regular price (ADR-0133)', async () => {
    const d = await device();
    await applySnapshot(
      d.db,
      snapshot({
        priceOffers: [
          { variantId: U(61), discountId: U(90), priceMinor: '200', startsAt: null, endsAt: null },
          {
            variantId: U(61),
            discountId: U(91),
            priceMinor: '150',
            startsAt: '2026-10-30T00:00:00.000Z',
            endsAt: '2026-10-31T00:00:00.000Z',
          },
        ],
      }),
    );
    const ctx = (await loadContext(d.db))!;
    const staff = await loadStaff(d.db);
    const catalog = await loadCatalog(d.db);
    const methods = await loadPaymentMethods(d.db);
    const sara = staff.find((m) => m.fullName === 'Sara')!;
    const now = new Date('2026-10-22T12:00:00Z');
    const tea = catalogAt(catalog, now).items.get(U(61))!;
    expect([tea.priceMinor, tea.regularPriceMinor, tea.discountId]).toEqual([200n, 250n, U(90)]);
    expect(catalogAt(catalog, new Date('2026-10-30T12:00:00Z')).items.get(U(61))!.priceMinor).toBe(
      150n,
    );
    expect(priceCartLines(teaCart('2'), catalog, now)).toMatchObject({
      ok: true,
      cart: { totalMinor: 400n },
    });
    const shift = await openShift(d.db, {
      cashier: sara,
      countedCashMinor: 0n,
      note: null,
      role: 'primary',
    });
    const prepared = prepareSale(
      {
        cart: teaCart('2'),
        payments: cash('0.400'),
        cashier: sara,
        shift,
        supervisor: null,
        zeroTotalReason: null,
      },
      ctx,
      catalog,
      methods,
      now,
    );
    expect(prepared.record.lines[0]).toMatchObject({
      listUnitPriceMinor: '200',
      unitPriceMinor: '200',
      regularUnitPriceMinor: '250',
      productDiscountId: U(90),
      netMinor: '400',
    });
    const sale = await commitSale(d.db, prepared, ctx);
    const local = (await getSale(d.db, sale.saleId))!;
    expect(local.lines[0]).toMatchObject({ listUnitPriceMinor: 200n, regularUnitPriceMinor: 250n });
    // The receipt shows the price before the discount.
    expect(receiptHtmlFor(local, ctx, sara)).toContain('قبل الخصم');
  });

  it('keeps the receipt series gap-free when a sale fails to write or two sales race', async () => {
    const d = await ready();
    const shift = await openShift(d.db, {
      cashier: d.sara,
      countedCashMinor: 0n,
      note: null,
      role: 'primary',
    });
    const prepared = prepareSale(
      {
        cart: teaCart('1'),
        payments: cash('0.250'),
        cashier: d.sara,
        shift,
        supervisor: null,
        zeroTotalReason: null,
      },
      d.ctx,
      d.catalog,
      d.methods,
    );
    // A broken record (duplicate payment id) fails inside the transaction: nothing is written.
    const broken = {
      ...prepared,
      record: {
        ...prepared.record,
        payments: [prepared.record.payments[0]!, prepared.record.payments[0]!],
      },
      payments: [prepared.payments[0]!, prepared.payments[0]!],
    };
    await expect(commitSale(d.db, broken, d.ctx)).rejects.toThrow(/DB_ERROR/);
    expect(await getMeta(d.db, META.receiptCounter)).toBe('0');
    expect(await listSales(d.db)).toEqual([]);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        commitSale(
          d.db,
          prepareSale(
            {
              cart: teaCart('1'),
              payments: cash('0.250'),
              cashier: d.sara,
              shift,
              supervisor: null,
              zeroTotalReason: null,
            },
            d.ctx,
            d.catalog,
            d.methods,
          ),
          d.ctx,
        ),
      ),
    );
    expect(results.map((r) => r.receiptNumber).sort()).toEqual([
      'MAIN-D1-000001',
      'MAIN-D1-000002',
      'MAIN-D1-000003',
    ]);
    // A counter changed underneath (another writer) makes the guard fail the transaction.
    await d.db.exec(`UPDATE meta SET value = '10' WHERE key = ?`, [META.receiptCounter]);
    const stale = prepareSale(
      {
        cart: teaCart('1'),
        payments: cash('0.250'),
        cashier: d.sara,
        shift,
        supervisor: null,
        zeroTotalReason: null,
      },
      d.ctx,
      d.catalog,
      d.methods,
    );
    const original = d.db.transaction.bind(d.db);
    d.db.transaction = async (stmts) => {
      await d.db.exec(`UPDATE meta SET value = '20' WHERE key = ?`, [META.receiptCounter]);
      return original(stmts);
    };
    await expect(commitSale(d.db, stale, d.ctx)).rejects.toThrow(/DB_ERROR/);
    d.db.transaction = original;
    expect(await listSales(d.db)).toHaveLength(3);
  });

  it('refuses tenders and prices the server would refuse', () => {
    return ready().then(async (d) => {
      const shift = await openShift(d.db, {
        cashier: d.sara,
        countedCashMinor: 0n,
        note: null,
        role: 'primary',
      });
      const base = {
        cart: teaCart('1'),
        cashier: d.sara,
        shift,
        supervisor: null,
        zeroTotalReason: null,
      };
      expect(() =>
        prepareSale({ ...base, payments: cash('0.200') }, d.ctx, d.catalog, d.methods),
      ).toThrow(/do not add up/);
      expect(() =>
        prepareSale(
          {
            ...base,
            payments: [{ methodId: CARD, amount: '0.250', tendered: null, reference: null }],
          },
          d.ctx,
          d.catalog,
          d.methods,
        ),
      ).toThrow(/reference/);
      const card = prepareSale(
        {
          ...base,
          payments: [{ methodId: CARD, amount: '0.250', tendered: null, reference: 'A1' }],
        },
        d.ctx,
        d.catalog,
        d.methods,
      );
      expect(card.record.payments[0]).toMatchObject({
        feeMinor: '5',
        changeMinor: '0',
        tenderedMinor: null,
      });
      const overridden: Cart = {
        lines: [
          { ...teaCart('1').lines[0]!, priceOverride: '0.050', priceOverrideReason: 'promo' },
        ],
        orderDiscount: null,
      };
      expect(() =>
        prepareSale(
          {
            ...base,
            cart: overridden,
            payments: cash('0.050'),
            supervisor: {
              member: d.omar,
              rights: ['sales.price_override', 'sales.discount.override_limit'],
              note: null,
            },
          },
          d.ctx,
          d.catalog,
          d.methods,
        ),
      ).toThrow(/outside the limits/);
      // Omar cannot lend to himself.
      expect(() =>
        prepareSale(
          {
            ...base,
            cashier: d.omar,
            cart: teaCart('1', { type: 'percent', value: '50' }),
            payments: cash('0.125'),
            supervisor: { member: d.omar, rights: ['sales.discount.override_limit'], note: null },
          },
          d.ctx,
          d.catalog,
          d.methods,
        ),
      ).toThrow(/another person/);
    });
  });
});

describe('cash, refunds and shift close', () => {
  it('records pay-outs within the drawer and the limits, refunds own sales with a second person, and closes with a Z summary', async () => {
    const d = await ready();
    const shift = await openShift(d.db, {
      cashier: d.sara,
      countedCashMinor: 1000n,
      note: null,
      role: 'primary',
    });
    const sale = await commitSale(
      d.db,
      prepareSale(
        {
          cart: teaCart('2'),
          payments: cash('0.500', '1.000'),
          cashier: d.sara,
          shift,
          supervisor: null,
          zeroTotalReason: null,
        },
        d.ctx,
        d.catalog,
        d.methods,
      ),
      d.ctx,
    );
    await expect(
      recordCashMovement(d.db, {
        cashier: d.sara,
        shift,
        direction: 'cash_out',
        amountMinor: 2000n,
        note: null,
        settings: d.ctx.settings,
        role: 'primary',
      }),
    ).rejects.toThrow(/INSUFFICIENT|hold/);
    const move = await recordCashMovement(d.db, {
      cashier: d.sara,
      shift,
      direction: 'cash_out',
      amountMinor: 300n,
      note: 'Ice',
      settings: d.ctx.settings,
      role: 'primary',
    });
    expect(move.limitExceeded).toBe(false);
    // A refund of Sara's own sale needs a second person who may approve.
    const refundable = (await refundableSale(d.db, sale.saleId))!;
    const base = {
      refundable,
      lines: [{ position: 0, quantity: '1' }],
      reason: 'changed_mind' as const,
      note: null,
      payback: null,
      cashier: d.sara,
      shift,
    };
    expect(() => prepareRefund({ ...base, approver: null }, d.ctx)).toThrow(/second person/);
    expect(() => prepareRefund({ ...base, approver: d.sara }, d.ctx)).toThrow(/own refund/);
    const prepared = prepareRefund({ ...base, approver: d.omar }, d.ctx);
    expect(prepared).toMatchObject({
      totalMinor: 250n,
      approvalReasons: ['own_sale'],
      cashPaybackMinor: 250n,
    });
    const refund = await commitRefund(d.db, prepared, { refundable, shift, approver: d.omar });
    expect(refund.refundNumber).toBe('MAIN-D1-000001-R1');
    const again = (await refundableSale(d.db, sale.saleId))!;
    expect(again.lines[0]).toMatchObject({ refundedMilli: 1000n, refundedMinor: 250n });
    expect(again.payments[0]!.refundedMinor).toBe(250n);
    // Nothing left after the second half is refunded; more is refused.
    const rest = prepareRefund({ ...base, refundable: again, approver: d.omar }, d.ctx);
    await commitRefund(d.db, rest, { refundable: again, shift, approver: d.omar });
    const empty = (await refundableSale(d.db, sale.saleId))!;
    expect(() => prepareRefund({ ...base, refundable: empty, approver: d.omar }, d.ctx)).toThrow(
      /More than was sold/,
    );
    // Only the opener closes normally; a manager can force-close with a note.
    await expect(
      closeShift(d.db, {
        cashier: d.omar,
        shift,
        countedCashMinor: 700n,
        note: null,
        role: 'primary',
      }),
    ).rejects.toThrow(/opened the shift/);
    const closed = await closeShift(d.db, {
      cashier: d.sara,
      shift,
      countedCashMinor: 700n,
      note: null,
      role: 'primary',
    });
    expect(closed.summary).toMatchObject({
      salesCount: 1,
      refundsCount: 2,
      cashSalesMinor: 500n,
      cashRefundsMinor: 500n,
      cashOutMinor: 300n,
      expectedCashMinor: 700n,
    });
    expect(closed).toMatchObject({ discrepancyMinor: 0n, outcome: 'balanced' });
    expect(closed.shift.status).toBe('closed');
    const kinds = (await listOutbox(d.db)).map((o) => o.kind);
    expect(kinds).toEqual([
      'shift_close',
      'refund',
      'refund',
      'cash_movement',
      'sale',
      'shift_open',
    ]);
  });
});

async function session(bridge: FakeBridge) {
  const d = { db: bridge.db };
  await applySnapshot(d.db, snapshot());
  const ctx = (await loadContext(d.db))!;
  const staff = await loadStaff(d.db);
  const sara = staff.find((s) => s.fullName === 'Sara')!;
  const catalog = await loadCatalog(d.db);
  const methods = await loadPaymentMethods(d.db);
  const shift = await openShift(d.db, {
    cashier: sara,
    countedCashMinor: 0n,
    note: null,
    role: 'primary',
  });
  const sale = await commitSale(
    d.db,
    prepareSale(
      {
        cart: teaCart('1'),
        payments: cash('0.250'),
        cashier: sara,
        shift,
        supervisor: null,
        zeroTotalReason: null,
      },
      ctx,
      catalog,
      methods,
    ),
    ctx,
  );
  return { ctx, sara, shift, sale };
}

describe('sync engine', () => {
  it('downloads a full snapshot first, then deltas with the stored version', async () => {
    const d = await device();
    const engine = new SyncEngine(d.bridge, d.db, { intervalMs: 60_000 });
    await engine.syncNow();
    expect(engine.current).toMatchObject({
      online: true,
      version: '2026-10-18T10:00:00.000Z',
      pending: 0,
      revoked: false,
    });
    expect((await loadContext(d.db))!.lastSuccessfulSyncAt).not.toBeNull();
    d.server.setDelta(snapshot({ full: false, version: 'v3', products: [], staff: [] }));
    await engine.syncNow();
    expect(engine.current.version).toBe('v3');
    expect((await loadCatalog(d.db)).items.size).toBe(2); // a delta keeps the products it does not mention
    expect(await loadStaff(d.db)).toEqual([]);
  });

  it('uploads the outbox in causal order, marks accepted / duplicate / refused, retries byte-identical bodies and syncs after an outage', async () => {
    const d = await device();
    const { sara, shift } = await session(d.bridge);
    await recordCashMovement(d.db, {
      cashier: sara,
      shift,
      direction: 'cash_in',
      amountMinor: 100n,
      note: 'refuse-me',
      settings: snapshot().settings,
      role: 'primary',
    });
    const engine = new SyncEngine(d.bridge, d.db, { intervalMs: 60_000 });
    d.server.setFail(true);
    await engine.syncNow();
    expect(engine.current).toMatchObject({ online: false, pending: 3 });
    expect(engine.current.lastError).toMatch(/NETWORK/);
    d.server.setFail(false);
    await engine.syncNow();
    expect(d.server.uploads[0]!.map((r) => (r as { kind: string }).kind)).toEqual([
      'shift_open',
      'sale',
      'cash_movement',
    ]);
    expect(engine.current).toMatchObject({ online: true, pending: 0, refused: 1, lastError: null });
    const refused = await listOutbox(d.db, 'refused');
    expect(refused[0]).toMatchObject({
      kind: 'cash_movement',
      code: 'VALIDATION_FAILED',
      attempts: 1,
    });
    // A permanent refusal is not resent; the accepted records are not resent either.
    await engine.syncNow();
    expect(d.server.uploads).toHaveLength(1);
    // The same bodies sent again (as after a crash before the answer was stored) are duplicates.
    const sent = (await listOutbox(d.db)).filter((o) => o.status === 'accepted');
    await d.db.transaction(
      sent.map((o) => ({
        sql: `UPDATE outbox SET status = 'pending' WHERE id = ?`,
        params: [o.id],
      })),
    );
    await engine.syncNow();
    const now = await listOutbox(d.db);
    expect(now.filter((o) => o.status === 'duplicate')).toHaveLength(2);
    expect(d.server.uploads[1]!).toEqual(
      d.server.uploads[0]!.filter((r) => (r as { kind: string }).kind !== 'cash_movement'),
    );
    expect((await outboxCounts(d.db)).pending).toBe(0);
  });

  it('retries a transient refusal and stores the server’s answer', async () => {
    const d = await device();
    await applySnapshot(d.db, snapshot());
    await openShift(d.db, {
      cashier: (await loadStaff(d.db))[2]!,
      countedCashMinor: 0n,
      note: null,
      role: 'primary',
    });
    const [entry] = await nextBatch(d.db);
    await applyResults(
      d.db,
      [
        {
          id: entry!.id,
          kind: 'shift_open',
          status: 'refused',
          result: null,
          code: 'SHIFT_REQUIRED',
          message: 'later',
          clockSkew: false,
        },
      ],
      'now',
    );
    expect((await nextBatch(d.db)).map((e) => e.id)).toEqual([entry!.id]);
    await applyResults(
      d.db,
      [
        {
          id: entry!.id,
          kind: 'shift_open',
          status: 'refused',
          result: null,
          code: 'TOTALS_MISMATCH',
          message: 'no',
          clockSkew: false,
        },
      ],
      'now',
    );
    // A refused shift_open is always retried (everything of the shift waits behind it).
    expect((await nextBatch(d.db)).map((e) => e.id)).toEqual([entry!.id]);
    expect((await listOutbox(d.db))[0]).toMatchObject({
      status: 'refused',
      code: 'TOTALS_MISMATCH',
      attempts: 2,
    });
    // A refusal of another kind with a terminal code stays refused.
    await recordSignIn(d.db, (await loadStaff(d.db))[0]!);
    const [, signIn] = await nextBatch(d.db);
    await applyResults(
      d.db,
      [
        {
          id: signIn!.id,
          kind: 'sign_in',
          status: 'refused',
          result: null,
          code: 'MEMBER_NOT_ALLOWED',
          message: 'no',
          clockSkew: false,
        },
      ],
      'now',
    );
    expect((await nextBatch(d.db)).map((e) => e.kind)).toEqual(['shift_open']);
  });

  it('stops on DEVICE_REVOKED (keeping unsent records, forgetting the token) and on MERCHANT_SUSPENDED', async () => {
    const d = await device();
    await session(d.bridge);
    const engine = new SyncEngine(d.bridge, d.db, { intervalMs: 60_000 });
    d.server.setAnswer('revoked');
    await engine.syncNow();
    expect(engine.current).toMatchObject({ revoked: true, pending: 2 });
    expect(d.bridge.token).toBeNull();
    expect(await d.bridge.api.isRegistered()).toBe(false);
    const e = await device();
    await session(e.bridge);
    const engine2 = new SyncEngine(e.bridge, e.db, { intervalMs: 60_000 });
    e.server.setAnswer('suspended');
    await engine2.syncNow();
    expect(engine2.current).toMatchObject({ suspended: true, pending: 2, revoked: false });
    e.server.setAnswer(null);
    await engine2.syncNow();
    expect(engine2.current).toMatchObject({ suspended: false, pending: 0 });
  });
});

describe('branch shift (ADR-0112 amendment 3)', () => {
  it('blocks selling behind a refused shift and re-uploads the refused records unchanged once the shift is taken', async () => {
    const d = await device();
    d.server.setRefuseShiftOpen('REGISTER_BUSY');
    const { ctx, sara, shift } = await session(d.bridge);
    const catalog = await loadCatalog(d.db);
    const methods = await loadPaymentMethods(d.db);
    const engine = new SyncEngine(d.bridge, d.db, { intervalMs: 60_000 });
    await engine.syncNow();
    // The cascade: the shift refused, its sale refused SHIFT_REQUIRED.
    expect((await listOutbox(d.db)).map((o) => [o.kind, o.status, o.code])).toEqual([
      ['sale', 'refused', 'SHIFT_REQUIRED'],
      ['shift_open', 'refused', 'REGISTER_BUSY'],
    ]);
    expect(await shiftAcceptance(d.db, shift)).toMatchObject({
      status: 'refused',
      code: 'REGISTER_BUSY',
    });
    // Selling, cash and refunds are blocked at once, with the reason.
    const prepared = prepareSale(
      {
        cart: teaCart('1'),
        payments: cash('0.250'),
        cashier: sara,
        shift,
        supervisor: null,
        zeroTotalReason: null,
      },
      ctx,
      catalog,
      methods,
    );
    await expect(commitSale(d.db, prepared, ctx)).rejects.toMatchObject({
      code: 'SHIFT_NOT_ACCEPTED',
    });
    await expect(
      recordCashMovement(d.db, {
        cashier: sara,
        shift,
        direction: 'cash_in',
        amountMinor: 100n,
        note: null,
        settings: ctx.settings,
        role: 'primary',
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_NOT_ACCEPTED' });
    // A shift with records cannot be discarded: its records would be lost.
    await expect(discardRefusedShift(d.db, shift)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // Every sync retries the shift (and so the sale behind it) with the same bytes.
    await engine.syncNow();
    expect(d.server.uploads).toHaveLength(2);
    expect(d.server.uploads[1]).toEqual(d.server.uploads[0]);
    // The cause is fixed on the server: the next retry takes the shift and the sale, unchanged.
    d.server.setRefuseShiftOpen(null);
    await engine.syncNow();
    expect(d.server.uploads[2]).toEqual(d.server.uploads[0]);
    expect((await listOutbox(d.db)).map((o) => [o.kind, o.status])).toEqual([
      ['sale', 'accepted'],
      ['shift_open', 'accepted'],
    ]);
    expect((await shiftAcceptance(d.db, shift)).status).toBe('accepted');
    const sale = await commitSale(d.db, prepared, ctx);
    expect(sale.receiptNumber).toBe('MAIN-D1-000002');
    // A refused shift without records can be discarded, so a new one can be opened.
    const e = await device();
    e.server.setRefuseShiftOpen('NOT_PRIMARY_DEVICE');
    await applySnapshot(e.db, snapshot());
    const staff = await loadStaff(e.db);
    const empty = await openShift(e.db, {
      cashier: staff[2]!,
      countedCashMinor: 0n,
      note: null,
      role: 'primary',
    });
    await new SyncEngine(e.bridge, e.db).syncNow();
    expect((await shiftAcceptance(e.db, empty)).status).toBe('refused');
    await discardRefusedShift(e.db, empty);
    expect(await openShiftOf(e.db)).toBeNull();
    expect(await listOutbox(e.db)).toEqual([]);
  });

  it('a secondary device sells into the primary’s branch shift learned from sync and never opens, closes or moves cash', async () => {
    const d = await device();
    const branchShift = {
      id: U(500),
      status: 'open' as const,
      registerId: U(4),
      registerCode: 'R1',
      openedAt: '2026-10-18T09:30:00.000Z',
      closedAt: null,
      openedBy: { membershipId: U(10), userId: U(11), fullName: 'Sara' },
    };
    // An unbound device (amendment 4): its own code, no register, card / transfer only.
    const secondary = (partial: Partial<DeviceSnapshot> = {}) =>
      snapshot({
        device: {
          ...snapshot().device,
          role: 'secondary',
          code: 'D3',
          registerId: null,
          registerCode: null,
          registerName: null,
        },
        register: null,
        branchShift,
        ...partial,
      });
    await applySnapshot(d.db, secondary());
    const ctx = (await loadContext(d.db))!;
    const staff = await loadStaff(d.db);
    const omar = staff.find((s) => s.fullName === 'Omar')!;
    const shift = (await openShiftOf(d.db))!;
    expect(shift).toMatchObject({ id: U(500), origin: 'branch', membershipId: U(10) });
    expect(ctx.branchShift).toEqual(branchShift);
    expect(ctx.primaryDevice).toEqual({ id: U(1), name: 'Till' });
    expect((await shiftAcceptance(d.db, shift)).status).toBe('branch');
    await expect(
      openShift(d.db, { cashier: omar, countedCashMinor: 0n, note: null, role: 'secondary' }),
    ).rejects.toMatchObject({ code: 'NOT_PRIMARY_DEVICE' });
    await expect(
      recordCashMovement(d.db, {
        cashier: omar,
        shift,
        direction: 'cash_in',
        amountMinor: 100n,
        note: null,
        settings: ctx.settings,
        role: 'secondary',
      }),
    ).rejects.toMatchObject({ code: 'NOT_PRIMARY_DEVICE' });
    await expect(
      closeShift(d.db, {
        cashier: omar,
        shift,
        countedCashMinor: 0n,
        note: null,
        role: 'secondary',
      }),
    ).rejects.toMatchObject({ code: 'NOT_PRIMARY_DEVICE' });
    // No drawer: cash is refused; Omar sells by card into Sara's branch shift, and the sale
    // carries the branch shift and his own name.
    const catalog = await loadCatalog(d.db);
    const methods = await loadPaymentMethods(d.db);
    const input = {
      cart: teaCart('1'),
      cashier: omar,
      shift,
      supervisor: null,
      zeroTotalReason: null,
    };
    expect(() => prepareSale({ ...input, payments: cash('0.250') }, ctx, catalog, methods)).toThrow(
      /CASH_NOT_ALLOWED|no cash drawer/,
    );
    const sale = await commitSale(
      d.db,
      prepareSale(
        {
          ...input,
          payments: [{ methodId: CARD, amount: '0.250', tendered: null, reference: 'A1' }],
        },
        ctx,
        catalog,
        methods,
      ),
      ctx,
    );
    expect(sale.record).toMatchObject({ shiftId: U(500), membershipId: U(20) });
    expect(sale.receiptNumber).toBe('MAIN-D3-000001');
    expect((await listOutbox(d.db)).map((o) => o.kind)).toEqual(['sale']);
    // The primary closed the branch shift: the next sync closes it here too.
    await applySnapshot(
      d.db,
      secondary({
        branchShift: { ...branchShift, status: 'closed', closedAt: '2026-10-18T18:00:00.000Z' },
        full: false,
        version: 'v2',
      }),
    );
    expect(await openShiftOf(d.db)).toBeNull();
    expect(await getShift(d.db, U(500))).toMatchObject({
      status: 'closed',
      closedBy: 'server',
      closedAt: '2026-10-18T18:00:00.000Z',
    });
    // No branch shift: nothing to sell into.
    await applySnapshot(d.db, secondary({ branchShift: null, full: false, version: 'v3' }));
    expect(await openShiftOf(d.db)).toBeNull();
    // A new branch shift appears: it replaces the old one.
    await applySnapshot(
      d.db,
      secondary({ branchShift: { ...branchShift, id: U(501) }, full: false, version: 'v4' }),
    );
    expect((await openShiftOf(d.db))?.id).toBe(U(501));
  });

  it('closes the primary’s own shift when a manager closed it online, records sign-ins, and lets a manager force-close with a note', async () => {
    const d = await ready();
    await recordSignIn(d.db, d.sara);
    const shift = await openShift(d.db, {
      cashier: d.sara,
      countedCashMinor: 0n,
      note: null,
      role: 'primary',
    });
    expect((await listOutbox(d.db)).map((o) => o.kind)).toEqual(['shift_open', 'sign_in']);
    // A manager without the right, or without a note, cannot force-close.
    await expect(
      closeShift(d.db, {
        cashier: d.omar,
        shift,
        countedCashMinor: 0n,
        note: 'x',
        role: 'primary',
        forced: true,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const manager = { ...d.owner, permissions: [...d.owner.permissions, 'registers.manage'] };
    await expect(
      closeShift(d.db, {
        cashier: manager,
        shift,
        countedCashMinor: 0n,
        note: null,
        role: 'primary',
        forced: true,
      }),
    ).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const closed = await closeShift(d.db, {
      cashier: manager,
      shift,
      countedCashMinor: 0n,
      note: 'Sara left',
      role: 'primary',
      forced: true,
    });
    expect(closed.shift).toMatchObject({ status: 'closed', closedBy: 'forced' });
    const [close] = await listOutbox(d.db);
    expect(JSON.parse(close!.body)).toMatchObject({
      kind: 'shift_close',
      membershipId: d.owner.membershipId,
      forced: true,
      note: 'Sara left',
    });
    // The primary's next shift, closed by a manager online: the snapshot says so.
    const again = await openShift(d.db, {
      cashier: d.sara,
      countedCashMinor: 0n,
      note: null,
      role: 'primary',
    });
    await applySnapshot(
      d.db,
      snapshot({
        full: false,
        version: 'v2',
        branchShift: {
          id: again.id,
          status: 'closed',
          registerId: U(4),
          registerCode: 'R2',
          openedAt: again.openedAt,
          closedAt: '2026-10-18T20:00:00.000Z',
          openedBy: { membershipId: U(10), userId: U(11), fullName: 'Sara' },
        },
      }),
    );
    expect(await openShiftOf(d.db)).toBeNull();
    expect(await getShift(d.db, again.id)).toMatchObject({ status: 'closed', closedBy: 'server' });
  });
});
