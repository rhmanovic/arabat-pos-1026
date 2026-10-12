import { hash } from '@node-rs/argon2';
import type { PlatformRole } from '@arabat/permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { newId } from '../../kernel/ids.js';
import {
  ApiClient,
  DbFixtures,
  PASSWORD,
  createCompany,
  registerOwner,
  sessionCookie,
  uniqueEmail,
} from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { upsertOperator } from './operators.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
let runtime: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;
let passwordHash: string;
type Cookies = Record<string, string>;
const ops = {} as Record<'super' | 'support' | 'billing', Cookies>;

async function operator(role: PlatformRole): Promise<Cookies> {
  const email = uniqueEmail('op');
  const secret = generateTotpSecret();
  const client = await owner.connect();
  try {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    await drizzle({ client, casing: 'snake_case' }).transaction((tx) =>
      upsertOperator(tx as never, {
        email,
        fullName: `Operator ${role}`,
        role,
        passwordHash,
        encryptionKey: TEST_MFA_KEY,
        totpSecret: secret,
      }),
    );
  } finally {
    client.release();
  }
  const api = new ApiClient(app);
  const step1 = (
    await api.request('POST', '/auth/platform/login', { body: { email, password: PASSWORD } })
  ).json();
  const done = await api.request('POST', '/auth/platform/mfa', {
    body: { ticket: step1.ticket, code: totpCode(secret, totpStep()) },
  });
  return sessionCookie(done, 'platform');
}

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  runtime = new pg.Pool({ connectionString: prepared.runtimeUrl, max: 2 });
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  app = await createTestApp({
    env: testEnv({ DATABASE_URL: prepared.runtimeUrl, DATABASE_POOL_MAX: '20' }),
    mailer,
  });
  passwordHash = await hash(PASSWORD, { algorithm: 2 });
  ops.super = await operator('platform.super_admin');
  ops.support = await operator('platform.support');
  ops.billing = await operator('platform.billing');
});
afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await owner?.end();
});

const api = () => new ApiClient(app);
async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  cookies?: Cookies,
  body?: unknown,
) {
  return api().request(method, path, {
    ...(cookies ? { cookies } : {}),
    ...(body === undefined ? {} : { body }),
  });
}
async function ok(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  cookies: Cookies,
  body?: unknown,
) {
  const r = await call(method, path, cookies, body);
  if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
  return r.json();
}
const planId = async (code: string) =>
  ((await ok('GET', '/platform/plans', ops.billing)).plans as { id: string; code: string }[]).find(
    (p) => p.code === code,
  )!.id;
async function assignPlan(merchantId: string, code: string, status = 'active') {
  const detail = await ok('GET', `/platform/merchants/${merchantId}`, ops.billing);
  return call('PUT', `/platform/merchants/${merchantId}/subscription`, ops.billing, {
    planId: await planId(code),
    status,
    reason: `Assign ${code}`,
    version: detail.subscription.version,
  });
}
async function loginManager(email: string) {
  return call('POST', '/auth/login', undefined, {
    interface: 'manager',
    email,
    password: PASSWORD,
  });
}

