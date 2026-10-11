import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
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
    env: testEnv({
      DATABASE_URL: prepared.runtimeUrl,
      FILE_STORAGE_DIR: `/tmp/claude-0/arabat-test-uploads-${process.pid}`,
    }),
    mailer,
  });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

const company = () => createCompany(app, db, mailer);
type Co = Awaited<ReturnType<typeof company>>;

function simple(overrides: Record<string, unknown> = {}, variant: Record<string, unknown> = {}) {
  return {
    nameAr: 'شاي كرك',
    nameEn: 'Karak tea',
    variants: [
      {
        sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
        price: '0.250',
        cost: '0.080',
        barcodes: [],
        ...variant,
      },
    ],
    ...overrides,
  };
}

async function create(c: Co, body: Record<string, unknown>, cookies = c.cookies) {
  return c.client.request('POST', '/manager/products', { cookies, body });
}

describe('products', () => {
  it('creates a simple product with exact KWD prices and a default variant', async () => {
    const c = await company();
    const res = await create(
      c,
      simple({}, { sku: 'TEA-1', price: '1.25', cost: '0.333', barcodes: ['6281000000017'] }),
    );
    expect(res.statusCode).toBe(201);
    const p = res.json();
    expect(p).toMatchObject({
      hasVariants: false,
      trackInventory: true,
      availableInAllBranches: true,
      status: 'active',
      version: 1,
    });
    expect(p.variants).toHaveLength(1);
    expect(p.variants[0]).toMatchObject({
      sku: 'TEA-1',
      isDefault: true,
      price: { amount: '1.250', currency: 'KWD' },
      cost: { amount: '0.333', currency: 'KWD' },
      barcodes: ['6281000000017'],
    });
    const stored = await owner.query(
      'select price_minor, cost_minor from product_variants where id = $1',
      [p.variants[0].id],
    );
    expect(stored.rows[0]).toEqual({ price_minor: '1250', cost_minor: '333' });
  });

  it('rejects invalid prices without rounding', async () => {
    const c = await company();
    for (const price of ['1.2345', '-1', '1e3', '0.1.2', '', 'abc', '10000000000']) {
      const res = await create(c, simple({}, { price }));
      expect(res.statusCode, price).toBe(400);
    }
    expect((await create(c, simple({}, { price: '0' }))).statusCode).toBe(201);
    expect((await create(c, simple({}, { price: '999999999.999' }))).statusCode).toBe(201);
  });

  it('supports variants: add, edit, archive missing ones, keep history', async () => {
    const c = await company();
    const res = await create(c, {
      nameEn: 'T-shirt',
      hasVariants: true,
      variants: [
        { nameEn: 'Small', sku: 'TS-S', price: '3.000', barcodes: ['111111'] },
        { nameEn: 'Large', sku: 'TS-L', price: '3.500', barcodes: ['222222'] },
      ],
    });
    const p = res.json();
    expect(p.variants.map((v: { sku: string }) => v.sku)).toEqual(['TS-S', 'TS-L']);
    const small = p.variants[0];

    const updated = await c.client.request('PATCH', `/manager/products/${p.id}`, {
      cookies: c.cookies,
      body: {
        nameEn: 'T-shirt',
        hasVariants: true,
        version: p.version,
        variants: [
          { id: small.id, nameEn: 'Small', sku: 'TS-S', price: '2.750', barcodes: ['111111'] },
          { nameEn: 'Medium', sku: 'TS-M', price: '3.250', barcodes: ['222222'] }, // reuses the archived variant's barcode
        ],
      },
    });
    expect(updated.statusCode).toBe(200);
    const after = updated.json();
    const active = after.variants.filter((v: { status: string }) => v.status === 'active');
    expect(
      active.map((v: { sku: string; price: { amount: string } }) => [v.sku, v.price.amount]),
    ).toEqual([
      ['TS-S', '2.750'],
      ['TS-M', '3.250'],
    ]);
    expect(after.variants.find((v: { sku: string }) => v.sku === 'TS-L')).toMatchObject({
      status: 'archived',
      barcodes: [],
    });

    // Price changes are audited with old and new values.
    const audit = await owner.query(
      `select details from audit_log where action = 'product.updated' and target_id = $1`,
      [p.id],
    );
    expect(audit.rows[0].details.variants).toContainEqual({
      variantId: small.id,
      price: { from: '3.000', to: '2.750' },
    });

    // A simple product must have exactly one variant; variants need names.
    expect(
      (await create(c, { nameEn: 'X', variants: [{ price: '1' }, { price: '2' }] })).statusCode,
    ).toBe(400);
    expect(
      (await create(c, { nameEn: 'X', hasVariants: true, variants: [{ price: '1' }] })).statusCode,
    ).toBe(400);
  });

  it('enforces SKU and barcode uniqueness per merchant (not across merchants)', async () => {
    const a = await company();
    const b = await company();
    expect(
      (await create(a, simple({}, { sku: 'DUP-1', barcodes: ['999000111'] }))).statusCode,
    ).toBe(201);
    const sku = await create(a, simple({}, { sku: 'dup-1' }));
    expect(sku.json().code).toBe('DUPLICATE_SKU');
    const barcode = await create(a, simple({}, { barcodes: ['999000111'] }));
    expect(barcode.json().code).toBe('DUPLICATE_BARCODE');
    const sameRequest = await create(a, {
      nameEn: 'Pair',
      hasVariants: true,
      variants: [
        { nameEn: 'A', sku: 'P-1', price: '1', barcodes: ['555000'] },
        { nameEn: 'B', sku: 'P-2', price: '1', barcodes: ['555000'] },
      ],
    });
    expect(sameRequest.json().code).toBe('DUPLICATE_BARCODE');
    // Another merchant may use the same codes.
    expect(
      (await create(b, simple({}, { sku: 'DUP-1', barcodes: ['999000111'] }))).statusCode,
    ).toBe(201);
  });

  it('uses optimistic locking and archives instead of deleting', async () => {
    const c = await company();
    const p = (await create(c, simple())).json();
    const body = {
      ...simple({}, { id: p.variants[0].id, sku: p.variants[0].sku }),
      version: p.version,
    };
    expect(
      (await c.client.request('PATCH', `/manager/products/${p.id}`, { cookies: c.cookies, body }))
        .statusCode,
    ).toBe(200);
    const stale = await c.client.request('PATCH', `/manager/products/${p.id}`, {
      cookies: c.cookies,
      body,
    });
    expect(stale.json().code).toBe('VERSION_CONFLICT');
    const archived = await c.client.request('POST', `/manager/products/${p.id}/status`, {
      cookies: c.cookies,
      body: { status: 'archived' },
    });
    expect(archived.json().status).toBe('archived');
    // The runtime role cannot delete products at all.
    const runtime = new (await import('pg')).default.Pool({
      connectionString: process.env['TEST_DATABASE_URL'],
      max: 1,
    });
    await expect(runtime.query('delete from products')).rejects.toThrow(/permission denied/);
    await runtime.end();
  });

  it('searches, filters, sorts and paginates', async () => {
    const c = await company();
    const cat = (
      await c.client.request('POST', '/manager/categories', {
        cookies: c.cookies,
        body: { nameEn: 'Drinks' },
      })
    ).json();
    for (const [name, price, sku] of [
      ['Apple juice', '0.750', 'J-APPLE'],
      ['Orange juice', '0.500', 'J-ORANGE'],
      ['Water', '0.100', 'W-1'],
    ] as const) {
      await create(c, {
        nameEn: name,
        categoryId: cat.id,
        variants: [{ sku, price, barcodes: [`${sku.replace('-', '')}00`.slice(0, 20)] }],
      });
    }
    await create(c, simple({ nameEn: 'Biscuits', nameAr: 'بسكويت' }));

    const q = async (query: string) =>
      (await c.client.request('GET', `/manager/products?${query}`, { cookies: c.cookies })).json();
    expect((await q('q=juice')).products.map((p: { nameEn: string }) => p.nameEn).sort()).toEqual([
      'Apple juice',
      'Orange juice',
    ]);
    expect((await q('q=j-orange')).total).toBe(1);
    expect((await q('q=بسكو')).products[0].nameEn).toBe('Biscuits');
    expect((await q(`categoryId=${cat.id}`)).total).toBe(3);
    const byPrice = await q(`categoryId=${cat.id}&sort=price&direction=desc`);
    expect(
      byPrice.products.map((p: { minPrice: { amount: string } }) => p.minPrice.amount),
    ).toEqual(['0.750', '0.500', '0.100']);
    const page2 = await q('pageSize=2&page=2&sort=name');
    expect(page2).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(page2.products).toHaveLength(2);
    expect(
      (await c.client.request('GET', '/manager/products?pageSize=1000', { cookies: c.cookies }))
        .statusCode,
    ).toBe(400);
  });
});

