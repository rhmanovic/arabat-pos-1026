import { hash } from '@node-rs/argon2';
import type { PlatformRole } from '@arabat/permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { newId } from '../../kernel/ids.js';
import {
  ApiClient,
  DbFixtures,
  PASSWORD,
  createCompany,
  uniqueEmail,
  sessionCookie,
} from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { upsertOperator } from '../platform-admin/operators.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
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
  mailer = new InMemoryMailer();
  app = await createTestApp({
    env: testEnv({ DATABASE_URL: prepared.runtimeUrl, SALES_NOTIFY_EMAIL: 'sales@test.arabat' }),
    mailer,
  });
  passwordHash = await hash(PASSWORD, { algorithm: 2 });
  ops.super = await operator('platform.super_admin');
  ops.support = await operator('platform.support');
  ops.billing = await operator('platform.billing');
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
const call = (method: Method, path: string, cookies?: Cookies, body?: unknown) =>
  new ApiClient(app).request(method, path, {
    ...(cookies ? { cookies } : {}),
    ...(body === undefined ? {} : { body }),
  });
async function ok(method: Method, path: string, cookies?: Cookies, body?: unknown) {
  const r = await call(method, path, cookies, body);
  if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
  return r.json();
}

const device = (name: string, price: string, extra: Record<string, unknown> = {}) => ({
  nameAr: `جهاز ${name}`,
  nameEn: `Device ${name}`,
  descriptionAr: null,
  descriptionEn: null,
  price,
  icon: 'printer',
  maxQuantity: 5,
  status: 'active',
  sortOrder: 500,
  version: 0,
  ...extra,
});
const contact = {
  companyName: 'Salmiya Coffee',
  contactName: 'Fatma',
  phone: '+965 5555 1234',
  email: 'fatma@test.arabat',
  notes: 'Two branches',
  language: 'ar',
};

describe('pricing offer', () => {
  it('shows the yearly system price and only active devices to the public', async () => {
    const offer = await ok('GET', '/public/pricing');
    expect(offer.system).toMatchObject({ kind: 'system', price: { currency: 'KWD' } });
    const items = (await ok('GET', '/platform/offer-items', ops.support)).items as {
      kind: string;
      status: string;
      id: string;
    }[];
    // Seeded devices start hidden (no price yet) and never reach the public page.
    const hidden = items.filter((i) => i.kind === 'device' && i.status === 'hidden');
    for (const h of hidden)
      expect(offer.devices.map((d: { id: string }) => d.id)).not.toContain(h.id);
  });

  it('lets billing operators add, price and hide devices; others may only read', async () => {
    expect(
      (await call('POST', '/platform/offer-items', ops.support, device('x', '1'))).statusCode,
    ).toBe(403);
    expect((await call('GET', '/platform/offer-items')).statusCode).toBe(401);
    const created = await ok('POST', '/platform/offer-items', ops.billing, device('A', '45.500'));
    expect(created).toMatchObject({ kind: 'device', price: { amount: '45.500' }, version: 1 });
    expect((await ok('GET', '/public/pricing')).devices.map((d: { id: string }) => d.id)).toContain(
      created.id,
    );

    const stale = await call(
      'PUT',
      `/platform/offer-items/${created.id}`,
      ops.billing,
      device('A', '1'),
    );
    expect(stale.json().code).toBe('VERSION_CONFLICT');
    const hidden = await ok('PUT', `/platform/offer-items/${created.id}`, ops.billing, {
      ...device('A', '49.000'),
      status: 'hidden',
      version: created.version,
    });
    expect(hidden).toMatchObject({ status: 'hidden', price: { amount: '49.000' } });
    expect(
      (await ok('GET', '/public/pricing')).devices.map((d: { id: string }) => d.id),
    ).not.toContain(created.id);

    const bad = await call('POST', '/platform/offer-items', ops.billing, device('B', '1.2345'));
    expect(bad.statusCode).toBe(400);

    const audit = await owner.query(
      `select action, details from audit_log where target_id = $1 order by occurred_at`,
      [created.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'pricing.item.created',
      'pricing.item.updated',
    ]);
    expect(audit.rows[1].details).toMatchObject({ previousPrice: '45.500', price: '49.000' });
  });

  it('keeps the system item visible and edits its yearly price', async () => {
    const items = (await ok('GET', '/platform/offer-items', ops.billing)).items;
    const system = items.find((i: { kind: string }) => i.kind === 'system');
    const body = {
      ...device('S', system.price.amount),
      nameAr: system.nameAr,
      nameEn: system.nameEn,
      icon: 'system',
      sortOrder: system.sortOrder,
      version: system.version,
    };
    const refused = await call('PUT', `/platform/offer-items/${system.id}`, ops.billing, {
      ...body,
      status: 'hidden',
    });
    expect(refused.json().code).toBe('INVALID_STATE');
    const saved = await ok('PUT', `/platform/offer-items/${system.id}`, ops.billing, body);
    expect(saved).toMatchObject({ kind: 'system', maxQuantity: 1, status: 'active' });
  });

  it('stores, serves and replaces an item picture checked by its bytes', async () => {
    const created = await ok('POST', '/platform/offer-items', ops.billing, device('Img', '10'));
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 1),
    ]);
    const upload = (data: Buffer, cookies: Cookies) => {
      const boundary = '----arabat' + Math.random().toString(16).slice(2);
      return app.inject({
        method: 'POST',
        url: `/api/v1/platform/offer-items/${created.id}/image`,
        cookies,
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
          ),
          data,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      });
    };
    expect((await upload(png, ops.support)).statusCode).toBe(403);
    expect((await upload(Buffer.from('<svg onload=x>'), ops.billing)).json().code).toBe(
      'UNSUPPORTED_MEDIA',
    );
    const withImage = (await upload(png, ops.billing)).json();
    expect(withImage.imageUrl).toMatch(/^\/api\/v1\/public\/pricing\/images\//);
    const served = await app.inject({ method: 'GET', url: withImage.imageUrl });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(png)).toBe(true);
    const removed = await ok('DELETE', `/platform/offer-items/${created.id}/image`, ops.billing);
    expect(removed.imageUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url: withImage.imageUrl })).statusCode).toBe(404);
  });
});

