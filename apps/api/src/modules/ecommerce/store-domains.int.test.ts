import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';
import { StoreAddressService } from './store-address.service.js';
import { StoreDomainsService } from './store-domains.service.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  app = await createTestApp({
    env: testEnv({
      DATABASE_URL: prepared.runtimeUrl,
      STORE_DOMAIN: 'arabat.test',
      CUSTOM_HOSTNAMES_DRIVER: 'fake',
    }),
    mailer,
  });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

let seq = 0;
async function company({ store = true } = {}) {
  const c = await createCompany(app, db, mailer);
  const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
    c.client.request(method, path, { cookies: c.cookies, ...(body === undefined ? {} : { body }) });
  const slug = `dom-${Date.now().toString(36)}-${(seq += 1)}`;
  if (store) {
    const r = await req('PUT', '/manager/online/store', {
      slug,
      status: 'published',
      nameEn: 'Domain House',
      primaryColor: '#7c2d12',
      fulfillmentBranchId: c.main,
      pickupEnabled: true,
      deliveryEnabled: false,
      deliveryFee: '0.000',
      minimumOrder: '0.000',
      reservationMinutes: 30,
      version: 0,
    });
    expect(r.statusCode, r.body).toBe(200);
  }
  return { c, req, slug };
}
const unique = () => `shop-${Date.now().toString(36)}-${(seq += 1)}.test`;

