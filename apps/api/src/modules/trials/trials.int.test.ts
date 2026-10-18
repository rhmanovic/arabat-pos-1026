import { hash } from '@node-rs/argon2';
import type { PlatformRole } from '@arabat/permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { ApiClient, PASSWORD, sessionCookie, uniqueEmail } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { upsertOperator } from '../platform-admin/operators.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
let mailer: InMemoryMailer;
type Cookies = Record<string, string>;
const ops = {} as Record<'support' | 'billing', Cookies>;

async function operator(role: PlatformRole): Promise<Cookies> {
  const email = uniqueEmail('op');
  const secret = generateTotpSecret();
  const client = await owner.connect();
  try {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    await drizzle({ client, casing: 'snake_case' }).transaction(async (tx) =>
      upsertOperator(tx as never, {
        email,
        fullName: `Operator ${role}`,
        role,
        passwordHash: await hash(PASSWORD, { algorithm: 2 }),
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
  mailer = new InMemoryMailer();
  app = await createTestApp({
    env: testEnv({ DATABASE_URL: prepared.runtimeUrl, SALES_NOTIFY_EMAIL: 'sales@test.arabat' }),
    mailer,
  });
  ops.support = await operator('platform.support');
  ops.billing = await operator('platform.billing');
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

type Method = 'GET' | 'POST' | 'PUT';
const call = (
  method: Method,
  path: string,
  cookies?: Cookies,
  body?: unknown,
  client?: ApiClient,
) =>
  (client ?? new ApiClient(app)).request(method, path, {
    ...(cookies ? { cookies } : {}),
    ...(body === undefined ? {} : { body }),
  });
async function ok(method: Method, path: string, cookies?: Cookies, body?: unknown) {
  const r = await call(method, path, cookies, body);
  if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
  return r.statusCode === 204 ? null : r.json();
}
const codeFor = (email: string) => /\b(\d{6})\b/.exec(mailer.lastTo(email)!.text)![1]!;

async function device(name: string, trialStock: number) {
  const item = await ok('POST', '/platform/offer-items', ops.billing, {
    nameAr: `جهاز ${name}`,
    nameEn: `Device ${name}`,
    price: '10.000',
    icon: 'tablet',
    maxQuantity: 5,
    status: 'active',
    sortOrder: 900,
    version: 0,
  });
  await ok('PUT', `/platform/trials/stock/${item.id}`, ops.billing, {
    trialStock,
    version: item.version,
  });
  return item;
}

describe('trial funnel', () => {
  it('turns a demo receipt into a lead, e-mails the receipt priced on the server, and counts steps', async () => {
    const sessionId = randomUUID();
    await ok('POST', '/public/trial/events', undefined, { sessionId, step: 'business' });
    await ok('POST', '/public/trial/events', undefined, { sessionId, step: 'business' });
    await ok('POST', '/public/trial/events', undefined, { sessionId, step: 'demo' });
    const email = uniqueEmail('lead');
    await ok('POST', '/public/trial/demo-receipt', undefined, {
      email,
      businessType: 'cafe',
      language: 'ar',
      sessionId,
      lines: [
        { key: 'latte', quantity: 2 },
        { key: 'croissant', quantity: 1 },
      ],
    });
    expect(mailer.lastTo(email)!.text).toContain('3.750 KWD');
    expect(mailer.lastTo('sales@test.arabat')!.text).toContain(email);

    const bad = await call('POST', '/public/trial/demo-receipt', undefined, {
      email,
      businessType: 'cafe',
      language: 'ar',
      sessionId,
      lines: [{ key: 'free-gold', quantity: 1 }],
    });
    expect(bad.statusCode).toBe(400);

    const leads = await ok('GET', '/platform/trials/leads?stage=receipt', ops.support);
    expect(leads.leads.find((l: { email: string }) => l.email === email)).toMatchObject({
      stage: 'receipt',
      businessType: 'cafe',
    });
    const funnel = await ok('GET', '/platform/trials/funnel?days=7', ops.support);
    const step = (s: string) => funnel.steps.find((x: { step: string }) => x.step === s).sessions;
    expect(step('business')).toBeGreaterThanOrEqual(1);
    expect(step('receipt')).toBeGreaterThanOrEqual(1);
  });

  it('confirms the e-mail with a code, then opens a trial account with the operator’s length', async () => {
    const settings = await ok('GET', '/platform/trials/settings', ops.support);
    expect((await call('PUT', '/platform/trials/settings', ops.support, settings)).statusCode).toBe(
      403,
    );
    const saved = await ok('PUT', '/platform/trials/settings', ops.billing, {
      trialDaysOwn: 21,
      trialDaysDevices: 10,
      waitlistEnabled: true,
      version: settings.version,
    });
    expect(saved).toMatchObject({ trialDaysOwn: 21, trialDaysDevices: 10 });
    expect((await ok('GET', '/public/trial')).trialDaysOwn).toBe(21);

    const email = uniqueEmail('trial');
    const client = new ApiClient(app);
    const started = await call(
      'POST',
      '/public/trial/start',
      undefined,
      {
        fullName: 'Fatma',
        email,
        password: 'Strong-Pass-2026',
        companyName: null,
        businessType: 'retail',
        language: 'ar',
        sessionId: randomUUID(),
        devices: [],
      },
      client,
    );
    expect(started.statusCode).toBe(201);
    const { signupId } = started.json();
    // No account before the code is confirmed.
    expect((await owner.query('select 1 from users where email = $1', [email])).rowCount).toBe(0);

    const wrong = await call('POST', '/public/trial/verify', undefined, {
      signupId,
      code: codeFor(email) === '000000' ? '111111' : '000000',
    });
    expect(wrong.json().code).toBe('INVALID_CODE');

    const verified = await call(
      'POST',
      '/public/trial/verify',
      undefined,
      { signupId, code: codeFor(email) },
      client,
    );
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({
      trialDays: 21,
      devices: 'none',
      redirectTo: '/manager/',
    });
    const cookies = sessionCookie(verified, 'manager');
    expect((await call('GET', '/auth/manager/me', cookies)).statusCode).toBe(200);

    const { rows } = await owner.query(
      `select s.status, s.trial_ends_at - now() > interval '20 days' as long_enough, m.display_name_ar
         from users u join memberships ms on ms.user_id = u.id and ms.is_owner
         join merchants m on m.id = ms.merchant_id join subscriptions s on s.merchant_id = m.id
        where u.email = $1`,
      [email],
    );
    expect(rows[0]).toMatchObject({
      status: 'trialing',
      long_enough: true,
      display_name_ar: 'Fatma',
    });

    // The code works once; the e-mail is now taken.
    expect(
      (await call('POST', '/public/trial/verify', undefined, { signupId, code: codeFor(email) }))
        .statusCode,
    ).toBe(400);
    const again = await call('POST', '/public/trial/start', undefined, {
      fullName: 'Fatma',
      email,
      password: 'Strong-Pass-2026',
      businessType: 'retail',
      language: 'ar',
      sessionId: randomUUID(),
      devices: [],
    });
    expect(again.json().code).toBe('EMAIL_ALREADY_REGISTERED');

    const lead = (await ok('GET', '/platform/trials/leads', ops.support)).leads.find(
      (l: { email: string }) => l.email === email,
    );
    expect(lead).toMatchObject({ stage: 'trial', salesCount: 0 });
    expect(lead.merchantId).toBeTruthy();
    expect(lead.trialEndsAt).toBeTruthy();
  });

  it('lends devices from the operator’s stock: available, waiting list, delivery starts the trial', async () => {
    const tablet = await device('T', 1);
    let offer = await ok('GET', '/public/trial');
    expect(offer.devices.find((d: { id: string }) => d.id === tablet.id).available).toBe(true);

    const signUp = async (email: string) => {
      const client = new ApiClient(app);
      const { signupId } = (
        await call(
          'POST',
          '/public/trial/start',
          undefined,
          {
            fullName: 'Owner',
            email,
            password: 'Strong-Pass-2026',
            companyName: `Shop ${email}`,
            businessType: 'restaurant',
            language: 'en',
            sessionId: randomUUID(),
            devices: [{ itemId: tablet.id, quantity: 1 }],
          },
          client,
        )
      ).json();
      return (
        await call(
          'POST',
          '/public/trial/verify',
          undefined,
          { signupId, code: codeFor(email) },
          client,
        )
      ).json();
    };

    const first = await signUp(uniqueEmail('dev1'));
    expect(first).toMatchObject({ devices: 'pending', trialDays: 10 });
    let list = await ok('GET', '/platform/trials/devices?status=pending', ops.support);
    const request = list.requests.find((r: { lines: { nameEn: string }[] }) =>
      r.lines.some((l) => l.nameEn === 'Device T'),
    );
    const approved = await ok('PUT', `/platform/trials/devices/${request.id}`, ops.support, {
      status: 'approved',
      version: request.version,
    });
    // Approved devices are out: none left for the next shop, who joins the waiting list.
    offer = await ok('GET', '/public/trial');
    expect(offer.devices.find((d: { id: string }) => d.id === tablet.id).available).toBe(false);
    const second = await signUp(uniqueEmail('dev2'));
    expect(second.devices).toBe('waitlist');
    const stock = (await ok('GET', '/platform/trials/stock', ops.support)).devices.find(
      (d: { itemId: string }) => d.itemId === tablet.id,
    );
    expect(stock).toMatchObject({ trialStock: 1, out: 1, available: 0, waiting: 1 });

    const invalid = await call('PUT', `/platform/trials/devices/${request.id}`, ops.support, {
      status: 'returned',
      version: approved.version,
    });
    expect(invalid.json().code).toBe('INVALID_STATE');

    // Shorten the running trial (owner-role fixture: subscription changes need an operator id).
    const fixture = await owner.connect();
    try {
      await fixture.query('begin');
      await fixture.query(`select set_config('app.operator_id', gen_random_uuid()::text, true)`);
      await fixture.query(
        `update subscriptions set trial_ends_at = now() + interval '1 day' where merchant_id = $1`,
        [request.merchantId],
      );
      await fixture.query('commit');
    } finally {
      fixture.release();
    }
    const delivered = await ok('PUT', `/platform/trials/devices/${request.id}`, ops.support, {
      status: 'delivered',
      note: 'Delivered by Ali',
      version: approved.version,
    });
    expect(delivered.deliveredAt).toBeTruthy();
    const ends = await owner.query(
      `select trial_ends_at - now() > interval '9 days' as from_delivery from subscriptions where merchant_id = $1`,
      [request.merchantId],
    );
    expect(ends.rows[0].from_delivery).toBe(true);

    // With the waiting list off, a device that is out cannot be requested.
    const settings = await ok('GET', '/platform/trials/settings', ops.support);
    await ok('PUT', '/platform/trials/settings', ops.billing, {
      ...settings,
      waitlistEnabled: false,
    });
    const refused = await call('POST', '/public/trial/start', undefined, {
      fullName: 'Owner',
      email: uniqueEmail('dev3'),
      password: 'Strong-Pass-2026',
      businessType: 'retail',
      language: 'en',
      sessionId: randomUUID(),
      devices: [{ itemId: tablet.id, quantity: 1 }],
    });
    expect(refused.json().issues[0].code).toBe('unavailable');
    list = await ok('GET', '/platform/trials/devices', ops.support);
    expect(list.counts.waitlist).toBeGreaterThanOrEqual(1);
  });

  it('keeps platform trial data away from the public and from merchants', async () => {
    expect((await call('GET', '/platform/trials/leads')).statusCode).toBe(401);
    expect((await call('GET', '/platform/trials/funnel')).statusCode).toBe(401);
  });
});
