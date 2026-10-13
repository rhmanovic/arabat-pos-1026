import { expect, test } from '@playwright/test';
import { latestMailText, signIn, uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

/**
 * Prompt 10 acceptance scenario, on real APIs and PostgreSQL:
 * branch → products + stock → cashier → POS sign-in at the branch → shift → scan → pay →
 * sale saved → stock deducted exactly once → receipt → manager sees the transaction.
 */
test('end-to-end sale from setup to manager review', async ({ page, browser }) => {
  const ownerEmail = uniqueEmail('co-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Checkout Co' },
          owner: { fullName: 'Checkout Owner', email: ownerEmail, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);

  // 1. The manager creates a branch (UI).
  await page.goto('/manager/branches');
  await page.getByRole('button', { name: 'Add branch' }).click();
  const branchDialog = page.getByRole('dialog');
  await branchDialog.getByLabel('Code').fill('avenues');
  await branchDialog.getByLabel('Name (English)').fill('Avenues');
  await branchDialog.getByLabel('Receipt footer').fill('Thank you for shopping at Avenues');
  await branchDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'AVENUES', exact: true })).toBeVisible();
  const branches = (await (await page.request.get('/api/v1/manager/branches')).json()).branches as {
    id: string;
    code: string;
  }[];
  const avenues = branches.find((b) => b.code === 'AVENUES')!.id;

  // 2. Products and stock.
  const tea = await (
    await page.request.post('/api/v1/manager/products', {
      data: {
        nameEn: 'Saffron tea',
        variants: [{ sku: 'SAF', price: '1.250', cost: '0.400', barcodes: ['6281000000017'] }],
      },
    })
  ).json();
  const cup = await (
    await page.request.post('/api/v1/manager/products', {
      data: {
        nameEn: 'Paper cup',
        variants: [{ sku: 'CUP', price: '0.075', barcodes: ['6281000000024'] }],
      },
    })
  ).json();
  expect(
    (
      await page.request.post('/api/v1/manager/inventory/adjustments', {
        data: {
          branchId: avenues,
          kind: 'opening',
          reason: 'opening',
          lines: [
            { variantId: tea.variants[0].id, quantity: '10' },
            { variantId: cup.variants[0].id, quantity: '100' },
          ],
        },
      })
    ).status(),
  ).toBe(201);

  // 3. A cashier employee at Avenues.
  const roles = (await (await page.request.get('/api/v1/manager/roles')).json()).roles as {
    id: string;
    templateKey: string;
  }[];
  const cashierEmail = uniqueEmail('co-cashier');
  expect(
    (
      await page.request.post('/api/v1/manager/employees/invitations', {
        data: {
          email: cashierEmail,
          fullName: 'Noor Cashier',
          assignments: [
            { roleId: roles.find((r) => r.templateKey === 'cashier')!.id, branchId: avenues },
          ],
        },
      })
    ).status(),
  ).toBe(201);
  const link = /https?:\/\/\S+accept-invite\?token=[\w-]+/.exec(
    await latestMailText(cashierEmail),
  )![0];

  // 4–5. The cashier signs in to the POS at the assigned branch and opens a shift.
  const ctx = await browser.newContext();
  const pos = await ctx.newPage();
  await pos.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  await pos.goto(link);
  await pos.getByLabel('New password').fill('Cashier-Pass-2026');
  await pos.getByLabel('Confirm password').fill('Cashier-Pass-2026');
  await pos.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(pos.getByText('Your account is ready.')).toBeVisible();
  await signIn(pos, 'pos', cashierEmail, 'Cashier-Pass-2026');
  await expect(pos.getByTestId('pos-context')).toContainText('Avenues');
  await pos.getByRole('radio', { name: /Register 1/ }).click();
  await pos.getByLabel('Counted cash (KWD)').fill('10');
  await pos.getByRole('button', { name: 'Open shift' }).click();

  // 6. Scan (keyboard wedge: digits + Enter) and select products.
  const search = pos.getByLabel('Search or scan barcode');
  await search.fill('6281000000017');
  await search.press('Enter');
  await search.fill('6281000000017');
  await search.press('Enter');
  await pos.getByTestId('product-tile').filter({ hasText: 'Paper cup' }).click();
  await expect(pos.getByTestId('cart-total')).toHaveText('KWD 2.575');

  // 7. Payment: split card + cash with change.
  await pos.getByRole('button', { name: /^Pay/ }).click();
  const pay = pos.getByRole('dialog');
  await pay.getByRole('button', { name: 'Card (KNET)' }).click();
  await pay.getByLabel('Amount (KWD)').fill('1.000');
  await pay.getByLabel('Reference (optional)').fill('APPROVAL-1');
  await pay.getByRole('button', { name: 'Add payment' }).click();
  await pay.getByRole('button', { name: 'Cash' }).click();
  await pay.getByLabel('Cash received (KWD)').fill('2');
  await pay.getByRole('button', { name: 'Add payment' }).click();
  await expect(pay.getByTestId('remaining')).toHaveText('KWD 0.000');
  await expect(pay.getByTestId('change')).toHaveText('KWD 0.425');
  await pay.getByRole('button', { name: 'Complete sale' }).click();

  // 8 + 10. Saved, receipt shown.
  const receipt = pos.getByRole('dialog').getByTestId('receipt');
  await expect(receipt.getByTestId('receipt-number')).toHaveText('AVENUES-000001');
  await expect(receipt.getByTestId('receipt-total')).toHaveText('KWD 2.575');
  await expect(receipt).toContainText('Thank you for shopping at Avenues');
  await pos.getByRole('button', { name: 'New sale' }).click();
  await expect(pos.getByTestId('cart-total')).toHaveText('KWD 0.000');

  // 9. Stock deducted exactly once.
  const stock = async (variantId: string) =>
    (
      await (await page.request.get(`/api/v1/manager/inventory/variants/${variantId}`)).json()
    ).branches.find((b: { branchId: string }) => b.branchId === avenues).onHand;
  expect(await stock(tea.variants[0].id)).toBe('8.000');
  expect(await stock(cup.variants[0].id)).toBe('99.000');
  const moves = await (
    await page.request.get(`/api/v1/manager/inventory/movements?type=sale`)
  ).json();
  expect(moves.total).toBe(2);

  // Blind counts (BR-162): the cashier sees no drawer figures; the owner sees 10 + 1.575.
  await pos.getByRole('link', { name: 'Shift & cash' }).click();
  await expect(pos.getByTestId('blind-count')).toBeVisible();
  await expect(pos.getByTestId('expected-cash')).toHaveCount(0);
  const openShifts = await (await page.request.get('/api/v1/manager/shifts?status=open')).json();
  expect(openShifts.shifts[0].summary.expectedCash.amount).toBe('11.575');

  // 11. The manager views the transaction.
  await page.goto('/manager/sales');
  const row = page.getByRole('row', { name: /AVENUES-000001/ });
  await expect(row).toContainText('KWD 2.575');
  await row.click();
  await expect(page.getByRole('heading', { name: 'Sale AVENUES-000001' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'APPROVAL-1' })).toBeVisible();
  await expect(page.getByText('Noor Cashier').first()).toBeVisible();
  await ctx.close();
});
