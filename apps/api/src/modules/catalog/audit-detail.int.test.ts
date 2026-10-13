import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Remediation session 12, R5.3 (BR-191): before / after values in the audit entries of the
 * company profile, products, categories, suppliers and draft orders, and the price / cost
 * history of a product.
 */
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

type Co = Awaited<ReturnType<typeof createCompany>>;
const req = (
  c: Co,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
  cookies = c.cookies,
) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
const latest = async (c: Co, action: string) =>
  (await req(c, 'GET', `/manager/audit?action=${action}`)).json().entries[0] as {
    details: Record<string, unknown>;
  };

describe('audit detail and price history (R5.3)', () => {
  it('records field-level changes for the profile, categories, products, suppliers and draft orders', async () => {
    const c = await createCompany(app, db, mailer);
    // Company profile.
    const profile = (await req(c, 'GET', '/manager/merchant')).json();
    const saved = await req(c, 'PATCH', '/manager/merchant', {
      version: profile.version,
      nameEn: profile.nameEn,
      nameAr: profile.nameAr,
      legalName: 'Test Trading WLL',
      commercialRegistrationNo: 'CR-1001',
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      defaultLanguage: profile.defaultLanguage,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await latest(c, 'merchant.profile.updated')).details).toEqual({
      changes: {
        legalName: { from: null, to: 'Test Trading WLL' },
        commercialRegistrationNo: { from: null, to: 'CR-1001' },
      },
    });
    // Category.
    const cat = (await req(c, 'POST', '/manager/categories', { nameEn: 'Drinks' })).json();
    await req(c, 'PATCH', `/manager/categories/${cat.id}`, {
      nameEn: 'Beverages',
      nameAr: 'مشروبات',
      sortOrder: 2,
      version: cat.version,
    });
    expect((await latest(c, 'category.updated')).details).toEqual({
      changes: {
        nameEn: { from: 'Drinks', to: 'Beverages' },
        nameAr: { from: null, to: 'مشروبات' },
        sortOrder: { from: 0, to: 2 },
      },
    });
    // Product attributes and prices.
    const product = (
      await req(c, 'POST', '/manager/products', {
        nameEn: 'Tea',
        categoryId: cat.id,
        variants: [{ price: '1.000', cost: '0.400' }],
      })
    ).json();
    const v = product.variants[0];
    const updated = await req(c, 'PATCH', `/manager/products/${product.id}`, {
      nameEn: 'Tea',
      nameAr: 'شاي',
      descriptionEn: 'Loose leaf',
      categoryId: null,
      type: 'standard',
      hasVariants: false,
      trackInventory: true,
      availableInAllBranches: true,
      variants: [{ id: v.id, price: '1.250', cost: '0.500', barcodes: [] }],
      version: product.version,
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const pu = (await latest(c, 'product.updated')).details;
    expect(pu['changes']).toEqual({
      nameAr: { from: null, to: 'شاي' },
      descriptionEn: { from: null, to: 'Loose leaf' },
      categoryId: { from: cat.id, to: null },
    });
    expect(pu['variants']).toEqual([
      {
        variantId: v.id,
        price: { from: '1.000', to: '1.250' },
        cost: { from: '0.400', to: '0.500' },
      },
    ]);
    // Price history: creation values then the manual change, newest first; cost rows need
    // the price right.
    const history = (await req(c, 'GET', `/manager/products/${product.id}/price-history`)).json();
    expect(
      history.entries.map((e: Record<string, unknown>) => [
        e['kind'],
        e['source'],
        (e['from'] as { amount: string } | null)?.amount ?? null,
        (e['to'] as { amount: string } | null)?.amount ?? null,
      ]),
    ).toEqual([
      ['cost', 'manual', '0.400', '0.500'],
      ['price', 'manual', '1.000', '1.250'],
      ['cost', 'created', null, '0.400'],
      ['price', 'created', null, '1.000'],
    ]);
    expect(history.entries[0].changedBy).toBe('Owner Test');
    const reader = await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager');
    const limited = (
      await req(
        c,
        'GET',
        `/manager/products/${product.id}/price-history`,
        undefined,
        reader.cookies,
      )
    ).json();
    expect(limited.entries.map((e: { kind: string }) => e.kind)).toEqual(['price', 'price']);
    // Supplier.
    const supplier = (
      await req(c, 'POST', '/manager/suppliers', { nameEn: 'Gulf Foods', paymentTerms: 'Net 30' })
    ).json();
    await req(c, 'PATCH', `/manager/suppliers/${supplier.id}`, {
      nameEn: 'Gulf Foods',
      phone: '99887766',
      paymentTerms: 'Net 15',
      version: supplier.version,
    });
    expect((await latest(c, 'supplier.updated')).details).toMatchObject({
      changes: {
        phone: { from: null, to: '99887766' },
        paymentTerms: { from: 'Net 30', to: 'Net 15' },
      },
    });
    // Draft order: header and lines before / after.
    const order = (
      await req(c, 'POST', '/manager/purchase-orders', {
        supplierId: supplier.id,
        branchId: c.main,
        lines: [{ variantId: v.id, quantity: '10', unitCost: '0.400' }],
      })
    ).json();
    const edited = await req(c, 'PATCH', `/manager/purchase-orders/${order.id}`, {
      supplierId: supplier.id,
      branchId: c.main,
      note: 'urgent',
      lines: [{ variantId: v.id, quantity: '12', unitCost: '0.380' }],
      version: order.version,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect((await latest(c, 'purchase_order.updated')).details).toEqual({
      changes: { note: { from: null, to: 'urgent' } },
      lines: {
        from: [{ variantId: v.id, quantity: '10.000', unitCost: '0.400' }],
        to: [{ variantId: v.id, quantity: '12.000', unitCost: '0.380' }],
      },
    });
    // Employee profile edit and role deletion detail.
    const member = (await req(c, 'GET', '/manager/employees'))
      .json()
      .employees.find((e: { email: string }) => e.email === reader.email);
    await req(c, 'PATCH', `/manager/employees/${member.membershipId}`, {
      jobTitle: 'Floor manager',
      phone: null,
      employeeCode: 'E-07',
    });
    expect((await latest(c, 'employee.updated')).details).toEqual({
      changes: {
        jobTitle: { from: null, to: 'Floor manager' },
        employeeCode: { from: null, to: 'E-07' },
      },
    });
    const role = (
      await req(c, 'POST', '/manager/roles', {
        nameEn: 'Temp',
        permissions: ['manager.access', 'sales.read'],
      })
    ).json();
    expect((await req(c, 'DELETE' as never, `/manager/roles/${role.id}`)).statusCode).toBe(204);
    expect((await latest(c, 'role.deleted')).details).toEqual({
      name: 'Temp',
      permissions: ['manager.access', 'sales.read'],
    });
  });
});
