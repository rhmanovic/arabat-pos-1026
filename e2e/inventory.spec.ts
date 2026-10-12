import { expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('manager posts opening stock, a decrease and a count; oversell is refused; history and value are exact', async ({
  page,
}) => {
  const email = uniqueEmail('inv-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Stock Co' },
          owner: { fullName: 'Stock Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const created = await page.request.post('/api/v1/manager/products', {
    data: { nameEn: 'Saffron tea', variants: [{ sku: 'SAF-1', price: '1.500', cost: '0.400' }] },
  });
  expect(created.status()).toBe(201);

  // Opening stock 10 @ 0.500
  await page.goto('/manager/inventory');
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await page.getByRole('button', { name: 'New adjustment' }).click();
  await page.getByLabel('Type').selectOption('opening');
  await page.getByLabel('Add items').fill('SAF');
  await page.getByRole('option', { name: /Saffron tea/ }).click();
  const line = page.getByTestId('adjustment-line');
  await line.getByLabel('Quantity').fill('10');
  await line.getByLabel('Unit cost').fill('0.500');
  await expect(line.getByTestId('after')).toHaveText('10');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Adjustment posted' })).toBeVisible();
  await expect(page).toHaveURL(/\/manager\/inventory\/adjustments\/[0-9a-f-]+$/);
  await expect(page.getByTestId('adjustment-reason')).toHaveText('Opening balance');

  // Decrease 2.5 damaged
  await page.goto('/manager/inventory/adjustments/new');
  await page.getByLabel('Type').selectOption('decrease');
  await page.getByLabel('Reason').selectOption('damaged');
  await page.getByLabel('Add items').fill('Saffron');
  await page.getByRole('option', { name: /Saffron tea/ }).click();
  await page.getByTestId('adjustment-line').getByLabel('Quantity').fill('2.5');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Adjustment posted' })).toBeVisible();

  // Oversell is refused and nothing changes
  await page.goto('/manager/inventory/adjustments/new');
  await page.getByLabel('Type').selectOption('decrease');
  await page.getByLabel('Add items').fill('Saffron');
  await page.getByRole('option', { name: /Saffron tea/ }).click();
  await page.getByTestId('adjustment-line').getByLabel('Quantity').fill('100');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post adjustment' }).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: 'Not enough stock for one or more items.' }),
  ).toBeVisible();

  // Stock list: 7.5 on hand valued at 0.500 → 3.750
  await page.goto('/manager/inventory');
  const row = page.getByRole('row', { name: /Saffron tea/ });
  await expect(row.getByTestId('on-hand')).toHaveText('7.5');
  await expect(row.getByText('KWD 3.750')).toBeVisible();
  await expect(page.getByText('KWD 3.750').first()).toBeVisible();

  // Low-stock alert at the branch
  await page.getByTestId('branch-context').selectOption({ index: 1 });
  await page
    .getByRole('row', { name: /Saffron tea/ })
    .getByRole('button', { name: 'Set alert' })
    .click();
  await page.getByRole('dialog').getByLabel('Low-stock alert at').fill('8');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /Saffron tea/ }).getByText('Low')).toBeVisible();

  // Count 7 → −0.5 posted automatically
  await page
    .getByRole('row', { name: /Saffron tea/ })
    .getByRole('link', { name: 'Adjust' })
    .click();
  await page.getByLabel('Type').selectOption('count');
  await page.getByTestId('adjustment-line').getByLabel('Counted').fill('7');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Adjustment posted' })).toBeVisible();
  await expect(page.getByText('-0.5', { exact: true })).toBeVisible();

  // History: three movements, newest first
  await page.getByRole('link', { name: 'Movement history' }).click();
  const table = page.getByRole('table', { name: 'Movement history' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByRole('row').nth(1)).toContainText('Count');
  await expect(table.getByRole('row').nth(3)).toContainText('Opening');
});
