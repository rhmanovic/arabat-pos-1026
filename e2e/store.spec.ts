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
  await page.getByLabel('Status').selectOption('published');
  // The settings are in tabs; the form keeps what was typed in each.
  await page.getByRole('tab', { name: /Delivery and hours/ }).click();
  await page.getByLabel('Fulfilment branch', { exact: true }).selectOption(main);
  await page.getByLabel('Delivery', { exact: true }).check();
  await page.getByLabel('Delivery fee').fill('0.500');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('tab', { name: /General/ }).click();
  await expect(
    page.getByRole('link', { name: new RegExp(`//${slug}\\.localhost:\\d+$`) }),
  ).toBeVisible();

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
  await expect(page.getByTestId('store-url-preview')).toHaveText(
    new RegExp(`//${slug}\\.localhost:\\d+$`),
  );
  await page.getByLabel('Store name (English)').fill('Date House');
  await page.getByLabel('Status').selectOption('published');
  await page.getByRole('tab', { name: /Delivery and hours/ }).click();
  await page.getByLabel('Fulfilment branch', { exact: true }).selectOption(main);
  await page.getByRole('tab', { name: /Payment/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Allow payment on receipt' })).toBeChecked();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('tab', { name: /General/ }).click();
  await expect(
    page.getByRole('link', { name: new RegExp(`//${slug}\\.localhost:\\d+$`) }),
  ).toBeVisible();

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
  // A shopper's browser may hold the storefront's service worker on the shared host (scope
  // `/store/`) and the old address's 301 to the sub-domain (ADR-0136); the preview frame must
  // still open on the console's origin.
  await page.goto('/store/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.goto(`/store/${slug}`);
  await expect(page).toHaveURL(new RegExp(`//${slug}\\.localhost:\\d+/$`));
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
  // Ready styles (ADR-0128 amendment 6): the categories section as cards with counts.
  await page.getByRole('radio', { name: 'Categories' }).click();
  await page.getByRole('button', { name: 'Edit Categories' }).click();
  await page
    .getByRole('radiogroup', { name: 'Ready styles' })
    .getByRole('radio', { name: 'Cards' })
    .click();
  await expect(preview.getByText('Products: 1')).toBeVisible();
  await page.getByRole('button', { name: /Back to sections/ }).click();
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
  // Without touching the screen, every section that is on the first screen is shown (a section
  // reached by the page settling, not by a scroll, once stayed blank).
  await expect
    .poll(() =>
      shopper.evaluate(() =>
        [...document.querySelectorAll('[data-reveal]')]
          .filter((el) => el.getBoundingClientRect().top < window.innerHeight * 0.9)
          .every((el) => el.getAttribute('data-shown') === 'true'),
      ),
    )
    .toBe(true);
  await expect(shopper.getByRole('main').getByText('Open now')).toBeVisible();
  const menu = shopper.getByRole('region', { name: 'Menu' });
  await expect(menu.getByRole('heading', { name: 'Hot drinks' })).toBeVisible();
  await expect(menu.getByText('With cardamom')).toBeVisible();
  await menu.getByRole('button', { name: 'Add one Karak tea to the cart' }).click();
  await expect(shopper.getByRole('link', { name: 'Cart (1)' })).toBeVisible();
  await shopper.getByRole('link', { name: 'Menu' }).first().click();
  await expect(shopper).toHaveURL(new RegExp(`//${slug}\\.localhost:\\d+/products$`));
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

test('the Excel upload opens the plain file picker first, then checks and applies the file (ADR-0132)', async ({
  page,
}) => {
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Sheet Co' },
          owner: {
            fullName: 'Sheet Owner',
            email: uniqueEmail('sheet'),
            password: 'Owner-Pass-2026',
          },
        },
      })
    ).status(),
  ).toBe(201);
  const template = await (
    await page.request.get('/api/v1/manager/online/transfer/products/template')
  ).body();
  await page.goto('/online/products');
  const bar = page.getByTestId('transfer-products');

  // The button opens the browser's picker straight away, with no type filter and no dialog behind it.
  const chooser = page.waitForEvent('filechooser');
  await bar.getByRole('button', { name: 'Upload in one go' }).click();
  const picker = await chooser;
  expect(await picker.element().getAttribute('accept')).toBeNull();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Anything but an .xlsx file is turned away before it is sent.
  await picker.setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByTestId('toast')).toContainText('Choose an Excel file (.xlsx)');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The empty template is checked in the dialog: nothing to change.
  const again = page.waitForEvent('filechooser');
  await bar.getByRole('button', { name: 'Upload in one go' }).click();
  await (
    await again
  ).setFiles({
    name: 'products-template.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: template,
  });
  const dialog = page.getByRole('dialog', { name: 'Upload products from Excel' });
  await expect(dialog.getByText('products-template.xlsx')).toBeVisible();
  await expect(dialog.getByTestId('transfer-counts')).toBeVisible();
  await expect(dialog.getByText('nothing to change')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('a product discount made in the console shows in the store with its badge and old price (ADR-0133)', async ({
  page,
}) => {
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Rose Co' },
          owner: {
            fullName: 'Rose Owner',
            email: uniqueEmail('discount'),
            password: 'Owner-Pass-2026',
          },
        },
      })
    ).status(),
  ).toBe(201);
  const main = (
    (await (await page.request.get('/api/v1/manager/branches')).json()).branches as {
      id: string;
    }[]
  )[0]!.id;
  await page.request.post('/api/v1/manager/products', {
    data: { nameEn: 'Rose water', trackInventory: false, variants: [{ price: '2.000' }] },
  });
  const slug = `rose-${Date.now().toString(36)}`;
  expect(
    (
      await page.request.put('/api/v1/manager/online/store', {
        data: {
          slug,
          status: 'published',
          nameEn: 'Rose',
          primaryColor: '#be123c',
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

  await page.goto('/online/discounts');
  await page.getByRole('button', { name: 'New discount' }).click();
  const dialog = page.getByRole('dialog', { name: 'New discount' });
  await dialog.getByLabel('Name (English)').fill('Spring sale');
  await dialog.getByRole('button', { name: '25%' }).click();
  await expect(dialog.getByTestId('discount-preview')).toContainText(
    'Lowers the price of 1 product.',
  );
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByTestId('discount').filter({ hasText: 'Spring sale' });
  await expect(card).toContainText('Running');
  await expect(card).toContainText('Lowers 1 product');

  await page.goto(`/store/${slug}/products`);
  const product = page.locator('[data-card]').filter({ hasText: 'Rose water' }).first();
  await expect(product.locator('[data-sale-badge]')).toHaveText('-25%');
  await expect(product.locator('[data-old-price]')).toContainText('2.000');
  await expect(product.locator('[data-sale-price]')).toContainText('1.500');

  // Link previews (ADR-0134): the served page already carries the store's tags. Node does not
  // resolve `*.localhost`, so requests name the store's host in the Host header (ADR-0136).
  const port = new URL(page.url()).port;
  const home = `http://${slug}.localhost:${port}`;
  const onHost = (path: string) =>
    page.request.get(`http://localhost:${port}${path}`, {
      headers: { host: `${slug}.localhost:${port}` },
      maxRedirects: 0,
    });
  const html = await (await onHost('/')).text();
  expect(html).toContain('<title>Rose</title>');
  expect(html).toContain('<meta property="og:title" content="Rose" />');

  // Stores at their own sub-domain (ADR-0136): the old address moves there, the page names
  // its store, the links point there, and the other apps are not served on it.
  const old = await page.request.get(`/store/${slug}/products?category=x`, { maxRedirects: 0 });
  expect(old.status()).toBe(301);
  expect(old.headers()['location']).toBe(`${home}/products?category=x`);
  expect(html).toContain(`<meta name="arabat-store" content="${slug}" />`);
  expect(html).toContain(`<meta property="og:url" content="${home}" />`);
  await expect(page).toHaveURL(`${home}/products`);
  await page.getByRole('link', { name: 'Rose water' }).first().click();
  await expect(page).toHaveURL(new RegExp(`^${home}/products/[0-9a-f-]{36}$`));
  await page.goto(`${home}/manager/`);
  await expect(
    page.getByRole('heading', { name: /Page not found|الصفحة غير موجودة/ }),
  ).toBeVisible();
  // On its own host, `/store/{slug}/…` is the same page at its short address.
  const long = await onHost(`/store/${slug}/cart`);
  expect(long.status()).toBe(301);
  expect(long.headers()['location']).toBe('/cart');

  // The merchant connects a domain bought elsewhere, from the console (ADR-0137).
  const own = `shop-${slug}.arabat-e2e.test`;
  await page.goto('/online/settings?tab=domain');
  await expect(page.getByTestId('address-permanent')).toContainText(/st-[a-z0-9]{6}\.localhost/);
  const code = /st-[a-z0-9]{6}/.exec(
    (await page.getByTestId('address-permanent').textContent())!,
  )![0];
  await page.getByLabel('Your domain').fill(`https://www.${own}/`);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByTestId('domain-status')).toHaveText('Waiting for the record');
  await expect(page.getByTestId('dns-records').first()).toContainText('stores.localhost');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByTestId('domain-status')).toHaveText('Working');
  const domainHome = `http://www.${own}:${port}`;
  await expect(page.getByTestId('address-main')).toContainText(domainHome);
  // Shoppers open the store on the domain; every other address moves there.
  await page.goto(`${domainHome}/products`);
  await expect(page.locator('[data-card]').filter({ hasText: 'Rose water' }).first()).toBeVisible();
  const at = (host: string, path = '/') =>
    page.request.get(`http://localhost:${port}${path}`, {
      headers: { host: `${host}:${port}` },
      maxRedirects: 0,
    });
  const bare = await at(own, '/products?x=1');
  expect(bare.status()).toBe(301);
  expect(bare.headers()['location']).toBe(`${domainHome}/products?x=1`);
  for (const host of [`${slug}.localhost`, `${code}.localhost`]) {
    const r = await at(host, '/cart');
    expect(r.status()).toBe(301);
    expect(r.headers()['location']).toBe(`${domainHome}/cart`);
  }
  const page404 = await at('unknown-shop.arabat-e2e.test');
  expect(page404.status()).toBe(404);
  expect(await page404.text()).toContain('This domain is not connected to a store.');
});
