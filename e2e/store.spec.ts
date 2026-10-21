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
  // Every catalog product is in the store, shown on the website (ADR-0130).
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Saffron tea' })
      .getByRole('checkbox', { name: /Shown on the website/ }),
  ).toBeChecked();
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
  await shopper.getByRole('button', { name: 'Increase quantity' }).click();
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
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Date box' })
      .getByRole('checkbox', { name: /Shown on the website/ }),
  ).toBeChecked();

  // Merchandising (ADR-0121, ADR-0130): a shared category, then a store title and "featured".
  await page.getByRole('link', { name: 'Categories & lists', exact: true }).click();
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByLabel('Name (English)', { exact: true }).fill('Sweets');
  // One save stores the category and closes the dialog.
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('link', { name: 'Products online' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Store title (English)').fill('Date box, 500 g');
  await edit
    .getByLabel('Category (shared with the point of sale)')
    .selectOption({ label: 'Sweets' });
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
  await shopper.getByRole('button', { name: 'Increase quantity' }).click();
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
  // A new product is in the store and shown on the website at once (ADR-0130).
  await page.request.put('/api/v1/manager/online/listings', {
    data: { productIds: [product.id], visible: true },
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
  await shopper.getByRole('button', { name: 'Increase quantity' }).click();
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

test('the owner designs the store as a restaurant, previews it live and publishes it (ADR-0128)', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('design-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Design Co' },
          owner: { fullName: 'Design Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const main = (
    (await (await page.request.get('/api/v1/manager/branches')).json()).branches as {
      id: string;
    }[]
  )[0]!.id;
  const category = await (
    await page.request.post('/api/v1/manager/online/categories', { data: { nameEn: 'Hot drinks' } })
  ).json();
  const product = await (
    await page.request.post('/api/v1/manager/products', {
      data: {
        nameEn: 'Karak tea',
        type: 'service',
        trackInventory: false,
        variants: [{ sku: 'KARAK', price: '0.500' }],
      },
    })
  ).json();
  // A new product is in the store and shown on the website at once (ADR-0130).
  await page.request.put('/api/v1/manager/online/listings', {
    data: { productIds: [product.id], visible: true },
  });
  await page.request.put(`/api/v1/manager/online/listings/${product.id as string}`, {
    data: {
      titleEn: null,
      titleAr: null,
      descriptionEn: 'With cardamom',
      descriptionAr: null,
      featured: true,
      maxPerOrder: null,
      categoryId: category.id,
    },
  });
  const slug = `design-${Date.now().toString(36)}`;
  expect(
    (
      await page.request.put('/api/v1/manager/online/store', {
        data: {
          slug,
          status: 'published',
          nameEn: 'Karak Corner',
          primaryColor: '#9a3412',
          fulfillmentBranchId: main,
          pickupEnabled: true,
          deliveryEnabled: false,
          deliveryFee: '0.000',
          minimumOrder: '0.000',
          reservationMinutes: 30,
          payOnReceiptEnabled: true,
          version: 0,
        },
      })
    ).status(),
  ).toBe(200);

  // The editor shows the store in its preview frame; the restaurant template replaces the layout.
  await page.goto('/online/design');
  const preview = page.frameLocator('iframe[name="arabat-design-preview"]');
  await expect(preview.getByText('Preview: what shoppers will see once you publish')).toBeVisible();
  await page.getByRole('tab', { name: 'Template' }).click();
  const restaurant = page
    .locator('div', { has: page.getByText('Restaurant', { exact: true }) })
    .filter({
      has: page.getByRole('button', { name: 'Apply' }),
    });
  await restaurant.last().getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Yes, replace my design' }).click();
  // The preview follows the unsaved draft at once.
  await expect(preview.getByText('Fresh from our kitchen')).toBeVisible();
  await page.getByRole('tab', { name: 'Pages' }).click();
  await page.getByRole('button', { name: 'Edit Banner' }).click();
  await page.getByLabel('Title (English)', { exact: true }).fill('Karak all day');
  await expect(preview.getByText('Karak all day')).toBeVisible();
  // The product page (ADR-0128 amendment 4): the preview opens the product, and the buy box
  // follows the editor (the restaurant template brought the food page).
  await page.getByRole('button', { name: /Back to sections/ }).click();
  await page.getByRole('radio', { name: 'Product page' }).click();
  await expect(preview.getByRole('heading', { name: 'Karak tea' })).toBeVisible();
  await expect(preview.getByText('Made fresh')).toBeVisible();
  await page.getByText('Buy box', { exact: true }).click();
  await page.getByLabel('Add button (English)').fill('Order it');
  await expect(preview.getByRole('button', { name: 'Order it' })).toBeVisible();
  // The cart (ADR-0128 amendment 5): the preview fills an empty cart with sample products.
  await page.getByRole('radio', { name: 'Cart' }).click();
  await expect(
    preview.getByText('Preview: two sample products stand in for an empty cart.'),
  ).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  // Shoppers still see the old layout until the design is published.
  const shopperContext = await browser.newContext();
  await shopperContext.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  const shopper = await shopperContext.newPage();
  await shopper.goto(`/store/${slug}`);
  await expect(
    shopper.getByTestId('product-grid').getByRole('link', { name: /Karak tea/ }),
  ).toBeVisible();
  await expect(shopper.getByText('Karak all day')).toHaveCount(0);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByTestId('design-status')).toHaveText('Published');

  await shopper.reload();
  await expect(shopper.getByText('Karak all day')).toBeVisible();
  await expect(shopper.getByRole('main').getByText('Open now')).toBeVisible();
  const menu = shopper.getByRole('region', { name: 'Menu' });
  await expect(menu.getByRole('heading', { name: 'Hot drinks' })).toBeVisible();
  await expect(menu.getByText('With cardamom')).toBeVisible();
  await menu.getByRole('button', { name: 'Add one Karak tea to the cart' }).click();
  await expect(shopper.getByRole('link', { name: 'Cart (1)' })).toBeVisible();
  await shopper.getByRole('link', { name: 'Menu' }).first().click();
  await expect(shopper).toHaveURL(new RegExp(`/store/${slug}/products$`));
  await shopper.goto(`/store/${slug}/products/${product.id as string}`);
  await expect(shopper.getByTestId('product-page')).toHaveAttribute('data-layout', 'compact');
  await shopper.getByRole('button', { name: 'Increase quantity' }).click();
  await shopper.getByRole('button', { name: 'Order it' }).click();
  await expect(shopper.getByRole('link', { name: 'Cart (3)' })).toBeVisible();
  // The restaurant's cart and checkout: "Continue", kitchen notes, no email, own order button.
  await shopper.getByRole('link', { name: 'Cart (3)' }).click();
  await shopper.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(shopper.getByLabel('Notes for the kitchen')).toBeVisible();
  await expect(shopper.getByLabel('Email (optional)')).toHaveCount(0);
  await expect(shopper.getByRole('button', { name: 'Send my order' })).toBeVisible();
  await shopperContext.close();
});

test('a shared category is saved with a pasted picture in one step, converted to WebP', async ({
  page,
}) => {
  const email = uniqueEmail('cat-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Picture Co' },
          owner: { fullName: 'Picture Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto('/online/categories');
  await expect(page.getByText('Categories are shared with the point of sale')).toBeVisible();
  await page.getByRole('button', { name: 'Add category' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name (English)', { exact: true }).fill('Dairy & Eggs');
  await dialog.getByLabel('Name (Arabic)', { exact: true }).fill('الألبان والبيض');
  // Paste a screenshot (a real PNG) into the dialog, as Ctrl+V does.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, 120, 80);
    const png = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([png], 'screenshot.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
  });
  await expect(dialog.getByRole('img', { name: 'Category picture' })).toBeVisible();
  // The browser sends WebP; one save creates the category, uploads the picture and closes.
  let sent = '';
  await page.route('**/manager/online/categories/*/image', async (route) => {
    sent = route.request().postDataBuffer()?.toString('latin1') ?? '';
    await route.continue();
  });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(sent).toContain('filename="image.webp"');
  expect(sent).toContain('Content-Type: image/webp');
  const [category] = (await (await page.request.get('/api/v1/manager/online/categories')).json())
    .categories as { nameEn: string; imageUrl: string }[];
  expect(category!.nameEn).toBe('Dairy & Eggs');
  const picture = await page.request.get(category!.imageUrl);
  expect(picture.headers()['content-type']).toBe('image/webp');
  expect((await picture.body()).toString('ascii', 8, 12)).toBe('WEBP');
  await expect(page.getByText('Dairy & Eggs')).toBeVisible();
  // The point of sale has the same category.
  const shared = (await (await page.request.get('/api/v1/manager/categories')).json())
    .categories as { nameEn: string }[];
  expect(shared.map((c) => c.nameEn)).toEqual(['Dairy & Eggs']);
});

test('a product added in the store console is at the point of sale too; each side has its own switch (ADR-0130)', async ({
  page,
}) => {
  const email = uniqueEmail('one-catalog');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Bakery Co' },
          owner: { fullName: 'Bakery Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const main = (
    (await (await page.request.get('/api/v1/manager/branches')).json()).branches as {
      id: string;
    }[]
  )[0]!.id;
  // A category made in Business management, and a product without one.
  await page.request.post('/api/v1/manager/categories', { data: { nameEn: 'Pastries' } });
  await page.request.post('/api/v1/manager/products', {
    data: { nameEn: 'Plain bread', trackInventory: false, variants: [{ price: '0.200' }] },
  });
  const slug = `bake-${Date.now().toString(36)}`;
  expect(
    (
      await page.request.put('/api/v1/manager/online/store', {
        data: {
          slug,
          status: 'published',
          nameEn: 'Bakery',
          primaryColor: '#92400e',
          fulfillmentBranchId: main,
          pickupEnabled: true,
          deliveryEnabled: false,
          deliveryFee: '0.000',
          minimumOrder: '0.000',
          reservationMinutes: 30,
          payOnReceiptEnabled: true,
          version: 0,
        },
      })
    ).status(),
  ).toBe(200);

  // The store console finds the catalog's product (without a category) and adds one itself.
  await page.goto('/online/products');
  await expect(page.getByTestId('uncategorized-warning')).toContainText(
    'Products without a category: 1',
  );
  await page.getByRole('button', { name: 'Add product' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add product' });
  await dialog.getByLabel('Name (English)', { exact: true }).fill('Cheese croissant');
  await dialog.getByLabel('Price (KWD)').fill('0.650');
  await dialog.getByLabel('Category (shared with the point of sale)').selectOption({
    label: 'Pastries',
  });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Cheese croissant')).toBeVisible();
  // Link the bread through the warning.
  await page.getByRole('button', { name: 'Link them to a category' }).click();
  await page.getByRole('checkbox', { name: 'Select Plain bread' }).click();
  await page.getByLabel('Set category…').selectOption({ label: 'Pastries' });
  await expect(page.getByTestId('uncategorized-warning')).toBeHidden();

  // The point of sale has the croissant in Pastries.
  const products = (await (await page.request.get('/api/v1/manager/products?q=Cheese')).json())
    .products as { id: string; categoryId: string | null }[];
  expect(products[0]!.categoryId).not.toBeNull();
  const croissant = products[0]!.id;

  // The website switch lives in the store console: the shopper no longer sees the croissant.
  await page.goto('/online/products');
  const row = page.getByRole('listitem').filter({ hasText: 'Cheese croissant' });
  await row.getByRole('checkbox', { name: /Shown on the website/ }).click();
  await expect(row.getByText('Hidden on the website')).toBeVisible();
  const shopper = await page.context().newPage();
  await shopper.goto(`/store/${slug}/products`);
  await expect(shopper.getByText('Plain bread')).toBeVisible();
  await expect(shopper.getByText('Cheese croissant')).toHaveCount(0);
  await shopper.close();

  // The point-of-sale switch lives in Business management only.
  await page.goto(`/manager/products/${croissant}`);
  await page.getByLabel('Shown at the point of sale').uncheck();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await page.goto('/manager/products');
  await expect(
    page.getByRole('row', { name: /Cheese croissant/ }).getByText('Hidden at the POS'),
  ).toBeVisible();
  await page.goto('/online/products');
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Cheese croissant' })
      .getByText('Hidden at the point of sale'),
  ).toBeVisible();

  // On a phone nothing widens the page: names keep their line and the row buttons wrap below.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/online/products', '/online/categories', '/online/categories?tab=lists']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const width = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(width[0], path).toBeLessThanOrEqual(width[1]);
  }
  await page.goto('/online/products');
  await expect(page.getByText('Cheese croissant', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
