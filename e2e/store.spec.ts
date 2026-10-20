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
    .methods as { id: string; kind: string; version: number; financialAccountId: string }[];
  const card = methods.find((m) => m.kind === 'card')!;
  expect(
    (
      await page.request.patch(`/api/v1/manager/payment-methods/${card.id}`, {
        data: {
          kind: 'card',
          nameEn: 'Card (test)',
          availableOnline: true,
          gatewayProvider: 'mock',
          financialAccountId: card.financialAccountId,
          version: card.version,
        },
      })
    ).ok(),
  ).toBe(true);

  // The owner lists the product and publishes the store in the manager.
  const slug = `e2e-${Date.now().toString(36)}`;
  await page.goto('/online/');
  await expect(page.getByRole('heading', { name: 'Online store' })).toBeVisible();
  await page.getByRole('link', { name: 'Products online' }).click();
  await page.getByRole('checkbox', { name: 'Saffron tea' }).check();
  await page.getByRole('button', { name: 'List online (1)' }).click();
  await expect(page.getByText('Sold online (1)')).toBeVisible();
  await page.getByRole('link', { name: 'Store settings' }).click();
  await page.getByLabel('Store address').fill(slug);
  await page.getByLabel('Store name (English)').fill('Saffron House');
  await page.getByLabel('Fulfilment branch', { exact: true }).selectOption(main);
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

  // The manager sees the paid order in the online console and moves it forward.
  await page.goto('/online/orders');
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

test('a shopper orders without any gateway and pays at pickup; staff confirm, record the cash and complete', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('st-cod');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Pickup Co' },
          owner: { fullName: 'Pickup Owner', email, password: 'Owner-Pass-2026' },
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
      data: { nameEn: 'Date box', variants: [{ sku: 'DATES', price: '2.000', cost: '0.800' }] },
    })
  ).json();
  const variantId = product.variants[0].id as string;
  await page.request.post('/api/v1/manager/inventory/adjustments', {
    data: {
      branchId: main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '4', unitCost: '0.800' }],
    },
  });

  // No payment method is touched: the store publishes with "pay on receipt" only.
  const slug = `cod-${Date.now().toString(36)}`;
  // The management app hands over to the online console (same session).
  await page.goto('/manager/online');
  await expect(page).toHaveURL(/\/online\/$/);
  await page.getByRole('link', { name: 'Products online' }).click();
  await page.getByRole('checkbox', { name: 'Date box' }).check();
  await page.getByRole('button', { name: 'List online (1)' }).click();
  await expect(page.getByText('Sold online (1)')).toBeVisible();

  // Merchandising (ADR-0121): a store category, then a store title and "featured" on the listing.
  await page.getByRole('link', { name: 'Store categories', exact: true }).click();
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByLabel('Name (English)').fill('Sweets');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit category' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('link', { name: 'Products online' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Store title (English)').fill('Date box, 500 g');
  await edit.getByLabel('Store category', { exact: true }).selectOption({ label: 'Sweets' });
  await edit.getByLabel('Featured').check();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Date box, 500 g')).toBeVisible();

  await page.getByRole('link', { name: 'Store settings' }).click();
  const address = page.getByLabel('Store address');
  await address.fill(slug);
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await expect(page.getByTestId('store-url-preview')).toHaveText(new RegExp(`/store/${slug}$`));
  await page.getByLabel('Store name (English)').fill('Date House');
  await page.getByLabel('Fulfilment branch', { exact: true }).selectOption(main);
  await expect(page.getByRole('checkbox', { name: 'Allow payment on receipt' })).toBeChecked();
  await page.getByLabel('Status').selectOption('published');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('link', { name: new RegExp(`/store/${slug}$`) })).toBeVisible();

  // The shopper orders 2 to pay at pickup; nothing is reserved.
  const shopperContext = await browser.newContext();
  await shopperContext.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  const shopper = await shopperContext.newPage();
  await shopper.goto(`/store/${slug}`);
  // The store's own category and the featured section, with the store title.
  await expect(shopper.getByRole('button', { name: 'Sweets' })).toBeVisible();
  await expect(shopper.getByRole('region', { name: 'Featured' })).toBeVisible();
  await shopper
    .getByRole('link', { name: /Date box, 500 g/ })
    .first()
    .click();
  await expect(shopper).toHaveTitle('Date box, 500 g · Date House');
  await shopper.getByLabel('Quantity').selectOption('2');
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.getByRole('link', { name: 'Cart (2)' }).click();
  await shopper.getByRole('button', { name: 'Checkout' }).click();
  await shopper.getByLabel('Full name').fill('Noura');
  await shopper.getByLabel('Phone').fill('+96560002222');
  await expect(shopper.getByRole('radio', { name: 'Pay at pickup' })).toBeChecked();
  await expect(shopper.getByTestId('checkout-total')).toHaveText('KWD 4.000');
  await shopper.getByRole('button', { name: 'Place order' }).click();
  await expect(shopper.getByTestId('order-status')).toHaveText('Received');
  await expect(shopper.getByText('You pay when you pick up your order.')).toBeVisible();
  const level = async () =>
    (
      (await (await page.request.get(`/api/v1/manager/inventory/variants/${variantId}`)).json())
        .branches as { branchId: string; onHand: string }[]
    ).find((b) => b.branchId === main)!.onHand;
  expect(await level()).toBe('4.000');

  // Staff confirm, record the cash on hand-over (the sale is created now) and complete.
  await page.goto('/online/orders');
  await expect(page.getByText('Unpaid')).toBeVisible();
  await page.getByText('W-000001').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Noura')).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm order' }).click();
  await expect(dialog.getByText('Confirmed').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  const pay = page.getByRole('dialog', { name: 'Record payment for W-000001' });
  await expect(pay.getByText(/goes to the fulfilment branch/)).toBeVisible();
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog.getByText('Paid on receipt')).toBeVisible();
  await expect(dialog.getByRole('link', { name: /^Sale MAIN-/ })).toBeVisible();
  expect(await level()).toBe('2.000');
  await dialog.getByRole('button', { name: 'Ready for pickup' }).click();
  await dialog.getByRole('button', { name: 'Mark completed' }).click();
  await expect(dialog.getByText('Completed').first()).toBeVisible();
  await shopper.getByRole('button', { name: 'Refresh' }).click();
  await expect(shopper.getByTestId('order-status')).toHaveText('Completed');
  await shopperContext.close();

  // The cash sits in the branch treasury; the sale is an online-channel sale.
  const overview = await (await page.request.get('/api/v1/manager/cash/overview')).json();
  expect(
    (overview.branches as { branchId: string; treasury: { balance: { amount: string } } }[]).find(
      (b) => b.branchId === main,
    )!.treasury.balance.amount,
  ).toBe('4.000');
  await page.goto('/manager/sales');
  await page.getByLabel('Channel').selectOption('online');
  await expect(page.getByTestId('sales-summary')).toContainText('1 sales · KWD 4.000');
});

