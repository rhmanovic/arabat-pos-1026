import { type Page, expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

async function onHand(page: Page, branchId: string): Promise<string> {
  const res = await page.request.get(`/api/v1/manager/inventory/levels?branchId=${branchId}&q=PUR`);
  const body = (await res.json()) as { levels: { sku: string; onHand: string }[] };
  return body.levels.find((l) => l.sku === 'PUR-1')?.onHand ?? 'missing';
}

test('supplier → purchase order → approval → two deliveries → transfer with a shortage', async ({
  page,
}) => {
  const email = uniqueEmail('po-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Purchase Co' },
          owner: { fullName: 'Purchase Owner', email, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post('/api/v1/manager/products', {
        data: { nameEn: 'Cardamom', variants: [{ sku: 'PUR-1', price: '2.000', cost: '0.400' }] },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post('/api/v1/manager/branches', {
        data: { code: 'NORTH', nameEn: 'North' },
      })
    ).status(),
  ).toBe(201);
  const branches = (
    (await (await page.request.get('/api/v1/manager/branches')).json()) as {
      branches: { id: string; nameEn: string | null; isMain: boolean }[];
    }
  ).branches;
  const main = branches.find((b) => b.isMain)!;
  const north = branches.find((b) => b.nameEn === 'North')!;

  // Supplier
  await page.goto('/manager/suppliers');
  await page.getByRole('button', { name: 'New supplier' }).click();
  const supplierDialog = page.getByRole('dialog');
  await supplierDialog.getByLabel('Name (English)').fill('Gulf Spices');
  await supplierDialog.getByLabel('Phone').fill('+965 2222 3333');
  await supplierDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: /Gulf Spices/ })).toBeVisible();

  // Purchase order: 10 @ 0.450 = 4.500
  await page.goto('/manager/purchasing/new');
  await page.getByLabel('Supplier', { exact: true }).selectOption({ label: 'Gulf Spices' });
  await page.getByLabel('Receiving branch').selectOption(main.id);
  await page.getByLabel('Search items to add').fill('PUR');
  await page.getByRole('option', { name: /Cardamom/ }).click();
  const line = page.getByTestId('po-line');
  await line.getByLabel('Ordered').fill('10');
  await line.getByLabel('Unit cost').fill('0.450');
  await expect(page.getByTestId('po-total')).toHaveText('KWD 4.500');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Purchase order saved' })).toBeVisible();
  await expect(page).toHaveURL(/\/manager\/purchasing\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: /PO-000001/ })).toBeVisible();

  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  // Nothing reaches stock before approval and receipt.
  expect(await onHand(page, main.id)).toBe('0.000');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  // First delivery: 4
  await page.getByRole('button', { name: 'Receive delivery' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByTestId('receive-line').getByLabel('Receiving now').fill('4');
  await dialog.getByLabel('Supplier invoice / delivery note').fill('INV-1001');
  await dialog.getByRole('button', { name: 'Receive delivery' }).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: 'Delivery received into stock' }),
  ).toBeVisible();
  await expect(page.getByText('Partly received')).toBeVisible();
  await expect(page.getByTestId('po-line')).toContainText('4 / 10');
  expect(await onHand(page, main.id)).toBe('4.000');

  // Second delivery: the remaining 6 (prefilled)
  await page.getByRole('button', { name: 'Receive delivery' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Receiving now')).toHaveValue('6');
  await dialog.getByRole('button', { name: 'Receive delivery' }).click();
  await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('po-line')).toContainText('10 / 10');
  expect(await onHand(page, main.id)).toBe('10.000');
  await expect(page.getByRole('button', { name: 'Receive delivery' })).toHaveCount(0);

  // Transfer 4 from Main to North; 3.5 arrives
  await page.goto('/manager/transfers/new');
  await page.getByLabel('From branch').selectOption(main.id);
  await page.getByLabel('To branch').selectOption(north.id);
  await page.getByLabel('Search items to add').fill('PUR');
  await page.getByRole('option', { name: /Cardamom/ }).click();
  await page.getByTestId('transfer-line').getByLabel('Requested').fill('4');
  await page.getByRole('button', { name: 'Request transfer' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Transfer requested' })).toBeVisible();
  await expect(page).toHaveURL(/\/manager\/transfers\/[0-9a-f-]+$/);

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dispatch' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Dispatched')).toHaveValue('4');
  await dialog.getByRole('button', { name: 'Dispatch' }).click();
  await expect(page.getByText('In transit', { exact: true })).toBeVisible();
  // Stock left Main and is not yet at North.
  expect(await onHand(page, main.id)).toBe('6.000');
  expect(await onHand(page, north.id)).toBe('0.000');

  await page.getByRole('button', { name: 'Receive' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Received').fill('3.5');
  const receive = dialog.getByRole('button', { name: 'Receive' });
  await expect(receive).toBeDisabled();
  await dialog.getByLabel('Explain the missing quantity').fill('One bag torn in the van');
  await receive.click();
  await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('line-missing')).toHaveText('0.5');
  await expect(page.getByText('One bag torn in the van')).toBeVisible();
  expect(await onHand(page, main.id)).toBe('6.000');
  expect(await onHand(page, north.id)).toBe('3.500');
});
