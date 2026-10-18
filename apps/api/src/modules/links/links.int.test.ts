import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { ApiClient, DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

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
    env: testEnv({ DATABASE_URL: prepared.runtimeUrl, DATABASE_POOL_MAX: '20' }),
    mailer,
  });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

let seq = 0;
const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`.slice(0, 40);

async function setup() {
  const c = await createCompany(app, db, mailer);
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    cookies: Record<string, string> | undefined = c.cookies,
  ) =>
    c.client.request(method, path, {
      ...(cookies ? { cookies } : {}),
      ...(body === undefined ? {} : { body }),
    });
  const ok = async (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    cookies?: Record<string, string>,
  ) => {
    const r = await req(method, path, body, cookies ?? c.cookies);
    if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
    return r.json();
  };
  return { c, req, ok };
}

const page = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  status: 'published',
  titleAr: 'بيت الزعفران',
  titleEn: 'Saffron House',
  bioAr: 'شاي وقهوة',
  bioEn: null,
  themeColor: '#7c2d12',
  buttonStyle: 'pill',
  background: 'light',
  version: 0,
  ...extra,
});
const link = (extra: Record<string, unknown> = {}) => ({
  kind: 'instagram',
  labelAr: 'إنستقرام',
  labelEn: 'Instagram',
  url: 'https://instagram.com/saffron',
  status: 'active',
  version: 0,
  ...extra,
});

describe('link page (ADR-0116)', () => {
  it('starts as an unsaved draft and is not public until published', async () => {
    const s = await setup();
    const initial = await s.ok('GET', '/manager/link-page');
    expect(initial).toMatchObject({ status: 'draft', version: 0, items: [], avatarUrl: null });
    expect(initial.url).toContain(`/links/${initial.slug}`);

    // Adding a link first creates the draft page.
    const withLink = await s.ok('POST', '/manager/link-page/items', link());
    expect(withLink.version).toBe(1);
    expect(withLink.items).toHaveLength(1);
    const anon = new ApiClient(app);
    expect((await anon.request('GET', `/public/links/${withLink.slug}`)).statusCode).toBe(404);

    const slug = uniqueSlug('saffron');
    const saved = await s.ok('PUT', '/manager/link-page', page(slug, { version: 1 }));
    expect(saved).toMatchObject({ slug, status: 'published', version: 2 });
    const pub = (await anon.request('GET', `/public/links/${slug}`)).json();
    expect(pub).toMatchObject({ slug, titleEn: 'Saffron House', buttonStyle: 'pill' });
    expect(pub.items).toEqual([
      {
        id: withLink.items[0].id,
        kind: 'instagram',
        labelAr: 'إنستقرام',
        labelEn: 'Instagram',
        url: 'https://instagram.com/saffron',
      },
    ]);
    // Merchant data that is not part of the page never leaks.
    expect(pub).not.toHaveProperty('merchantId');
    expect(pub.items[0]).not.toHaveProperty('clicks');

    // Stale versions are refused.
    expect((await s.req('PUT', '/manager/link-page', page(slug, { version: 1 }))).json().code).toBe(
      'VERSION_CONFLICT',
    );
    // Back to draft: the public page disappears.
    await s.ok('PUT', '/manager/link-page', page(slug, { status: 'draft', version: 2 }));
    expect((await anon.request('GET', `/public/links/${slug}`)).statusCode).toBe(404);
  });

  it('orders, hides, edits and deletes links; counts opens of active links only', async () => {
    const s = await setup();
    const slug = uniqueSlug('links');
    await s.ok('PUT', '/manager/link-page', page(slug));
    await s.ok('POST', '/manager/link-page/items', link());
    await s.ok(
      'POST',
      '/manager/link-page/items',
      link({
        kind: 'whatsapp',
        labelAr: 'واتساب',
        labelEn: null,
        url: 'https://wa.me/96512345678',
      }),
    );
    let p = await s.ok(
      'POST',
      '/manager/link-page/items',
      link({ kind: 'email', labelAr: null, labelEn: 'Mail', url: 'mailto:hi@example.com' }),
    );
    expect(p.items.map((i: { kind: string }) => i.kind)).toEqual([
      'instagram',
      'whatsapp',
      'email',
    ]);
    const [insta, whats, mail] = p.items as { id: string; version: number }[];

    p = await s.ok('PUT', '/manager/link-page/items/order', {
      ids: [mail!.id, insta!.id, whats!.id],
    });
    expect(p.items.map((i: { kind: string }) => i.kind)).toEqual([
      'email',
      'instagram',
      'whatsapp',
    ]);
    // The order must list every link exactly once.
    expect(
      (await s.req('PUT', '/manager/link-page/items/order', { ids: [mail!.id, insta!.id] }))
        .statusCode,
    ).toBe(400);

    // Hide WhatsApp: saved, but not on the public page.
    await s.ok(
      'PUT',
      `/manager/link-page/items/${whats!.id}`,
      link({
        kind: 'whatsapp',
        labelAr: 'واتساب',
        url: 'https://wa.me/96512345678',
        status: 'hidden',
        version: whats!.version,
      }),
    );
    const anon = new ApiClient(app);
    const pub = (await anon.request('GET', `/public/links/${slug}`)).json();
    expect(pub.items.map((i: { kind: string }) => i.kind)).toEqual(['email', 'instagram']);

    // Opens are counted for active links; hidden and unknown links are ignored.
    const click = (id: string) => anon.request('POST', `/public/links/${slug}/items/${id}/click`);
    expect((await click(insta!.id)).statusCode).toBe(204);
    expect((await click(insta!.id)).statusCode).toBe(204);
    expect((await click(whats!.id)).statusCode).toBe(204);
    expect((await click(newId())).statusCode).toBe(204);
    p = await s.ok('GET', '/manager/link-page');
    const clicks = Object.fromEntries(
      p.items.map((i: { kind: string; clicks: number }) => [i.kind, i.clicks]),
    );
    expect(clicks).toEqual({ email: 0, instagram: 2, whatsapp: 0 });

    p = await s.ok('DELETE', `/manager/link-page/items/${mail!.id}`);
    expect(p.items.map((i: { kind: string }) => i.kind)).toEqual(['instagram', 'whatsapp']);
    expect((await s.req('DELETE', `/manager/link-page/items/${mail!.id}`)).statusCode).toBe(404);

    const audit = await owner.query(
      `select action from audit_log where merchant_id = $1 and target_type = 'link_page' order by occurred_at`,
      [s.c.merchantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'links.page_updated',
        'links.item_created',
        'links.items_reordered',
        'links.item_updated',
        'links.item_deleted',
      ]),
    );
  });

  it('accepts only web, e-mail and phone addresses (BR-200)', async () => {
    const s = await setup();
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'instagram.com/x',
      'https://',
      'ftp://example.com',
    ]) {
      const r = await s.req('POST', '/manager/link-page/items', link({ url }));
      expect(r.statusCode, url).toBe(400);
    }
    expect(
      (await s.req('POST', '/manager/link-page/items', link({ labelAr: '', labelEn: ' ' })))
        .statusCode,
    ).toBe(400);
    expect(
      (await s.req('POST', '/manager/link-page/items', link({ url: 'tel:+965 1234 5678' })))
        .statusCode,
    ).toBe(201);
  });

  it('keeps addresses unique across businesses and their online stores (BR-198)', async () => {
    const a = await setup();
    const b = await setup();
    const slug = uniqueSlug('taken');
    await a.ok('PUT', '/manager/link-page', page(slug));
    const r = await b.req('PUT', '/manager/link-page', page(slug.toUpperCase()));
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('DUPLICATE_CODE');
    // Another business's online store address (even a draft store) is not available either.
    const storeSlug = uniqueSlug('store');
    await a.ok('PUT', '/manager/online/store', {
      slug: storeSlug,
      status: 'draft',
      nameEn: 'A store',
      primaryColor: '#000000',
      pickupEnabled: true,
      deliveryEnabled: false,
      deliveryFee: '0',
      minimumOrder: '0',
      reservationMinutes: 30,
      version: 0,
    });
    expect((await b.req('PUT', '/manager/link-page', page(storeSlug))).statusCode).toBe(409);
    // …but the business's own store address is offered and accepted.
    const own = await a.ok('GET', '/manager/link-page');
    expect(own.slug).toBe(slug);
    expect(
      (await a.req('PUT', '/manager/link-page', page(storeSlug, { version: 1 }))).statusCode,
    ).toBe(200);
    // The store address 'links' is reserved for link pages.
    expect(
      (
        await a.req('PUT', '/manager/online/store', {
          slug: 'links',
          status: 'draft',
          nameEn: 'A store',
          primaryColor: '#000000',
          pickupEnabled: true,
          deliveryEnabled: false,
          deliveryFee: '0',
          minimumOrder: '0',
          reservationMinutes: 30,
          version: 1,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('refuses people without online.manage and keeps each business to its own links', async () => {
    const a = await setup();
    const b = await setup();
    const cashier = await a.c.hire([{ roleId: a.c.roles.cashier, branchId: a.c.main }], 'pos');
    expect((await a.req('GET', '/manager/link-page', undefined, cashier.cookies)).statusCode).toBe(
      401,
    );
    const branchManager = await a.c.hire(
      [{ roleId: a.c.roles.branch_manager, branchId: a.c.main }],
      'manager',
    );
    expect(
      (await a.req('POST', '/manager/link-page/items', link(), branchManager.cookies)).statusCode,
    ).toBe(403);
    expect((await a.req('GET', '/manager/link-page', undefined, {})).statusCode).toBe(401);

    const mine = await a.ok('POST', '/manager/link-page/items', link());
    const id = mine.items[0].id as string;
    // B cannot see, edit or delete A's link.
    expect((await b.ok('GET', '/manager/link-page')).items).toEqual([]);
    expect(
      (await b.req('PUT', `/manager/link-page/items/${id}`, link({ version: 1 }))).statusCode,
    ).toBe(404);
    expect((await b.req('DELETE', `/manager/link-page/items/${id}`)).statusCode).toBe(404);
    // A click on A's link through B's page does nothing.
    const slugB = uniqueSlug('b');
    await b.ok('PUT', '/manager/link-page', page(slugB));
    const anon = new ApiClient(app);
    await anon.request('POST', `/public/links/${slugB}/items/${id}/click`);
    expect((await a.ok('GET', '/manager/link-page')).items[0].clicks).toBe(0);
  });

  it('caps a page at 50 links', async () => {
    const s = await setup();
    await owner.query(`insert into link_pages (merchant_id, slug) values ($1, $2)`, [
      s.c.merchantId,
      uniqueSlug('cap'),
    ]);
    await owner.query(
      `insert into link_page_items (id, merchant_id, kind, label_en, url, sort_order)
       select gen_random_uuid(), $1, 'link', 'L' || g, 'https://example.com/' || g, g from generate_series(1, 50) g`,
      [s.c.merchantId],
    );
    const r = await s.req('POST', '/manager/link-page/items', link());
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('LINK_LIMIT_REACHED');
  });

  it('stores the profile picture, checked by its bytes, and serves it publicly', async () => {
    const s = await setup();
    const slug = uniqueSlug('pic');
    await s.ok('PUT', '/manager/link-page', page(slug));
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(32, 1),
    ]);
    const upload = (data: Buffer) => {
      const boundary = '----arabat' + Math.random().toString(16).slice(2);
      return app.inject({
        method: 'POST',
        url: '/api/v1/manager/link-page/avatar',
        cookies: s.c.cookies,
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
    expect((await upload(Buffer.from('<svg onload=x>'))).json().code).toBe('UNSUPPORTED_MEDIA');
    const saved = (await upload(png)).json();
    expect(saved.avatarUrl).toMatch(/^\/api\/v1\/manager\/link-page\/avatar/);
    const pub = (await new ApiClient(app).request('GET', `/public/links/${slug}`)).json();
    expect(pub.avatarUrl).toMatch(new RegExp(`^/api/v1/public/links/${slug}/avatar`));
    const served = await app.inject({ method: 'GET', url: pub.avatarUrl });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(served.rawPayload, png)).toBe(0);

    const removed = await s.ok('DELETE', '/manager/link-page/avatar');
    expect(removed.avatarUrl).toBeNull();
    expect((await app.inject({ method: 'GET', url: pub.avatarUrl })).statusCode).toBe(404);
  });
});