test('delivery areas at checkout, and a pickup order handed over at the till (ADR-0123)', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('st-ful');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Fulfil Co' },
          owner: { fullName: 'Fulfil Owner', email, password: 'Owner-Pass-2026' },
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
      data: { nameEn: 'Honey jar', variants: [{ sku: 'HONEY', price: '3.000', cost: '1.000' }] },
    })
  ).json();
  const variantId = product.variants[0].id as string;
  await page.request.post('/api/v1/manager/inventory/adjustments', {
    data: {
      branchId: main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '6', unitCost: '1.000' }],
    },
  });
  await page.request.put('/api/v1/manager/online/listings', {
    data: { productIds: [product.id], listed: true },
  });
  const slug = `ful-${Date.now().toString(36)}`;
  expect(
    (
      await page.request.put('/api/v1/manager/online/store', {
        data: {
          slug,
          status: 'published',
          nameEn: 'Honey House',
          primaryColor: '#92400e',
          fulfillmentBranchId: main,
          pickupEnabled: true,
          deliveryEnabled: true,
          deliveryFee: '0.500',
          minimumOrder: '0.000',
          reservationMinutes: 30,
          version: 0,
        },
      })
    ).status(),
  ).toBe(200);

  // The owner adds a delivery area from the Kuwait list in the console.
  await page.goto('/online/delivery-areas');
  await page.getByRole('button', { name: 'Add area' }).click();
  const areaDialog = page.getByRole('dialog');
  await areaDialog.getByLabel('Pick from the Kuwait list').selectOption('Salmiya|السالمية');
  await areaDialog.getByLabel('Delivery fee (KWD)').fill('1.000');
  await areaDialog.getByLabel('Free delivery from (KWD)').fill('10.000');
  await areaDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Salmiya', { exact: true })).toBeVisible();
  await expect(page.getByText(/Fee KWD 1.000/)).toBeVisible();

  // A shopper orders delivery to Salmiya: the area's fee applies, then a pickup order.
  const shopperContext = await browser.newContext();
  await shopperContext.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  const shopper = await shopperContext.newPage();
  await shopper.goto(`/store/${slug}`);
  await shopper.getByRole('link', { name: /Honey jar/ }).click();
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.getByRole('link', { name: 'Cart (1)' }).click();
  await shopper.getByRole('button', { name: 'Checkout' }).click();
  await shopper.getByLabel('Full name').fill('Dana');
  await shopper.getByLabel('Phone').fill('+96560003333');
  await shopper.getByRole('radio', { name: 'Delivery' }).click();
  await shopper.getByLabel('Delivery area').selectOption({ index: 1 });
  await shopper.getByLabel('Delivery address').fill('Block 10, Street 5');
  await expect(shopper.getByTestId('checkout-total')).toHaveText('KWD 4.000');
  await shopper.getByRole('button', { name: 'Place order' }).click();
  await expect(shopper.getByTestId('order-status')).toHaveText('Received');
  await expect(shopper.getByText(/Salmiya/)).toBeVisible();

  await shopper.goto(`/store/${slug}`);
  await shopper.getByRole('link', { name: /Honey jar/ }).click();
  await shopper.getByLabel('Quantity').selectOption('2');
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.getByRole('link', { name: 'Cart (2)' }).click();
  await shopper.getByRole('button', { name: 'Checkout' }).click();
  await shopper.getByLabel('Full name').fill('Dana');
  await shopper.getByLabel('Phone').fill('+96560003333');
  await expect(shopper.getByRole('radio', { name: 'Pickup from the store' })).toBeChecked();
  await expect(shopper.getByTestId('checkout-total')).toHaveText('KWD 6.000');
  await shopper.getByRole('button', { name: 'Place order' }).click();
  await expect(shopper.getByTestId('order-status')).toHaveText('Received');
  await expect(shopper.getByTestId('order-branch')).toContainText('Main branch');

  // The owner opens a shift at the till and hands the pickup order over for cash.
  const registers = (
    await (await page.request.get(`/api/v1/manager/registers?branchId=${main}`)).json()
  ).registers as { id: string }[];
  expect(
    (
      await page.request.post('/api/v1/auth/manager/switch-interface', {
        data: { target: 'pos', branchId: main },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.post('/api/v1/pos/shifts', {
        data: { registerId: registers[0]!.id, countedCash: '10.000', expectedCash: '0.000' },
      })
    ).status(),
  ).toBe(201);
  await page.goto('/pos/');
  await page.getByRole('button', { name: 'Online orders' }).click();
  const list = page.getByRole('dialog');
  await expect(list.getByText('W-000002')).toBeVisible();
  await expect(list.getByText('To collect')).toBeVisible();
  await list.getByRole('button', { name: 'Take payment and hand over' }).click();
  const pay = page.getByRole('dialog');
  await pay.getByRole('button', { name: 'Cash' }).click();
  await pay.getByLabel('Cash received (KWD)').fill('10');
  await pay.getByRole('button', { name: 'Add payment' }).click();
  await expect(pay.getByTestId('change')).toHaveText('KWD 4.000');
  await pay.getByRole('button', { name: 'Complete sale' }).click();
  await expect(page.getByTestId('receipt-number').first()).toBeVisible();
  await shopper.getByRole('button', { name: 'Refresh' }).click();
  await expect(shopper.getByTestId('order-status')).toHaveText('Completed');
  await shopperContext.close();

  // The sale is an online-channel sale in the cashier's shift; the stock moved.
  const sales = (await (await page.request.get('/api/v1/manager/sales?channel=online')).json())
    .sales as { channel: string; shiftId: string | null; total: { amount: string } }[];
  expect(sales.map((s) => [s.channel, s.shiftId !== null, s.total.amount])).toEqual([
    ['online', true, '6.000'],
  ]);
  const level = (
    (await (await page.request.get(`/api/v1/manager/inventory/variants/${variantId}`)).json())
      .branches as { branchId: string; onHand: string }[]
  ).find((b) => b.branchId === main)!.onHand;
  expect(level).toBe('4.000');
});
