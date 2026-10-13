import { expect, test } from '@playwright/test';
import { latestMailText, signIn, uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('cashier refunds and exchanges at the POS; a large refund waits for manager approval', async ({
  page,
  browser,
}) => {
  const ownerEmail = uniqueEmail('rf-owner');
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Returns Co' },
          owner: { fullName: 'Returns Owner', email: ownerEmail, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const main = (await (await page.request.get('/api/v1/manager/branches')).json()).branches[0].id;
  const mk = async (nameEn: string, price: string, barcode: string) =>
    (
      await (
        await page.request.post('/api/v1/manager/products', {
          data: { nameEn, variants: [{ price, barcodes: [barcode] }] },
        })
      ).json()
    ).variants[0].id as string;
  const lamp = await mk('Desk lamp', '10.000', '6281000000031');
  const bulb = await mk('Spare bulb', '1.500', '6281000000048');
  await page.request.post('/api/v1/manager/inventory/adjustments', {
    data: {
      branchId: main,
      kind: 'opening',
      reason: 'opening',
      lines: [
        { variantId: lamp, quantity: '20' },
        { variantId: bulb, quantity: '20' },
      ],
    },
  });
  const roles = (await (await page.request.get('/api/v1/manager/roles')).json()).roles as {
    id: string;
    templateKey: string;
  }[];
  const cashierEmail = uniqueEmail('rf-cashier');
  await page.request.post('/api/v1/manager/employees/invitations', {
    data: {
      email: cashierEmail,
      fullName: 'Rana Cashier',
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
  await pos.getByLabel('Counted cash (KWD)').fill('50');
  await pos.getByRole('button', { name: 'Open shift' }).click();
  await expect(pos.getByTestId('shift-strip')).toBeVisible();

  // Two sales through the API with the cashier's session.
  const methods = (await (await pos.request.get('/api/v1/pos/payment-methods')).json()).methods as {
    id: string;
    kind: string;
  }[];
  const cash = methods.find((m) => m.kind === 'cash')!.id;
  const sell = async (quantity: string, amount: string) =>
    (
      await (
        await pos.request.post('/api/v1/pos/sales', {
          data: {
            idempotencyKey: crypto.randomUUID(),
            lines: [{ variantId: lamp, quantity }],
            payments: [{ methodId: cash, amount }],
            expectedTotal: amount,
          },
        })
      ).json()
    ).receiptNumber as string;
  const first = await sell('3', '30.000');

  // 1. Partial refund of one lamp, within the cashier's limit.
  await pos.getByRole('link', { name: 'Returns' }).click();
  await pos.getByLabel('Receipt number').fill(first);
  await pos.getByRole('button', { name: 'Find' }).click();
  await pos.getByLabel('Return Desk lamp').fill('1');
  await expect(pos.getByTestId('refund-total')).toHaveText('KWD 10.000');
  await pos.getByRole('button', { name: 'Confirm refund' }).click();
  await expect(pos.getByTestId('refund-number').first()).toHaveText(`${first}-R1`);
  await expect(pos.getByTestId('refund-receipt-total').first()).toHaveText('KWD 10.000');
  await pos.getByRole('button', { name: 'Done' }).click();
  // The sale is reloaded after the refund; typing before that reload lands is wiped by it.
  await expect(pos.getByText('Already refunded: KWD 10.000')).toBeVisible();

  // 2. Exchange: return one lamp (10.000 credit) for 8 bulbs (12.000): customer pays 2.000.
  await pos.getByLabel('Return Desk lamp').fill('1');
  await pos.getByRole('button', { name: 'Exchange' }).click();
  await pos.getByLabel('Search or scan barcode').fill('6281000000048');
  await pos.getByLabel('Search or scan barcode').press('Enter');
  await pos.getByLabel('Quantity').fill('8');
  await expect(pos.getByTestId('exchange-difference')).toHaveText('KWD 2.000');
  await pos.getByLabel('Pay the difference with').selectOption({ label: 'Cash' });
  await pos.getByRole('button', { name: 'Complete exchange' }).click();
  await expect(pos.getByTestId('refund-number').first()).toHaveText(`${first}-R2`);
  await pos.getByRole('button', { name: 'Done' }).click();
  await expect(pos.getByTestId('receipt-total').first()).toHaveText('KWD 12.000');
  await pos.getByRole('button', { name: 'New sale' }).click();

  // 3. A 25.000 refund is above the 20.000 limit: it waits for approval.
  const second = await sell('3', '30.000');
  await pos.goto('/pos/returns');
  await pos.getByLabel('Receipt number').fill(second);
  await pos.getByRole('button', { name: 'Find' }).click();
  await pos.getByLabel('Return Desk lamp').fill('2.5');
  await expect(pos.getByText('A supervisor must approve this refund.')).toBeVisible();
  await pos.getByRole('button', { name: 'Confirm refund' }).click();
  await expect(pos.getByText(`Refund ${second}-R1 is waiting for approval.`).first()).toBeVisible();

  // 4. The manager approves it in /manager.
  await page.goto('/manager/refunds');
  await page.getByRole('button', { name: 'Waiting for approval' }).click();
  await page.getByRole('row', { name: new RegExp(`${second}-R1`) }).click();
  await expect(page.getByRole('dialog')).toContainText('Above the approval limit');
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Refund approved' })).toBeVisible();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`${second}-R1`) })).toContainText(
    'Completed',
  );

  // Stock and drawer reconcile: 20 − 3 + 1 (refund) − 3 + 2.5 (approved) = 17.5 lamps; exchange returned 1 more.
  const lampStock = (
    await (await page.request.get(`/api/v1/manager/inventory/variants/${lamp}`)).json()
  ).branches[0].onHand;
  expect(lampStock).toBe('18.500');
  // 50 + 30 + 2 (exchange) + 30 − 10 − 25 = 77 — visible to the manager, blind for the cashier.
  await pos.goto('/pos/shift');
  await expect(pos.getByTestId('blind-count')).toBeVisible();
  const openShifts = await (await page.request.get('/api/v1/manager/shifts?status=open')).json();
  expect(openShifts.shifts[0].summary.expectedCash.amount).toBe('77.000');
  await ctx.close();
});