describe('own domains (ADR-0137)', () => {
  it('gives every store a permanent code that never changes', async () => {
    const none = await company({ store: false });
    expect((await none.req('GET', '/manager/online/domain')).json()).toMatchObject({
      code: 'STORE_NOT_SAVED',
    });
    const s = await company();
    const view = (await s.req('GET', '/manager/online/domain')).json();
    expect(view.code).toMatch(/^st-[a-z0-9]{6}$/);
    expect(view).toMatchObject({
      available: true,
      permanentUrl: `http://${view.code}.arabat.test:5176`,
      storeUrl: `http://${s.slug}.arabat.test:5176`,
      primaryUrl: `http://${s.slug}.arabat.test:5176`,
      target: 'stores.arabat.test',
      domain: null,
    });
    // The database refuses to change it, even for the table owner.
    await expect(
      owner.query(`update online_stores set public_code = 'st-aaaaaa' where merchant_id = $1`, [
        s.c.merchantId,
      ]),
    ).rejects.toThrow(/never changes/);
    // A code-shaped address cannot be taken as a store address.
    const taken = await s.req(
      'GET',
      `/manager/online/store/slug-availability?slug=${encodeURIComponent('st-abc123')}`,
    );
    expect(taken.json()).toMatchObject({ available: false, reason: 'reserved' });
    // The permanent code finds the store whatever its address.
    expect(await app.get(StoreAddressService).find(view.code)).toMatchObject({ slug: s.slug });
  });

  it('connects a domain the merchant bought, checks it, makes it the main address and removes it', async () => {
    const s = await company();
    const domain = unique();
    const connected = await s.req('POST', '/manager/online/domain', {
      domain: `https://WWW.${domain.toUpperCase()}/products?x=1`,
    });
    expect(connected.statusCode, connected.body).toBe(201);
    expect(connected.json().domain).toMatchObject({
      domain,
      status: 'pending',
      isPrimary: false,
      www: { hostname: `www.${domain}`, status: 'pending', certificate: 'pending' },
      root: { hostname: domain },
      records: [
        { type: 'CNAME', name: 'www', value: 'stores.arabat.test', purpose: 'required' },
        { type: 'CNAME', name: '@', value: 'stores.arabat.test', purpose: 'root' },
      ],
    });
    // A second domain, the same domain elsewhere and Arabat's own domains are refused.
    expect(
      (await s.req('POST', '/manager/online/domain', { domain: unique() })).json(),
    ).toMatchObject({ code: 'DOMAIN_ALREADY_CONNECTED' });
    const other = await company();
    expect((await other.req('POST', '/manager/online/domain', { domain })).json()).toMatchObject({
      code: 'DOMAIN_TAKEN',
    });
    for (const own of ['arabat.test', 'shop.arabat.test'])
      expect(
        (await other.req('POST', '/manager/online/domain', { domain: own })).json(),
      ).toMatchObject({ code: 'DOMAIN_NOT_ALLOWED' });
    for (const bad of ['localhost', 'not a domain'])
      expect((await other.req('POST', '/manager/online/domain', { domain: bad })).statusCode).toBe(
        400,
      );
    // Not yet working: it cannot be the main address.
    expect(
      (await s.req('PUT', '/manager/online/domain/primary', { primary: true })).json(),
    ).toMatchObject({ code: 'DOMAIN_NOT_ACTIVE' });

    // The records are in place (the fake provider answers active on its next read).
    const checked = (await s.req('POST', '/manager/online/domain/check')).json();
    expect(checked.domain).toMatchObject({ status: 'active', isPrimary: true });
    expect(checked.primaryUrl).toBe(`http://www.${domain}:5176`);
    expect((await s.req('GET', '/manager/online/store')).json().url).toBe(
      `http://www.${domain}:5176`,
    );
    const addresses = app.get(StoreAddressService);
    expect(await addresses.byDomain(domain)).toEqual({
      slug: s.slug,
      isPrimary: true,
      url: `http://www.${domain}:5176`,
    });
    expect(await addresses.find(s.slug)).toMatchObject({ url: `http://www.${domain}:5176` });

    // The merchant keeps the Arabat address as the main one.
    const kept = (await s.req('PUT', '/manager/online/domain/primary', { primary: false })).json();
    expect(kept.primaryUrl).toBe(`http://${s.slug}.arabat.test:5176`);
    expect(await addresses.byDomain(domain)).toMatchObject({
      isPrimary: false,
      url: `http://${s.slug}.arabat.test:5176`,
    });

    // Removing frees the domain for another store; the record stays.
    const removed = (await s.req('DELETE', '/manager/online/domain')).json();
    expect(removed.domain).toBeNull();
    expect(await addresses.byDomain(domain)).toBeNull();
    expect((await other.req('POST', '/manager/online/domain', { domain })).statusCode).toBe(201);
    const actions = (
      await owner.query(
        `select action from audit_log where merchant_id = $1 and target_type = 'store_domain' order by occurred_at`,
        [s.c.merchantId],
      )
    ).rows.map((r: { action: string }) => r.action);
    expect(actions).toEqual([
      'online.domain_connected',
      'online.domain_status',
      'online.domain_primary',
      'online.domain_removed',
    ]);
    const rows = await owner.query(`select count(*) n from store_domains where merchant_id = $1`, [
      s.c.merchantId,
    ]);
    expect(Number(rows.rows[0].n)).toBe(1);
  });

  it('keeps the domain when the store changes its address', async () => {
    const s = await company();
    const domain = unique();
    await s.req('POST', '/manager/online/domain', { domain });
    await s.req('POST', '/manager/online/domain/check');
    const store = (await s.req('GET', '/manager/online/store')).json();
    const renamed = `${s.slug}-new`;
    const saved = await s.req('PUT', '/manager/online/store', {
      ...store,
      deliveryFee: store.deliveryFee.amount,
      minimumOrder: store.minimumOrder.amount,
      slug: renamed,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await app.get(StoreAddressService).byDomain(domain)).toMatchObject({ slug: renamed });
  });

  it('releases a domain whose records never appeared, gives the main address back after an outage, and is closed without the right', async () => {
    const s = await company();
    await s.req('POST', '/manager/online/domain', { domain: unique() });
    // A week later the provider still has nothing working for it.
    await owner.query(
      `update store_domains set created_at = now() - interval '8 days', www_hostname_id = 'gone', root_hostname_id = 'gone' where merchant_id = $1`,
      [s.c.merchantId],
    );
    await app.get(StoreDomainsService).refresh(s.c.merchantId);
    expect((await s.req('GET', '/manager/online/domain')).json().domain).toBeNull();

    // An active main domain that stops working loses the main address and gets it back.
    const t = await company();
    await t.req('POST', '/manager/online/domain', { domain: unique() });
    await t.req('POST', '/manager/online/domain/check');
    await owner.query(
      `update store_domains set www_hostname_id = 'gone' where merchant_id = $1 and status = 'active'`,
      [t.c.merchantId],
    );
    await app.get(StoreDomainsService).refresh(t.c.merchantId);
    expect((await t.req('GET', '/manager/online/domain')).json().domain).toMatchObject({
      status: 'pending',
      isPrimary: false,
    });
    await app.get(StoreDomainsService).refresh(t.c.merchantId);
    expect((await t.req('GET', '/manager/online/domain')).json().domain).toMatchObject({
      status: 'active',
      isPrimary: true,
    });

    // A branch manager without the online store right can neither see nor change it.
    const manager = await t.c.hire(
      [{ roleId: t.c.roles.branch_manager, branchId: t.c.main }],
      'manager',
    );
    const denied = await t.c.client.request('GET', '/manager/online/domain', {
      cookies: manager.cookies,
    });
    expect(denied.statusCode).toBe(403);
  });
});