describe('purchase requests', () => {
  it('prices a request on the server, e-mails sales and the customer, and lets operators follow it up', async () => {
    const printer = await ok('POST', '/platform/offer-items', ops.billing, device('P', '35.250'));
    const drawer = await ok('POST', '/platform/offer-items', ops.billing, device('D', '18.000'));
    const offer = await ok('GET', '/public/pricing');
    const systemMinor = BigInt(offer.system.price.amount.replace('.', ''));

    const created = await ok('POST', '/public/pricing/requests', undefined, {
      ...contact,
      devices: [
        { itemId: printer.id, quantity: 2 },
        { itemId: drawer.id, quantity: 1 },
      ],
    });
    expect(created.reference).toMatch(/^Q-\d{6}$/);
    expect(created.devices.amount).toBe('88.500');
    const total = systemMinor + 88500n;
    expect(created.total.amount).toBe(`${total / 1000n}.${String(total % 1000n).padStart(3, '0')}`);

    const sales = mailer.lastTo('sales@test.arabat')!;
    expect(sales.subject).toContain(created.reference);
    expect(sales.text).toContain('Salmiya Coffee');
    expect(sales.text).toContain('88.500 KWD');
    expect(mailer.lastTo('fatma@test.arabat')!.subject).toContain(created.reference);

    const list = await ok('GET', '/platform/sales-requests?status=new', ops.support);
    const listed = list.requests.find(
      (r: { reference: string }) => r.reference === created.reference,
    );
    expect(listed).toMatchObject({ status: 'new', companyName: 'Salmiya Coffee' });
    expect(list.counts.new).toBeGreaterThan(0);

    const detail = await ok('GET', `/platform/sales-requests/${listed.id}`, ops.support);
    expect(detail.lines).toHaveLength(3);
    expect(detail.lines.find((l: { nameEn: string }) => l.nameEn === 'Device P')).toMatchObject({
      quantity: 2,
      unitPrice: { amount: '35.250' },
      lineTotal: { amount: '70.500' },
    });

    // Later price changes never rewrite a request already sent.
    await ok('PUT', `/platform/offer-items/${printer.id}`, ops.billing, {
      ...device('P', '99.000'),
      version: printer.version,
    });
    expect(
      (await ok('GET', `/platform/sales-requests/${listed.id}`, ops.support)).lines.find(
        (l: { nameEn: string }) => l.nameEn === 'Device P',
      ).unitPrice.amount,
    ).toBe('35.250');

    const updated = await ok('PUT', `/platform/sales-requests/${listed.id}`, ops.support, {
      status: 'contacted',
      operatorNote: 'Called, visiting Sunday',
      version: detail.version,
    });
    expect(updated).toMatchObject({ status: 'contacted', operatorNote: 'Called, visiting Sunday' });
    const stale = await call('PUT', `/platform/sales-requests/${listed.id}`, ops.support, {
      status: 'won',
      version: detail.version,
    });
    expect(stale.json().code).toBe('VERSION_CONFLICT');
  });

  it('refuses hidden devices, quantities above the limit and bad contact details', async () => {
    const hidden = await ok('POST', '/platform/offer-items', ops.billing, {
      ...device('H', '5'),
      status: 'hidden',
    });
    const refused = await call('POST', '/public/pricing/requests', undefined, {
      ...contact,
      devices: [{ itemId: hidden.id, quantity: 1 }],
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().issues[0].code).toBe('unavailable');

    const shown = await ok('POST', '/platform/offer-items', ops.billing, device('Q', '5'));
    const many = await call('POST', '/public/pricing/requests', undefined, {
      ...contact,
      devices: [{ itemId: shown.id, quantity: 6 }],
    });
    expect(many.json().issues[0].code).toBe('too_many');

    const unknown = await call('POST', '/public/pricing/requests', undefined, {
      ...contact,
      devices: [{ itemId: newId(), quantity: 1 }],
    });
    expect(unknown.statusCode).toBe(400);
    const badEmail = await call('POST', '/public/pricing/requests', undefined, {
      ...contact,
      email: 'not-an-email',
      devices: [],
    });
    expect(badEmail.statusCode).toBe(400);
  });

  it('accepts a system-only request and limits requests per address', async () => {
    const client = new ApiClient(app);
    const send = () =>
      client.request('POST', '/public/pricing/requests', { body: { ...contact, devices: [] } });
    const first = await send();
    expect(first.statusCode).toBe(201);
    expect(first.json().devices.amount).toBe('0.000');
    for (let i = 0; i < 4; i += 1) await send();
    expect((await send()).statusCode).toBe(429);
  });

  it('keeps requests away from merchant sessions', async () => {
    const c = await createCompany(app, new DbFixtures(owner), mailer);
    expect((await call('GET', '/platform/sales-requests', c.cookies)).statusCode).toBe(401);
  });
});