describe('platform access', () => {
  it('keeps merchant users out of /platform and enforces operator roles', async () => {
    const c = await createCompany(app, db, mailer);
    // Merchant sessions (owner, manager, POS) and anonymous callers never reach platform APIs.
    for (const cookies of [
      undefined,
      c.cookies,
      { plat_sid: c.cookies['mgr_sid']! },
      await c.ownerPos(c.main),
    ])
      expect((await call('GET', '/platform/merchants', cookies)).statusCode).toBe(401);
    // An operator session does not open merchant APIs either.
    expect(
      (await call('GET', '/manager/subscription', { mgr_sid: ops.super['plat_sid']! })).statusCode,
    ).toBe(401);

    const detail = await ok('GET', `/platform/merchants/${c.merchantId}`, ops.billing);
    const status = { status: 'suspended', reason: 'Fraud check', version: detail.version };
    // Billing cannot suspend; support cannot change subscriptions or close; billing cannot read the audit log.
    expect(
      (await call('POST', `/platform/merchants/${c.merchantId}/status`, ops.billing, status))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await call('PUT', `/platform/merchants/${c.merchantId}/subscription`, ops.support, {
          planId: await planId('basic'),
          status: 'active',
          reason: 'x',
          version: detail.subscription.version,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('POST', `/platform/merchants/${c.merchantId}/status`, ops.support, {
          ...status,
          status: 'closed',
        })
      ).statusCode,
    ).toBe(403);
    expect((await call('GET', '/platform/audit', ops.billing)).statusCode).toBe(403);
    expect((await call('POST', '/platform/plans', ops.support, {})).statusCode).toBe(403);
    expect((await call('GET', `/platform/merchants/${newId()}`, ops.support)).statusCode).toBe(404);
  });
});

describe('merchant oversight', () => {
  it('lists and searches merchants with usage and shows a merchant only its own subscription', async () => {
    const a = await createCompany(app, db, mailer);
    const b = await createCompany(app, db, mailer);
    const name = `Searchable ${Date.now()}`;
    await owner.query(`update merchants set display_name_en = $1 where id = $2`, [
      name,
      a.merchantId,
    ]);
    const found = await ok(
      'GET',
      `/platform/merchants?q=${encodeURIComponent(name.toLowerCase())}`,
      ops.support,
    );
    expect(found.total).toBe(1);
    expect(found.merchants[0]).toMatchObject({
      id: a.merchantId,
      status: 'active',
      branchCount: 2,
      employeeCount: 0,
      planCode: 'standard',
      subscriptionStatus: 'trialing',
      ownerEmail: a.email,
    });
    expect((await ok('GET', `/platform/merchants?q=${a.email}`, ops.support)).merchants[0].id).toBe(
      a.merchantId,
    );
    // Wildcards are text, not patterns.
    expect((await ok('GET', '/platform/merchants?q=%25%25%25', ops.support)).total).toBe(0);

    await a.hire([{ roleId: a.roles.cashier, branchId: a.main }], 'pos');
    const detail = await ok('GET', `/platform/merchants/${a.merchantId}`, ops.support);
    expect(detail.subscription.usage).toMatchObject({
      branches: { used: 2, max: null },
      employees: { used: 1, max: null },
      registers: { used: 2, max: null },
    });
    expect(detail.owner).toMatchObject({ email: a.email });
    expect(detail.onboarding).toMatchObject({
      ownerSignedIn: true,
      hasProducts: false,
      hasSales: false,
    });
    expect(detail.branches.map((x: { code: string }) => x.code)).toEqual(['MAIN', 'B2']);
    expect(detail.subscriptionEvents[0]).toMatchObject({ kind: 'created', toPlan: 'standard' });

    // The merchant sees its own subscription and the public plans — nothing about others.
    await assignPlan(b.merchantId, 'professional');
    const own = await ok('GET', '/manager/subscription', a.cookies);
    expect(own).toMatchObject({ plan: { code: 'standard' }, effectiveStatus: 'trialing' });
    expect(own.availablePlans.map((p: { code: string }) => p.code)).toEqual(
      expect.arrayContaining(['standard', 'basic', 'professional']),
    );
    expect(JSON.stringify(own)).not.toContain(b.merchantId);
    expect((await ok('GET', '/manager/subscription', b.cookies)).plan.code).toBe('professional');

    // Database: RLS hides other merchants' subscriptions, and merchant code paths cannot change
    // a subscription or a merchant status (operator context required).
    const client = await runtime.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.merchant_id', $1, true)`, [a.merchantId]);
      const visible = await client.query('select merchant_id from subscriptions');
      expect(visible.rows.map((r) => r.merchant_id)).toEqual([a.merchantId]);
      await expect(client.query(`update subscriptions set notes = 'x'`)).rejects.toThrow(
        /platform operators only/,
      );
      await client.query('rollback');
      await client.query('begin');
      await client.query(`select set_config('app.merchant_id', $1, true)`, [a.merchantId]);
      await expect(client.query(`update merchants set status = 'suspended'`)).rejects.toThrow(
        /platform operators only/,
      );
      await client.query('rollback');
      await client.query('begin');
      await client.query(`select set_config('app.merchant_id', $1, true)`, [a.merchantId]);
      await expect(client.query('delete from subscriptions')).rejects.toThrow(/permission denied/);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('merchant status', () => {
  it('suspends a merchant everywhere at once, audits it, and reactivates it', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const slug = `susp-${Date.now().toString(36)}`;
    await db.inMerchant(c.merchantId, (q) =>
      q.query(
        `insert into online_stores (merchant_id, slug, status, name_en, fulfillment_branch_id) values ($1, $2, 'published', 'Shop', $3)`,
        [c.merchantId, slug, c.main],
      ),
    );
    expect((await call('GET', `/store/${slug}`)).statusCode).toBe(200);

    let detail = await ok('GET', `/platform/merchants/${c.merchantId}`, ops.support);
    expect(
      (
        await call('POST', `/platform/merchants/${c.merchantId}/status`, ops.support, {
          status: 'suspended',
          reason: 'Unpaid invoice',
          version: detail.version + 1,
        })
      ).json().code,
    ).toBe('VERSION_CONFLICT');
    detail = await ok('POST', `/platform/merchants/${c.merchantId}/status`, ops.support, {
      status: 'suspended',
      reason: 'Unpaid invoice',
      version: detail.version,
    });
    expect(detail.status).toBe('suspended');

    // Sessions, sign-in, invitations and the public store all stop.
    expect((await call('GET', '/manager/merchant', c.cookies)).statusCode).toBe(401);
    expect((await call('GET', '/pos/registers', cashier.cookies)).statusCode).toBe(401);
    const login = await loginManager(c.email);
    expect(login.statusCode).toBe(403);
    expect(login.json().code).toBe('MERCHANT_SUSPENDED');
    expect((await call('GET', `/store/${slug}`)).statusCode).toBe(404);

    // Audited for the platform and visible to the merchant's own audit trail.
    const audit = await ok(
      'GET',
      `/platform/audit?merchantId=${c.merchantId}&action=suspended`,
      ops.super,
    );
    expect(audit.entries[0]).toMatchObject({
      action: 'platform.merchant.suspended',
      actorType: 'operator',
      actorName: 'Operator platform.support',
      details: { from: 'active', to: 'suspended', reason: 'Unpaid invoice', sessionsEnded: 2 },
    });
    const own = await owner.query(
      `select action from audit_log where merchant_id = $1 and action like 'platform.%'`,
      [c.merchantId],
    );
    expect(own.rows.map((r) => r.action)).toContain('platform.merchant.suspended');

    detail = await ok('POST', `/platform/merchants/${c.merchantId}/status`, ops.support, {
      status: 'active',
      reason: 'Paid',
      version: detail.version,
    });
    expect((await loginManager(c.email)).statusCode).toBe(200);
    expect((await call('GET', `/store/${slug}`)).statusCode).toBe(200);

    // Closing is final and reserved to super admins.
    detail = await ok('POST', `/platform/merchants/${c.merchantId}/status`, ops.super, {
      status: 'closed',
      reason: 'Owner request',
      version: detail.version,
    });
    const reopen = await call('POST', `/platform/merchants/${c.merchantId}/status`, ops.super, {
      status: 'active',
      reason: 'Oops',
      version: detail.version,
    });
    expect(reopen.json().code).toBe('INVALID_STATE');
    expect((await loginManager(c.email)).json().code).toBe('MERCHANT_SUSPENDED');
  });
});

describe('plan limits', () => {
  it('enforces branch, register, employee, product and feature limits', async () => {
    const client = api();
    const o = await registerOwner(client);
    expect((await assignPlan(o.merchantId, 'basic')).statusCode).toBe(200);
    const mreq = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown) =>
      call(method, path, o.cookies, body);

    const branch = await mreq('POST', '/manager/branches', { code: 'B2', nameEn: 'Second' });
    expect(branch.statusCode).toBe(409);
    expect(branch.json().code).toBe('PLAN_LIMIT_REACHED');
    const main = await db.mainBranch(o.merchantId);
    expect(
      (
        await mreq('POST', '/manager/registers', { branchId: main, code: 'R2', nameEn: 'R2' })
      ).json().code,
    ).toBe('PLAN_LIMIT_REACHED');
    const roles = (await mreq('GET', '/manager/roles')).json().roles as {
      id: string;
      templateKey: string;
    }[];
    const cashier = roles.find((r) => r.templateKey === 'cashier')!.id;
    const invite = () =>
      mreq('POST', '/manager/employees/invitations', {
        email: uniqueEmail('inv'),
        fullName: 'Invitee',
        assignments: [{ roleId: cashier, branchId: main }],
      });
    for (let i = 0; i < 3; i += 1) expect((await invite()).statusCode).toBe(201);
    expect((await invite()).json().code).toBe('PLAN_LIMIT_REACHED');

    // Features: restaurant and a published online store need a plan that includes them.
    const restaurant = await mreq('PUT', '/manager/restaurant/settings', {
      enabled: true,
      autoSendOnPayment: true,
      version: 0,
    });
    expect(restaurant.json().code).toBe('PLAN_FEATURE_UNAVAILABLE');
    const store = {
      slug: `lim-${Date.now().toString(36)}`,
      status: 'draft',
      nameEn: 'Shop',
      primaryColor: '#123456',
      fulfillmentBranchId: main,
      pickupEnabled: true,
      deliveryEnabled: false,
      deliveryFee: '0',
      minimumOrder: '0',
      reservationMinutes: 30,
      version: 0,
    };
    expect((await mreq('PUT', '/manager/online/store', store)).statusCode).toBe(200);
    expect(
      (
        await mreq('PUT', '/manager/online/store', { ...store, status: 'paused', version: 1 })
      ).json().code,
    ).toBe('PLAN_FEATURE_UNAVAILABLE');

    // Products: concurrent creations never exceed the limit (subscription row lock).
    const code = `p${Date.now().toString(36)}`;
    const plan = await ok('POST', '/platform/plans', ops.billing, {
      code,
      nameEn: 'Tiny',
      nameAr: 'صغيرة',
      status: 'active',
      isDefault: false,
      isPublic: false,
      limits: { branches: 1, employees: 5, products: 3, registers: 1 },
      features: [],
      price: '12.500',
      billingPeriod: 'month',
      trialDays: 0,
      sortOrder: 99,
      version: 0,
    });
    expect(plan.price).toEqual({ amount: '12.500', currency: 'KWD' });
    expect((await assignPlan(o.merchantId, code)).statusCode).toBe(200);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        mreq('POST', '/manager/products', {
          nameEn: `Item ${i}`,
          variants: [{ sku: `S${i}`, price: '1.000' }],
        }),
      ),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect(results.filter((r) => r.json().code === 'PLAN_LIMIT_REACHED')).toHaveLength(3);
    const usage = (await ok('GET', '/manager/subscription', o.cookies)).usage;
    expect(usage).toMatchObject({ products: { used: 3, max: 3 }, employees: { used: 3, max: 5 } });
    // Archiving frees a slot; restoring needs one.
    const first = results.find((r) => r.statusCode === 201)!.json();
    await ok('POST', `/manager/products/${first.id}/status`, o.cookies, { status: 'archived' });
    expect(
      (
        await mreq('POST', '/manager/products', {
          nameEn: 'Late',
          variants: [{ sku: 'LATE', price: '1.000' }],
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await mreq('POST', `/manager/products/${first.id}/status`, { status: 'active' })).json()
        .code,
    ).toBe('PLAN_LIMIT_REACHED');
  });

  it('checks upgrades and downgrades against current usage and records each change', async () => {
    const c = await createCompany(app, db, mailer);
    const basic = await planId('basic');
    const check = await ok(
      'GET',
      `/platform/merchants/${c.merchantId}/plan-check?planId=${basic}`,
      ops.billing,
    );
    expect(check).toMatchObject({
      fits: false,
      direction: 'downgrade',
      issues: expect.arrayContaining([
        { kind: 'limit', key: 'branches', used: 2, max: 1 },
        { kind: 'limit', key: 'registers', used: 2, max: 1 },
      ]),
    });
    const blocked = await assignPlan(c.merchantId, 'basic');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('PLAN_CHANGE_BLOCKED');

    const professional = await planId('professional');
    expect(
      (
        await ok(
          'GET',
          `/platform/merchants/${c.merchantId}/plan-check?planId=${professional}`,
          ops.billing,
        )
      ).fits,
    ).toBe(true);
    const view = (await assignPlan(c.merchantId, 'professional', 'past_due')).json();
    expect(view).toMatchObject({
      plan: { code: 'professional' },
      status: 'past_due',
      effectiveStatus: 'past_due',
    });
    // Status and dates are stored, never billed: a lapsed subscription does not block work (BR-155).
    expect((await call('GET', '/manager/merchant', c.cookies)).statusCode).toBe(200);

    const detail = await ok('GET', `/platform/merchants/${c.merchantId}`, ops.support);
    expect(detail.subscriptionEvents[0]).toMatchObject({
      kind: 'changed',
      fromPlan: 'standard',
      toPlan: 'professional',
      fromStatus: 'trialing',
      toStatus: 'past_due',
      operatorName: 'Operator platform.billing',
      reason: 'Assign professional',
    });
    // Stale versions are refused.
    const stale = await call(
      'PUT',
      `/platform/merchants/${c.merchantId}/subscription`,
      ops.billing,
      {
        planId: professional,
        status: 'active',
        reason: 'again',
        version: 1,
      },
    );
    expect(stale.json().code).toBe('VERSION_CONFLICT');
  });
});

describe('onboarding and plans', () => {
  it('creates a merchant with its owner, who sets a password from the e-mail and signs in', async () => {
    const email = uniqueEmail('newowner');
    const created = await ok('POST', '/platform/merchants', ops.support, {
      nameEn: 'Onboarded Co',
      defaultLanguage: 'en',
      planId: await planId('professional'),
      owner: { fullName: 'New Owner', email },
    });
    expect(created).toMatchObject({
      nameEn: 'Onboarded Co',
      status: 'active',
      owner: { email, lastLoginAt: null },
      subscription: { plan: { code: 'professional' }, status: 'active' },
      onboarding: { ownerSignedIn: false },
    });
    const mail = [...mailer.outbox].reverse().find((m) => m.to === email)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    expect((await loginManager(email)).statusCode).toBe(401); // no usable password yet
    expect(
      (
        await call('POST', '/auth/password/reset', undefined, {
          token,
          password: 'Fresh-Owner-2026',
        })
      ).statusCode,
    ).toBe(200);
    const login = await call('POST', '/auth/login', undefined, {
      interface: 'manager',
      email,
      password: 'Fresh-Owner-2026',
    });
    expect(login.statusCode).toBe(200);
    const sub = await ok('GET', '/manager/subscription', sessionCookie(login, 'manager'));
    expect(sub.plan.code).toBe('professional');

    // An existing account becomes owner of the new company, keeping its password.
    const other = await createCompany(app, db, mailer);
    const second = await ok('POST', '/platform/merchants', ops.super, {
      nameAr: 'شركة ثانية',
      defaultLanguage: 'ar',
      owner: { fullName: 'Ignored', email: other.email },
    });
    expect(second.owner.email).toBe(other.email);
    expect(second.subscription.plan.code).toBe('standard');
    expect((await loginManager(other.email)).json().status).toBe('select_merchant');
    const audit = await ok('GET', `/platform/audit?merchantId=${second.id}`, ops.super);
    expect(audit.entries[0]).toMatchObject({
      action: 'platform.merchant.created',
      details: { existingOwnerAccount: true },
    });
    // Billing operators cannot onboard merchants.
    expect(
      (
        await call('POST', '/platform/merchants', ops.billing, {
          nameEn: 'X',
          defaultLanguage: 'en',
          owner: { fullName: 'X', email: uniqueEmail('x') },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('manages plans: unique codes, one default, exact prices, overview counts', async () => {
    const base = {
      nameEn: 'Seasonal',
      nameAr: 'موسمية',
      status: 'active',
      isDefault: false,
      isPublic: true,
      limits: { branches: 2, employees: null, products: null, registers: 2 },
      features: ['restaurant'],
      price: null,
      billingPeriod: null,
      trialDays: 14,
      sortOrder: 50,
      version: 0,
    };
    const code = `s${Date.now().toString(36)}`;
    const plan = await ok('POST', '/platform/plans', ops.billing, { ...base, code });
    expect(plan).toMatchObject({
      code,
      merchantCount: 0,
      price: null,
      limits: { employees: null },
    });
    expect(
      (
        await call('POST', '/platform/plans', ops.billing, { ...base, code: code.toUpperCase() })
      ).json().code,
    ).toBe('DUPLICATE_CODE');
    expect(
      (
        await call('POST', '/platform/plans', ops.billing, {
          ...base,
          code: `${code}x`,
          price: '5.000',
        })
      ).statusCode,
    ).toBe(400);

    // Moving the default keeps exactly one default; the default cannot simply be unset.
    const standard = (await ok('GET', '/platform/plans', ops.billing)).plans.find(
      (p: { code: string }) => p.code === 'standard',
    );
    const moved = await ok('PUT', `/platform/plans/${plan.id}`, ops.billing, {
      ...base,
      code,
      isDefault: true,
      version: plan.version,
    });
    expect(moved.isDefault).toBe(true);
    const plansNow = (await ok('GET', '/platform/plans', ops.billing)).plans as {
      isDefault: boolean;
    }[];
    expect(plansNow.filter((p) => p.isDefault)).toHaveLength(1);
    const back = await ok('PUT', `/platform/plans/${standard.id}`, ops.billing, {
      ...base,
      code: 'standard',
      nameEn: standard.nameEn,
      nameAr: standard.nameAr,
      limits: standard.limits,
      features: standard.features,
      trialDays: standard.trialDays,
      sortOrder: standard.sortOrder,
      isDefault: true,
      version: standard.version,
    });
    expect(back.isDefault).toBe(true);
    const unset = await call('PUT', `/platform/plans/${standard.id}`, ops.billing, {
      ...base,
      code: 'standard',
      isDefault: false,
      version: back.version,
    });
    expect(unset.json().code).toBe('INVALID_STATE');

    const overview = await ok('GET', '/platform/overview', ops.billing);
    expect(overview.merchants.total).toBeGreaterThan(0);
    expect(overview.subscriptions.byPlan.some((p: { code: string }) => p.code === 'standard')).toBe(
      true,
    );
    const audit = await ok('GET', '/platform/audit?action=platform.plan', ops.super);
    expect(
      audit.entries.some((e: { action: string }) => e.action === 'platform.plan.created'),
    ).toBe(true);
  });
});
