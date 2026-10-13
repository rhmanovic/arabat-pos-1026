import { expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('expenses, a bank deposit, a branch transfer and a supplier paid from the drawer', async ({
  page,
}) => {
  const email = uniqueEmail('payouts-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Payouts Co' },
          owner: { fullName: 'Payouts Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post('/api/v1/manager/branches', {
        data: { code: 'B2', nameEn: 'Salmiya' },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post('/api/v1/manager/suppliers', {
        data: { nameEn: 'Gulf Packaging' },
      })
    ).status(),
  ).toBe(201);

  // Count the main treasury: it can pay out from now on.
  await page.goto('/manager/cash');
  const main = page.getByRole('region', { name: 'Main branch' });
  await main.getByTestId('cash-place-treasury').getByRole('button', { name: 'Count' }).click();
  await page.getByRole('dialog').getByLabel('Counted cash (KWD)').fill('100');
  await page.getByRole('dialog').getByRole('button', { name: 'Save count' }).click();
  await expect(main.getByTestId('cash-place-treasury')).toContainText('KWD 100.000');

  // An expense from the treasury: a real outflow with its category.
  await page.getByRole('button', { name: 'Pay expense / supplier' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Expense category').selectOption('supplies');
  await dialog.getByLabel('Amount').fill('4');
  await dialog.getByLabel('Description').fill('Paper rolls');
  await dialog.getByRole('button', { name: 'Pay expense / supplier' }).click();
  await expect(main.getByTestId('cash-place-treasury')).toContainText('KWD 96.000');

  // A bank deposit: the cash leaves company cash and waits in transit until it is confirmed
  // on the bank side (BR-168). The slip number is mandatory.
  await page.getByRole('button', { name: 'Deposit to bank' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Bank account').selectOption({ index: 1 });
  await dialog.getByLabel('Amount').fill('50');
  await expect(dialog.getByRole('button', { name: 'Deposit to bank' })).toBeDisabled();
  await dialog.getByLabel('Deposit slip number').fill('SLIP-7');
  await dialog.getByRole('button', { name: 'Deposit to bank' }).click();
  await expect(main.getByTestId('cash-place-treasury')).toContainText('KWD 46.000');
  await expect(page.getByText('Deposits in transit').first()).toBeVisible();

  // Cash sent to the other branch waits in transit until it is counted there.
  await page.getByRole('button', { name: 'Send to branch' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount').fill('10');
  await dialog.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(main.getByTestId('cash-place-treasury')).toContainText('KWD 36.000');
  await expect(page.getByText('In transit').first()).toBeVisible();
  await page.getByRole('button', { name: 'Between branches' }).click();
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Counted cash (KWD)').fill('9.500');
  await dialog.getByLabel('Note').fill('Short by half a dinar');
  await dialog.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByRole('cell', { name: 'Received', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Expenses & payments' }).click();
  await expect(page.getByTestId('disbursements-total')).toContainText('KWD 4.000');
  await expect(page.getByRole('cell', { name: /Supplies/ })).toBeVisible();
  // The owner confirms the deposit in the bank (their own: an audited override).
  const transit = page.getByTestId('deposits-in-transit');
  await expect(transit).toContainText('SLIP-7');
  await transit.getByTestId('settle-deposit').click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Bank reference (optional)').fill('NBK-123');
  await dialog.getByRole('button', { name: 'Confirm in bank' }).click();
  await expect(page.getByTestId('deposits-in-transit')).toHaveCount(0);

  // Bank reconciliation: the statement shows the deposit; balanced.
  await page.goto('/manager/accounts');
  await expect(page.getByText('1 unreconciled')).toBeVisible();
  await page.getByRole('button', { name: 'Reconcile' }).first().click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/NBK-123/).check();
  await dialog.getByLabel('Statement balance (KWD)').fill('50');
  await expect(dialog.getByText('The statement matches the cleared balance.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save reconciliation' }).click();
  await expect(page.getByText('Reconciled', { exact: true })).toBeVisible();
  await page.goto('/manager/cash');

  // At the POS: the owner pays the supplier from the drawer.
  await page.goto('/manager/');
  await page.getByRole('button', { name: 'Switch to Point of Sale' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Main branch' }).click();
  await expect(page).toHaveURL(/\/pos\/$/);
  await page.getByRole('radio', { name: /Register 1/ }).click();
  await page.getByLabel('Counted cash (KWD)').fill('20');
  await page.getByRole('button', { name: 'Open shift' }).click();
  await page.getByRole('link', { name: 'Shift & cash' }).click();
  await page.getByRole('button', { name: 'Cash out' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount (KWD)').fill('5');
  await dialog.getByLabel('Reason').selectOption('supplier_payment');
  await expect(dialog.getByTestId('movement-hint')).toContainText('payment to the supplier');
  await dialog.getByLabel('Supplier').selectOption({ label: 'Gulf Packaging' });
  await dialog.getByLabel('Receipt / invoice number (optional)').fill('INV-55');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('expected-cash')).toHaveText('KWD 15.000');

  // The supplier's page shows what was paid.
  await page.goto('/manager/suppliers');
  await page
    .getByRole('row', { name: /Gulf Packaging/ })
    .getByRole('button', { name: 'Payments' })
    .click();
  await expect(page.getByTestId('supplier-total-paid')).toContainText('KWD 5.000');
  await expect(page.getByRole('dialog')).toContainText('INV-55');

  // Reports: expenses by category and supplier, cash by type, and the dashboard total.
  await page.keyboard.press('Escape');
  await page.goto('/manager/reports');
  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByTestId('kpi-expenses')).toContainText('KWD 4.000');
  await expect(page.getByTestId('kpi-supplier-payments')).toContainText('KWD 5.000');
  await page.getByRole('button', { name: 'Payments & cash' }).click();
  await expect(page.getByRole('row', { name: /Bank deposits/ })).toContainText('KWD 50.000');
  await page.goto('/manager/');
  // 36 + 9.500 in the treasuries, 15 in the open drawer.
  await expect(page.getByTestId('dashboard-cash')).toContainText('KWD 60.500');
});
