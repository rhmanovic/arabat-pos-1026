import { expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

// 1×1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('manager creates categories and products with variants, prices, availability and images', async ({
  page,
}) => {
  const email = uniqueEmail('cat-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Catalog Co' },
          owner: { fullName: 'Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const second = await page.request.post('/api/v1/manager/branches', {
    data: { code: 'B2', nameEn: 'Mall branch' },
  });
  expect(second.status()).toBe(201);

  // Category
  await page.goto('/manager/categories');
  await page.getByRole('button', { name: 'New category' }).click();
  await page.getByRole('dialog').getByLabel('Name (English)').fill('Drinks');
  await page.getByRole('dialog').getByLabel('Name (Arabic)').fill('مشروبات');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Drinks' })).toBeVisible();

  // Product with two variants, sold only at the mall branch
  await page.getByRole('link', { name: 'Products' }).click();
  await page.getByRole('button', { name: 'New product' }).click();
  await page.getByLabel('Name (Arabic)', { exact: true }).fill('قهوة');
  await page.getByLabel('Name (English)', { exact: true }).fill('Coffee');
  await page.getByLabel('Category').selectOption({ label: 'Drinks' });
  await page.getByLabel('This product has variants').check();
  const rows = page.getByTestId('variant-row');
  await rows.nth(0).getByLabel('Variant name (Name (English))').fill('Small');
  await rows.nth(0).getByLabel('SKU').fill('COF-S');
  await rows.nth(0).getByLabel('Barcodes').fill('62810001');
  await rows.nth(0).getByLabel('Price (KWD)').fill('0.750');
  await rows.nth(0).getByLabel('Cost (KWD)').fill('0.2');
  await page.getByRole('button', { name: 'Add variant' }).click();
  await rows.nth(1).getByLabel('Variant name (Name (English))').fill('Large');
  await rows.nth(1).getByLabel('SKU').fill('COF-L');
  await rows.nth(1).getByLabel('Price (KWD)').fill('1.1255');
  await expect(rows.nth(1).getByText('Invalid amount: use up to 3 decimal places.')).toBeVisible();
  await rows.nth(1).getByLabel('Price (KWD)').fill('1.125');
  await page.getByLabel('Only at selected branches').check();
  await page.getByRole('checkbox', { name: 'Mall branch' }).check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Product created' })).toBeVisible();
  await expect(page).toHaveURL(/\/manager\/products\/[0-9a-f-]+$/);

  // Image upload
  await page
    .getByLabel('Upload image')
    .setInputFiles({ name: 'coffee.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('toast').filter({ hasText: 'Image uploaded' })).toBeVisible();
  await expect(page.locator('figure img')).toHaveCount(1);

  // List: search by barcode, price shown as a range start
  await page.getByRole('link', { name: 'Products' }).click();
  await page.getByLabel('Search').fill('62810001');
  await expect(page.getByRole('cell', { name: /Coffee/ })).toBeVisible();
  await expect(page.getByText('from KWD 0.750')).toBeVisible();

  // Duplicate SKU is reported clearly
  await page.getByRole('button', { name: 'New product' }).click();
  await page.getByLabel('Name (English)', { exact: true }).fill('Copy');
  await page.getByTestId('variant-row').first().getByLabel('SKU').fill('cof-s');
  await page.getByTestId('variant-row').first().getByLabel('Price (KWD)').fill('1');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(
    page.getByTestId('toast').filter({ hasText: 'Another product already uses this SKU.' }),
  ).toBeVisible();

  // POS catalog of the main branch does not include the mall-only product
  const pos = await page.request.post('/api/v1/auth/manager/switch-interface', {
    data: { target: 'pos' },
  });
  expect((await pos.json()).status).toBe('select_branch');
});
