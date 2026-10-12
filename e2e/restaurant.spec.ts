import { type Browser, type Page, expect, test } from '@playwright/test';
import { latestMailText, signIn, uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

async function employee(
  page: Page,
  browser: Browser,
  templateKey: string,
  branchId: string,
  name: string,
) {
  const roles = (await (await page.request.get('/api/v1/manager/roles')).json()).roles as {
    id: string;
    templateKey: string;
  }[];
  const email = uniqueEmail(`rs-${templateKey}`);
  expect(
    (
      await page.request.post('/api/v1/manager/employees/invitations', {
        data: {
          email,
          fullName: name,
          assignments: [{ roleId: roles.find((r) => r.templateKey === templateKey)!.id, branchId }],
        },
      })
    ).status(),
  ).toBe(201);
  const link = /https?:\/\/\S+accept-invite\?token=[\w-]+/.exec(await latestMailText(email))![0];
  const ctx = await browser.newContext();
  const pos = await ctx.newPage();
  await pos.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  await pos.goto(link);
  await pos.getByLabel('New password').fill('Staff-Pass-2026');
  await pos.getByLabel('Confirm password').fill('Staff-Pass-2026');
  await pos.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(pos.getByText('Your account is ready.')).toBeVisible();
  await signIn(pos, 'pos', email, 'Staff-Pass-2026');
  return pos;
}

test('restaurant: setup, table order with modifiers, kitchen display, split bill, stock', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('rs-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Grill House' },
          owner: { fullName: 'Grill Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const api = async (method: 'get' | 'post' | 'put', path: string, data?: unknown) => {
    const res = await page.request[method](`/api/v1${path}`, data === undefined ? {} : { data });
    expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
    return res.json();
  };
  const main = (await api('get', '/manager/branches')).branches[0].id as string;
  const food = (await api('post', '/manager/categories', { nameEn: 'Food' })).id;
  const drinks = (await api('post', '/manager/categories', { nameEn: 'Drinks' })).id;
  const variant = async (body: Record<string, unknown>) =>
    (await api('post', '/manager/products', body)).variants[0].id as string;
  const bun = await variant({
    nameEn: 'Bun',
    variants: [{ sku: 'BUN', price: '0.200', cost: '0.100' }],
  });
  const patty = await variant({
    nameEn: 'Patty',
    variants: [{ sku: 'PAT', price: '1.000', cost: '0.500' }],
  });
  const cola = await variant({
    nameEn: 'Cola',
    categoryId: drinks,
    variants: [{ sku: 'COLA', price: '0.500', cost: '0.150' }],
  });
  const burger = await api('post', '/manager/products', {
    nameEn: 'Grill burger',
    categoryId: food,
    trackInventory: false,
    variants: [{ sku: 'BRG', price: '2.000' }],
  });
  await api('post', '/manager/inventory/adjustments', {
    branchId: main,
    kind: 'opening',
    reason: 'opening',
    lines: [
      { variantId: bun, quantity: '20', unitCost: '0.100' },
      { variantId: patty, quantity: '20', unitCost: '0.500' },
      { variantId: cola, quantity: '20', unitCost: '0.150' },
    ],
  });
  const doneness = await api('post', '/manager/restaurant/modifier-groups', {
    nameEn: 'Doneness',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [{ nameEn: 'Medium' }, { nameEn: 'Well done' }],
  });
  await api('put', `/manager/restaurant/menu/${burger.id}`, {
    modifierGroupIds: [doneness.id],
    recipes: [
      {
        variantId: burger.variants[0].id,
        components: [
          { componentVariantId: bun, quantity: '1' },
          { componentVariantId: patty, quantity: '1' },
        ],
      },
    ],
  });
  await api('post', '/manager/restaurant/stations', {
    branchId: main,
    nameEn: 'Kitchen',
    isDefault: true,
  });
  await api('post', '/manager/restaurant/stations', {
    branchId: main,
    nameEn: 'Bar',
    categoryIds: [drinks],
  });

  // Manager UI: turn the module on and set up the floor.
  await page.goto('/manager/restaurant');
  await expect(page.getByText(/The restaurant module is off/)).toBeVisible();
  await page.getByLabel('Use restaurant service (tables, kitchen display)').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Changes saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Tables & stations' }).click();
  await page.getByRole('button', { name: 'New area' }).click();
  await page.getByRole('dialog').getByLabel('Name (English)').fill('Hall');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'New table' }).click();
  await page.getByRole('dialog').getByLabel('Table code').fill('T1');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('manager-table')).toContainText('T1');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('row', { name: /Grill burger/ })).toContainText(
    'Ingredients (recipe)',
  );

  // Cashier: table T1, two burgers (medium, note) and a cola, sent to the kitchen.
  const pos = await employee(page, browser, 'cashier', main, 'Rana Cashier');
  await pos.getByRole('radio', { name: /Register 1/ }).click();
  await pos.getByLabel('Counted cash (KWD)').fill('10');
  await pos.getByRole('button', { name: 'Open shift' }).click();
  await pos.getByRole('link', { name: 'Tables' }).click();
  await pos.getByRole('button', { name: 'Table T1' }).click();
  await expect(pos).toHaveURL(/\/pos\/tables\/orders\//);
  await pos.getByTestId('menu-tile').filter({ hasText: 'Grill burger' }).click();
  const mods = pos.getByRole('dialog');
  await mods.getByRole('button', { name: 'Medium' }).click();
  await mods.getByLabel('Quantity').fill('2');
  await mods.getByLabel('Kitchen note').fill('no onions');
  await mods.getByRole('button', { name: /Add/ }).click();
  await pos.getByTestId('menu-tile').filter({ hasText: 'Cola' }).click();
  await expect(pos.getByTestId('order-item')).toHaveCount(2);
  await expect(pos.getByTestId('order-due')).toHaveText('KWD 4.500');
  await pos.getByRole('button', { name: 'Send to kitchen' }).click();
  await expect(pos.getByTestId('toast').filter({ hasText: 'Sent to the kitchen' })).toBeVisible();
  await expect(pos.getByTestId('order-item').first()).toContainText('Sent');

  // Kitchen display (separate device): the burgers arrive with their note.
  const kitchen = await employee(page, browser, 'kitchen', main, 'Chef Omar');
  await expect(kitchen).toHaveURL(/\/pos\/kitchen$/);
  await kitchen.getByLabel('Station').selectOption({ label: 'Kitchen' });
  const ticket = kitchen.getByTestId('kitchen-ticket').filter({ hasText: 'Grill burger' });
  await expect(ticket).toContainText('no onions');
  await expect(ticket).toContainText('Medium');
  await ticket.getByRole('button', { name: 'Start' }).click();
  await kitchen
    .getByTestId('kitchen-ticket')
    .filter({ hasText: 'Grill burger' })
    .getByRole('button', { name: 'Ready' })
    .click();
  await expect(
    kitchen.getByRole('region', { name: 'Ready' }).getByTestId('kitchen-ticket'),
  ).toContainText('Grill burger');

  // Cashier sees it ready; nothing has been sold or deducted yet.
  await pos.reload();
  await expect(pos.getByTestId('order-item').first()).toContainText('Ready');
  const level = async (variantId: string) =>
    (
      (await api('get', `/manager/inventory/variants/${variantId}`)).branches as {
        branchId: string;
        onHand: string;
      }[]
    ).find((b) => b.branchId === main)!.onHand;
  expect(await level(bun)).toBe('20.000');

  // Split bill: the burgers in cash, then the cola by card.
  await pos.getByRole('button', { name: 'Pay bill' }).click();
  let bill = pos.getByRole('dialog');
  await bill.getByRole('checkbox', { name: /Cola/ }).uncheck();
  await expect(bill.getByTestId('bill-total')).toHaveText('KWD 4.000');
  await bill.getByRole('button', { name: /^Pay/ }).click();
  let pay = pos.getByRole('dialog');
  await pay.getByRole('button', { name: 'Cash' }).click();
  await pay.getByLabel('Cash received (KWD)').fill('5');
  await pay.getByRole('button', { name: 'Add payment' }).click();
  await expect(pay.getByTestId('change')).toHaveText('KWD 1.000');
  await pay.getByRole('button', { name: 'Complete sale' }).click();
  const receipt = pos.getByRole('dialog').getByTestId('receipt');
  await expect(receipt.getByTestId('receipt-modifiers')).toContainText('Medium');
  await pos.getByRole('button', { name: 'New sale' }).click();
  await expect(pos.getByTestId('order-due')).toHaveText('KWD 0.500');

  await pos.getByRole('button', { name: 'Pay bill' }).click();
  bill = pos.getByRole('dialog');
  await expect(bill.getByTestId('bill-total')).toHaveText('KWD 0.500');
  await bill.getByRole('button', { name: /^Pay/ }).click();
  pay = pos.getByRole('dialog');
  await pay.getByRole('button', { name: 'Card (KNET)' }).click();
  await pay.getByRole('button', { name: 'Add payment' }).click();
  await pay.getByRole('button', { name: 'Complete sale' }).click();
  await expect(pos.getByRole('dialog').getByTestId('receipt')).toBeVisible();
  await pos.getByRole('button', { name: 'New sale' }).click();
  await expect(pos.getByText('Closed', { exact: false })).toBeVisible();

  // The table is free again.
  await pos.getByRole('link', { name: 'Tables' }).click();
  await expect(pos.getByRole('button', { name: 'Table T1' })).toContainText('Free');

  // Stock moved once at payment (recipe ingredients), revenue = the two bills.
  expect(await level(bun)).toBe('18.000');
  expect(await level(patty)).toBe('18.000');
  expect(await level(cola)).toBe('19.000');
  const sales = await api('get', '/manager/sales?serviceType=dine_in');
  expect(sales.total).toBe(2);
  expect(sales.totals.amount.amount).toBe('4.500');
  await page.goto('/manager/sales');
  await expect(page.getByRole('row', { name: /MAIN-000001/ })).toBeVisible();
});
