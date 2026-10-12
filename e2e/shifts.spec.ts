import { expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('payment fee setup, a full POS shift with cash movements, and the manager’s discrepancy review', async ({
  page,
}) => {
  const email = uniqueEmail('shift-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Shift Co' },
          owner: { fullName: 'Shift Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);

  // Payment methods: defaults exist; add a custom method with a percentage fee.
  await page.goto('/manager/payments');
  await expect(page.getByRole('row', { name: /KNET/ })).toBeVisible();
  await page.getByRole('button', { name: 'New payment method' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (English)').fill('Deema Pay');
  await dialog.getByLabel('Type').selectOption('custom');
  await dialog.getByLabel('Processing fee').selectOption('fixed_plus_percentage');
  await dialog.getByLabel('Fixed fee (KWD)').fill('0.100');
  await dialog.getByLabel('Percentage (%)').fill('2');
  await expect(dialog.getByTestId('fee-preview')).toHaveText(
    'On a payment of KWD 10.000 the fee is KWD 0.300; you receive KWD 9.700.',
  );
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /Deema Pay/ }).getByTestId('method-fee')).toHaveText(
    'KWD 0.100 + 2%',
  );

  // The owner works a shift in the POS (explicit switch through the server).
  await page.goto('/manager/');
  await page.getByRole('button', { name: 'Switch to Point of Sale' }).click();
  await expect(page).toHaveURL(/\/pos\/$/);
  await expect(page.getByRole('heading', { name: 'Open a shift' })).toBeVisible();
  await page.getByRole('radio', { name: /Register 1/ }).click();
  await page.getByLabel('Opening cash (KWD)').fill('20');
  await page.getByRole('button', { name: 'Open shift' }).click();
  await expect(page.getByTestId('shift-strip')).toContainText('Register 1');

  await page.getByRole('link', { name: 'Shift & cash' }).click();
  await page.getByRole('button', { name: 'Cash in' }).click();
  await page.getByRole('dialog').getByLabel('Amount (KWD)').fill('5.250');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('expected-cash')).toHaveText('KWD 25.250');
  await page.getByRole('button', { name: 'Cash out' }).click();
  await page.getByRole('dialog').getByLabel('Amount (KWD)').fill('3');
  await page.getByRole('dialog').getByLabel('Reason').selectOption('safe_drop');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('expected-cash')).toHaveText('KWD 22.250');
  // More cash out than the drawer holds is refused.
  await page.getByRole('button', { name: 'Cash out' }).click();
  await page.getByRole('dialog').getByLabel('Amount (KWD)').fill('100');
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'drawer' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Close shift' }).click();
  await page.getByRole('dialog').getByLabel('Counted cash (KWD)').fill('22');
  await page.getByRole('dialog').getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByTestId('discrepancy')).toHaveText('KWD -0.250');
  await expect(page.getByTestId('close-result')).toContainText('Short');

  // Manager review: shift list, detail and discrepancy report.
  await page.goto('/manager/shifts');
  const row = page.getByRole('row', { name: /Shift Owner/ });
  await expect(row).toContainText('Short');
  await row.click();
  await expect(page.getByTestId('shift-summary')).toContainText('KWD 22.250');
  await expect(page.getByRole('cell', { name: 'Safe drop' })).toBeVisible();
  await page.goto('/manager/shifts');
  await page.getByRole('button', { name: 'Cash discrepancies' }).click();
  await expect(page.getByText('KWD 0.250').first()).toBeVisible();
});