describe('categories', () => {
  it('creates nested categories and prevents cycles', async () => {
    const c = await company();
    const parent = (
      await c.client.request('POST', '/manager/categories', {
        cookies: c.cookies,
        body: { nameAr: 'مشروبات' },
      })
    ).json();
    const child = (
      await c.client.request('POST', '/manager/categories', {
        cookies: c.cookies,
        body: { nameAr: 'عصائر', parentId: parent.id },
      })
    ).json();
    expect(child.parentId).toBe(parent.id);
    const cycle = await c.client.request('PATCH', `/manager/categories/${parent.id}`, {
      cookies: c.cookies,
      body: { nameAr: 'مشروبات', parentId: child.id, version: parent.version },
    });
    expect(cycle.statusCode).toBe(409);
    const archived = await c.client.request('POST', `/manager/categories/${child.id}/status`, {
      cookies: c.cookies,
      body: { status: 'archived' },
    });
    expect(archived.json().status).toBe('archived');
  });
});

describe('branch availability and the POS catalog', () => {
  it('returns only active products available at the cashier’s branch', async () => {
    const c = await company();
    const everywhere = (
      await create(c, simple({ nameEn: 'Everywhere' }, { barcodes: ['100001'] }))
    ).json();
    const onlySecond = (
      await create(
        c,
        simple({ nameEn: 'Only second', availableInAllBranches: false, branchIds: [c.second] }),
      )
    ).json();
    const archived = (await create(c, simple({ nameEn: 'Archived' }))).json();
    await c.client.request('POST', `/manager/products/${archived.id}/status`, {
      cookies: c.cookies,
      body: { status: 'archived' },
    });

    const cashierMain = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const atMain = await c.client.request('GET', '/pos/catalog', { cookies: cashierMain.cookies });
    expect(atMain.statusCode).toBe(200);
    const mainItems = atMain.json().items as {
      productId: string;
      barcodes: string[];
      price: { amount: string };
    }[];
    expect(mainItems.map((i) => i.productId)).toEqual([everywhere.id]);
    expect(mainItems[0]).toMatchObject({
      barcodes: ['100001'],
      price: { amount: '0.250', currency: 'KWD' },
    });
    // The POS never receives costs.
    expect(atMain.body).not.toContain('cost');

    const atSecond = (
      await c.client.request('GET', '/pos/catalog', { cookies: await c.ownerPos(c.second) })
    ).json();
    expect(atSecond.items.map((i: { productId: string }) => i.productId).sort()).toEqual(
      [everywhere.id, onlySecond.id].sort(),
    );

    // ETag allows cheap revalidation.
    const etag = atMain.headers['etag'] as string;
    const again = await c.client.request('GET', '/pos/catalog', {
      cookies: cashierMain.cookies,
      headers: { 'if-none-match': etag },
    });
    expect(again.statusCode).toBe(304);

    // Manager list filter by branch.
    const filtered = (
      await c.client.request('GET', `/manager/products?branchId=${c.main}`, { cookies: c.cookies })
    ).json();
    expect(filtered.products.map((p: { id: string }) => p.id)).toEqual([everywhere.id]);
  });

  it('rejects availability at another merchant’s branch', async () => {
    const a = await company();
    const b = await company();
    const res = await create(a, simple({ availableInAllBranches: false, branchIds: [b.main] }));
    expect(res.statusCode).toBe(404);
  });
});

