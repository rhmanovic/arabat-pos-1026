import { expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('a shopper buys online with the sandbox gateway; the order, stock and reports follow', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('st-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Store Co' },
          owner: { fullName: 'Store Owner', email, password: 'Owner-Pass-2026' },
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
      data: { nameEn: 'Saffron tea', variants: [{ sku: 'TEA', price: '1.250', cost: '0.400' }] },
    })
  ).json();
  const variantId = product.variants[0].id as string;
  await page.request.post('/api/v1/manager/inventory/adjustments', {
    data: {
      branchId: main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '5', unitCost: '0.400' }],
    },
  });
  const methods = (await (await page.request.get('/api/v1/manager/payment-methods')).json())
    .methods as { id: string; kind: string; version: number }[];
  const card = methods.find((m) => m.kind === 'card')!;
  expect(
    (
      await page.request.patch(`/api/v1/manager/payment-methods/${card.id}`, {
        data: {
          kind: 'card',
          nameEn: 'Card (test)',
          availableOnline: true,
          gatewayProvider: 'mock',
          version: card.version,
        },
      })
    ).ok(),
  ).toBe(true);

  // The owner lists the product and publishes the store in the manager.
  const slug = `e2e-${Date.now().toString(36)}`;
  await page.goto('/manager/online');
  await expect(page.getByRole('heading', { name: 'Online store' })).toBeVisible();
  await page.getByRole('button', { name: 'Products online' }).click();
  await page.getByRole('checkbox', { name: 'Saffron tea' }).check();
  await page.getByRole('button', { name: 'List online (1)' }).click();
  await expect(page.getByText('Listed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Store settings' }).click();
  await page.getByLabel('Store address').fill(slug);
  await page.getByLabel('Store name (English)').fill('Saffron House');
  await page.getByLabel('Fulfilment branch').selectOption(main);
  await page.getByLabel('Delivery', { exact: true }).check();
  await page.getByLabel('Delivery fee').fill('0.500');
  await page.getByLabel('Status').selectOption('published');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: new RegExp(`/store/${slug}$`) })).toBeVisible();

  // An anonymous shopper (separate browser context, no session) buys 2.
  const shopperContext = await browser.newContext();
  await shopperContext.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  const shopper = await shopperContext.newPage();
  await shopper.goto(`/store/${slug}`);
  await expect(shopper.getByText('Saffron House')).toBeVisible();
  await shopper.getByRole('link', { name: /Saffron tea/ }).click();
  await shopper.getByLabel('Quantity').selectOption('2');
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.getByRole('link', { name: 'Cart (2)' }).click();
  await expect(shopper.getByText('KWD 2.500').first()).toBeVisible();
  await shopper.getByRole('button', { name: 'Checkout' }).click();
  await shopper.getByLabel('Full name').fill('Mariam');
  await shopper.getByLabel('Phone').fill('+96560001111');
  await shopper.getByRole('radio', { name: /Delivery/ }).check();
  await shopper.getByLabel('Delivery address').fill('Block 3, Street 10, Salmiya');
  await expect(shopper.getByTestId('checkout-total')).toHaveText('KWD 3.000');
  await shopper.getByRole('button', { name: 'Place order and pay' }).click();

  // Sandbox gateway page, then back to tracking.
  await expect(shopper.getByRole('heading', { name: 'Test payment' })).toBeVisible();
  await expect(shopper.getByText('KWD 3.000')).toBeVisible();
  await shopper.getByRole('button', { name: 'Pay (test success)' }).click();
  await expect(shopper.getByTestId('order-status')).toHaveText('Paid');
  await expect(shopper.getByRole('heading', { name: 'Order W-000001' })).toBeVisible();
  await shopperContext.close();

  // Stock: 5 − 2 sold online.
  const level = await (
    await page.request.get(`/api/v1/manager/inventory/variants/${variantId}`)
  ).json();
  expect(level.branches.find((b: { branchId: string }) => b.branchId === main).onHand).toBe(
    '3.000',
  );

  // The manager sees the paid order and moves it forward.
  await page.goto('/manager/online');
  await page.getByText('W-000001').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Mariam')).toBeVisible();
  await dialog.getByRole('button', { name: 'Start preparing' }).click();
  await expect(dialog.getByText('Preparing').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // The sale is an online-channel sale, separate from POS in sales and reports.
  await page.goto('/manager/sales');
  await page.getByLabel('Channel').selectOption('online');
  await expect(page.getByRole('cell', { name: 'Online' })).toBeVisible();
  await expect(page.getByTestId('sales-summary')).toContainText('1 sales · KWD 3.000');
  await page.goto('/manager/reports');
  await page.getByLabel('Period').selectOption('today');
  const byChannel = page.locator('section', { hasText: 'Sales by channel' });
  await expect(byChannel.getByRole('cell', { name: 'Online' })).toBeVisible();
  await expect(byChannel).toContainText('3.000');
});
