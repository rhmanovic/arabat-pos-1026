import { type Page, expect, test } from '@playwright/test';
import { latestMailText, signIn, uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

async function payCash(pos: Page) {
  await pos.getByRole('button', { name: /^Pay/ }).click();
  const pay = pos.getByRole('dialog');
  await pay.getByRole('button', { name: 'Cash' }).click();
  await pay.getByRole('button', { name: 'Add payment' }).click();
  await pay.getByRole('button', { name: 'Complete sale' }).click();
}

test('customer profiles in the manager and customer selection at the POS', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('cu-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Customer Co' },
          owner: { fullName: 'Customer Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const main = (
    (await (await page.request.get('/api/v1/manager/branches')).json()).branches as {
      id: string;
      isMain: boolean;
    }[]
  ).find((b) => b.isMain)!.id;
  const juice = await (
    await page.request.post('/api/v1/manager/products', {
      data: { nameEn: 'Orange juice', variants: [{ sku: 'OJ', price: '0.750' }] },
    })
  ).json();
  await page.request.post('/api/v1/manager/inventory/adjustments', {
    data: {
      branchId: main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: juice.variants[0].id, quantity: '20' }],
    },
  });

  // 1. Manager creates a profile and a note.
  await page.goto('/manager/customers');
  await expect(page.getByText('No customers yet.')).toBeVisible();
  await page.getByRole('button', { name: 'New customer' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('Fatima Al-Sabah');
  await dialog.getByLabel('Phone').fill('5555 1234');
  await dialog.getByLabel('E-mail').fill('fatima@example.com');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/manager\/customers\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Fatima Al-Sabah' })).toBeVisible();
  await expect(page.getByText('+96555551234')).toBeVisible();
  await page.getByLabel('New note').fill('Prefers fresh juice');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByTestId('customer-note')).toContainText('Prefers fresh juice');

  // 2. A cashier sells to her, then to a walk-in, then registers a new customer.
  const roles = (await (await page.request.get('/api/v1/manager/roles')).json()).roles as {
    id: string;
    templateKey: string;
  }[];
  const cashierEmail = uniqueEmail('cu-cashier');
  await page.request.post('/api/v1/manager/employees/invitations', {
    data: {
      email: cashierEmail,
      fullName: 'Huda Cashier',
      assignments: [{ roleId: roles.find((r) => r.templateKey === 'cashier')!.id, branchId: main }],
    },
  });
  const link = /https?:\/\/\S+accept-invite\?token=[\w-]+/.exec(
    await latestMailText(cashierEmail),
  )![0];
  const ctx = await browser.newContext();
  const pos = await ctx.newPage();
  await pos.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  await pos.goto(link);
  await pos.getByLabel('New password').fill('Cashier-Pass-2026');
  await pos.getByLabel('Confirm password').fill('Cashier-Pass-2026');
  await pos.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(pos.getByText('Your account is ready.')).toBeVisible();
  await signIn(pos, 'pos', cashierEmail, 'Cashier-Pass-2026');
  await pos.getByRole('radio', { name: /Register 1/ }).click();
  await pos.getByLabel('Opening cash (KWD)').fill('10');
  await pos.getByRole('button', { name: 'Open shift' }).click();

  const tile = pos.getByTestId('product-tile').filter({ hasText: 'Orange juice' });
  await tile.click();
  await tile.click();
  await expect(pos.getByTestId('cart-customer')).toContainText('Walk-in');
  await pos.getByRole('button', { name: 'Choose customer' }).click();
  await pos.getByRole('dialog').getByLabel('Name, phone or code').fill('5555');
  await pos
    .getByRole('dialog')
    .getByRole('button', { name: /Fatima Al-Sabah/ })
    .click();
  await expect(pos.getByTestId('cart-customer')).toContainText('Fatima Al-Sabah');
  await payCash(pos);
  const receipt = pos.getByRole('dialog').getByTestId('receipt');
  await expect(receipt.getByTestId('receipt-customer')).toHaveText('Fatima Al-Sabah');
  await pos.getByRole('button', { name: 'New sale' }).click();
  // The next sale starts as a walk-in.
  await expect(pos.getByTestId('cart-customer')).toContainText('Walk-in');
  await tile.click();
  await payCash(pos);
  await expect(pos.getByRole('dialog').getByTestId('receipt-customer')).toHaveCount(0);
  await pos.getByRole('button', { name: 'New sale' }).click();

  await tile.click();
  await pos.getByRole('button', { name: 'Choose customer' }).click();
  const picker = pos.getByRole('dialog');
  await picker.getByLabel('Name, phone or code').fill('9876 5432');
  await expect(picker.getByText('No customer found.')).toBeVisible();
  await picker.getByRole('button', { name: 'New customer' }).click();
  await picker.getByLabel('Full name').fill('Salem');
  await picker.getByRole('button', { name: 'Save and use' }).click();
  await expect(pos.getByTestId('cart-customer')).toContainText('Salem');
  await payCash(pos);
  await expect(pos.getByRole('dialog').getByTestId('receipt-customer')).toHaveText('Salem');
  await ctx.close();

  // 3. The manager sees exact history and spending.
  await page.goto('/manager/customers');
  const fatimaRow = page.getByRole('row', { name: /Fatima Al-Sabah/ });
  await expect(fatimaRow).toContainText('KWD 1.500');
  await expect(page.getByRole('row', { name: /Salem/ })).toContainText('KWD 0.750');
  await page.getByLabel('Search name, phone, code or e-mail').fill('98765432');
  await expect(page.getByRole('row', { name: /Salem/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Fatima/ })).toHaveCount(0);
  await page.getByLabel('Search name, phone, code or e-mail').fill('');
  await page.getByRole('row', { name: /Fatima Al-Sabah/ }).click();
  const stats = page.getByTestId('customer-stats');
  await expect(stats).toContainText('KWD 1.500');
  await expect(page.getByText('1 purchase', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'MAIN-000001' })).toBeVisible();

  // Sales list shows who bought; walk-in stays walk-in.
  await page.goto('/manager/sales');
  await expect(page.getByRole('row', { name: /MAIN-000001/ })).toContainText('Fatima Al-Sabah');
  await expect(page.getByRole('row', { name: /MAIN-000002/ })).toContainText('Walk-in');
});