describe('permissions', () => {
  it('lets cashiers read only the POS catalog, never manage products', async () => {
    const c = await company();
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    expect(
      (
        await c.client.request('GET', '/manager/products', {
          cookies: { mgr_sid: cashier.cookies.pos_sid! },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await c.client.request('GET', '/pos/catalog', { cookies: cashier.cookies })).statusCode,
    ).toBe(200);
  });

  it('lets a branch manager view but not create products', async () => {
    const c = await company();
    const bm = await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager');
    expect(
      (await c.client.request('GET', '/manager/products', { cookies: bm.cookies })).statusCode,
    ).toBe(200);
    expect((await create(c, simple(), bm.cookies)).statusCode).toBe(403);
  });

  it('requires the price permission to set or change prices and hides costs without it', async () => {
    const c = await company();
    const role = (
      await c.client.request('POST', '/manager/roles', {
        cookies: c.cookies,
        body: {
          nameEn: 'Catalog editor',
          permissions: ['manager.access', 'catalog.read', 'catalog.manage'],
        },
      })
    ).json();
    const editor = await c.hire([{ roleId: role.id, branchId: null }], 'manager');
    const product = (await create(c, simple({}, { price: '1.000', cost: '0.400' }))).json();

    expect((await create(c, simple(), editor.cookies)).statusCode).toBe(403);
    const seen = (
      await c.client.request('GET', `/manager/products/${product.id}`, { cookies: editor.cookies })
    ).json();
    expect(seen.variants[0].cost).toBeUndefined();

    const v = product.variants[0];
    const rename = await c.client.request('PATCH', `/manager/products/${product.id}`, {
      cookies: editor.cookies,
      body: {
        nameEn: 'Renamed',
        version: product.version,
        variants: [{ id: v.id, sku: v.sku, price: '1.000', cost: null }],
      },
    });
    expect(rename.statusCode).toBe(200);
    // Cost is preserved, not wiped, when the editor cannot see it.
    expect(
      (await owner.query('select cost_minor from product_variants where id = $1', [v.id])).rows[0]
        .cost_minor,
    ).toBe('400');
    const reprice = await c.client.request('PATCH', `/manager/products/${product.id}`, {
      cookies: editor.cookies,
      body: {
        nameEn: 'Renamed',
        version: product.version + 1,
        variants: [{ id: v.id, sku: v.sku, price: '0.900' }],
      },
    });
    expect(reprice.statusCode).toBe(403);
  });
});

describe('images', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64, 1),
  ]);

  function multipart(data: Buffer, filename = 'photo.png', type = 'image/png') {
    const boundary = '----arabat' + Math.random().toString(16).slice(2);
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return {
      payload: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
  }

  it('uploads, serves and deletes product images; validates the real file type; isolates merchants', async () => {
    const c = await company();
    const b = await company();
    const p = (await create(c, simple())).json();
    const upload = await app.inject({
      method: 'POST',
      url: `/api/v1/manager/products/${p.id}/images`,
      cookies: c.cookies,
      remoteAddress: c.client.ip,
      ...multipart(png),
    });
    expect(upload.statusCode).toBe(201);
    const image = upload.json().images[0];
    expect(image).toMatchObject({ contentType: 'image/png', sizeBytes: png.length });

    const served = await app.inject({ method: 'GET', url: image.url, cookies: c.cookies });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(png)).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: image.url, cookies: b.cookies })).statusCode,
    ).toBe(404);

    // A script disguised as an image is rejected (type is detected from the bytes).
    const fake = await app.inject({
      method: 'POST',
      url: `/api/v1/manager/products/${p.id}/images`,
      cookies: c.cookies,
      ...multipart(Buffer.from('<script>alert(1)</script>'), 'x.png'),
    });
    expect(fake.json().code).toBe('UNSUPPORTED_MEDIA');
    const big = await app.inject({
      method: 'POST',
      url: `/api/v1/manager/products/${p.id}/images`,
      cookies: c.cookies,
      ...multipart(Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)])),
    });
    expect(big.statusCode).toBe(413);

    const removed = await app.inject({ method: 'DELETE', url: image.url, cookies: c.cookies });
    expect(removed.json().images).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('never exposes or modifies another merchant’s catalog', async () => {
    const a = await company();
    const b = await company();
    const pb = (await create(b, simple({ nameEn: 'Secret product' }))).json();
    const cb = (
      await b.client.request('POST', '/manager/categories', {
        cookies: b.cookies,
        body: { nameEn: 'Secret cat' },
      })
    ).json();
    expect(
      (await a.client.request('GET', `/manager/products/${pb.id}`, { cookies: a.cookies }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await a.client.request('POST', `/manager/products/${pb.id}/status`, {
          cookies: a.cookies,
          body: { status: 'archived' },
        })
      ).statusCode,
    ).toBe(404);
    const list = (
      await a.client.request('GET', '/manager/products?status=all', { cookies: a.cookies })
    ).json();
    expect(list.products.map((p: { nameEn: string }) => p.nameEn)).not.toContain('Secret product');
    expect((await create(a, simple({ categoryId: cb.id }))).statusCode).toBe(404);
    // A foreign variant id cannot be hijacked through an update.
    const pa = (await create(a, simple())).json();
    const hijack = await a.client.request('PATCH', `/manager/products/${pa.id}`, {
      cookies: a.cookies,
      body: { nameEn: 'x', version: pa.version, variants: [{ id: pb.variants[0].id, price: '1' }] },
    });
    expect(hijack.statusCode).toBe(404);
  });
});
