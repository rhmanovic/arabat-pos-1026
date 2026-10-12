import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('reports show real transactions, filter by period and export what is displayed', async ({
  page,
}) => {
  const email = uniqueEmail('rp-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Report Co' },
          owner: { fullName: 'Report Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const main = (
    (await (await page.request.get('/api/v1/manager/branches')).json()).branches as {
      id: string;
    }[]
  )[0]!.id;
  const product = await (
    await page.request.post('/api/v1/manager/products', {
      data: { nameEn: 'Dates box', variants: [{ sku: 'DAT', price: '1.250', cost: '0.500' }] },
    })
  ).json();
  const variantId = product.variants[0].id as string;
  await page.request.post('/api/v1/manager/inventory/adjustments', {
    data: {
      branchId: main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '10', unitCost: '0.500' }],
    },
  });
  const methods = (await (await page.request.get('/api/v1/manager/payment-methods')).json())
    .methods as { id: string; kind: string }[];
  const registers = (
    await (await page.request.get(`/api/v1/manager/registers?branchId=${main}`)).json()
  ).registers as { id: string }[];

  // The owner sells at the till through the POS API (real checkout).
  const pos = await page.request.post('/api/v1/auth/manager/switch-interface', {
    data: { target: 'pos', branchId: main },
  });
  expect(pos.ok()).toBe(true);
  expect(
    (
      await page.request.post('/api/v1/pos/shifts', {
        data: { registerId: registers[0]!.id, openingFloat: '5.000' },
      })
    ).status(),
  ).toBe(201);
  for (const [quantity, kind, amount] of [
    ['2', 'cash', '2.500'],
    ['1', 'card', '1.250'],
  ] as const) {
    const sale = await page.request.post('/api/v1/pos/sales', {
      data: {
        idempotencyKey: crypto.randomUUID(),
        lines: [{ variantId, quantity }],
        payments: [{ methodId: methods.find((m) => m.kind === kind)!.id, amount }],
        expectedTotal: amount,
      },
    });
    expect(sale.status()).toBe(201);
  }

  await page.goto('/manager/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.getByLabel('Period').selectOption('today');
  await expect(page.getByTestId('kpi-net-sales')).toContainText('KWD 3.750');
  await expect(page.getByTestId('kpi-net-sales')).toContainText('No data in the previous period');
  await expect(page.getByTestId('kpi-profit')).toContainText('KWD 2.250'); // 3.750 − 3 × 0.500
  await expect(page.getByTestId('chart-bar')).toHaveCount(24 + 1);

  // Export equals the table.
  const table = page.getByRole('table', { name: 'Sales by branch' });
  await expect(table).toContainText('KWD 3.750');
  const section = page.locator('section', { has: table });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv.replace(/^\uFEFF/, '').split('\r\n')[1]).toBe(
    'Main branch,2,3.750,0.000,3.750,0.000,3.750',
  );

  // Yesterday has nothing.
  await page.getByLabel('Period').selectOption('yesterday');
  await expect(page.getByTestId('kpi-net-sales')).toContainText('KWD 0.000');

  // Payments & cash.
  await page.getByLabel('Period').selectOption('today');
  await page.getByRole('button', { name: 'Payments & cash' }).click();
  await expect(page.getByTestId('kpi-collected')).toContainText('KWD 3.750');
  await expect(page.getByTestId('cash-summary')).toContainText('KWD 2.500');

  // Inventory valuation: 7 × 0.500.
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expect(page.getByTestId('kpi-stock-value')).toContainText('KWD 3.500');
});
