import { type Page, expect, test } from '@playwright/test';
import { DEV, latestMailText, signIn, uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

async function registerOwner(page: Page) {
  const email = uniqueEmail('mgr-owner');
  const res = await page.request.post('/api/v1/auth/register', {
    data: {
      company: { nameEn: 'UI Co' },
      owner: { fullName: 'UI Owner', email, password: 'Owner-Pass-2026' },
    },
  });
  expect(res.status()).toBe(201);
  await page.goto('/manager/');
  await expect(page.getByTestId('merchant-name')).toHaveText('UI Co');
  return email;
}

test('owner manages branches, employees and roles through the UI', async ({ page, browser }) => {
  await registerOwner(page);

  // Company profile
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Legal name').fill('UI Co W.L.L.');
  await page.getByLabel('Contact phone').fill('+965 2200 0000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Changes saved' })).toBeVisible();

  // Branch creation
  await page.getByRole('link', { name: 'Branches' }).click();
  await page.getByRole('button', { name: 'Add branch' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Code').fill('jahra');
  await dialog.getByLabel('Name (English)').fill('Jahra');
  await dialog.getByLabel('Name (Arabic)').fill('الجهراء');
  await dialog.getByLabel('Receipt footer').fill('Thank you');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'JAHRA', exact: true })).toBeVisible();

  // Custom role
  await page.getByRole('link', { name: 'Roles & permissions' }).click();
  await page.getByRole('button', { name: 'New role' }).click();
  const roleDialog = page.getByRole('dialog');
  await roleDialog.getByLabel('Name (English)').fill('Stock clerk');
  await roleDialog.locator('[data-permission="inventory.read"]').check();
  await roleDialog.locator('[data-permission="inventory.adjust"]').check();
  await roleDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Stock clerk')).toBeVisible();

  // Invite a cashier at Jahra
  await page.getByRole('link', { name: 'Employees' }).click();
  await page.getByRole('button', { name: 'Invite employee' }).click();
  const invite = page.getByRole('dialog');
  const cashierEmail = uniqueEmail('ui-cashier');
  await invite.getByLabel('Full name').fill('Huda Cashier');
  await invite.getByLabel('E-mail').fill(cashierEmail);
  const row = invite.getByTestId('assignment-row').first();
  await row.getByLabel('Role').selectOption({ label: 'Cashier' });
  await row.getByLabel('Branch').selectOption({ label: 'Jahra' });
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(
    page.getByTestId('toast').filter({ hasText: `Invitation sent to ${cashierEmail}` }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /Pending invitations/ }).click();
  await expect(page.getByText('Huda Cashier')).toBeVisible();

  // The cashier accepts in a separate browser session and signs in to the POS at Jahra.
  const link = /https?:\/\/\S+accept-invite\?token=[\w-]+/.exec(
    await latestMailText(cashierEmail),
  )![0];
  const cashierContext = await browser.newContext();
  const cashier = await cashierContext.newPage();
  await cashier.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  await cashier.goto(link);
  await cashier.getByLabel('New password').fill('Cashier-Pass-2026');
  await cashier.getByLabel('Confirm password').fill('Cashier-Pass-2026');
  await cashier.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(cashier.getByText('Your account is ready.')).toBeVisible();
  await signIn(cashier, 'pos', cashierEmail, 'Cashier-Pass-2026');
  await expect(cashier.getByTestId('pos-context')).toContainText('Jahra');
  // The cashier has no management access, also not through the API.
  expect((await cashier.request.get('/api/v1/manager/employees')).status()).toBe(401);
  await cashierContext.close();

  // Owner promotes the cashier: add the Stock clerk role at Jahra.
  await page.reload();
  await page.getByRole('tab', { name: 'Employees' }).click();
  await page.getByRole('cell', { name: /Huda Cashier/ }).click();
  await page.getByRole('button', { name: 'Add role' }).click();
  const rows = page.getByTestId('assignment-row');
  await rows.nth(1).getByLabel('Role').selectOption({ label: 'Stock clerk' });
  await rows.nth(1).getByLabel('Branch').selectOption({ label: 'Jahra' });
  await page.getByRole('button', { name: 'Save roles' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Roles updated' })).toBeVisible();
  await expect(page.getByText('Cashier · Jahra, Stock clerk · Jahra')).toBeVisible();

  // Deactivate with confirmation
  await page.getByRole('button', { name: 'Deactivate' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText('Inactive', { exact: true })).toBeVisible();
});

test('a company manager without POS rights cannot grant POS roles', async ({ page }) => {
  await signIn(page, 'manager', DEV.manager);
  await page.getByRole('link', { name: 'Employees' }).click();
  await page.getByRole('button', { name: 'Invite employee' }).click();
  const invite = page.getByRole('dialog');
  await invite.getByLabel('Full name').fill('Nope');
  await invite.getByLabel('E-mail').fill(uniqueEmail('nope'));
  await invite
    .getByTestId('assignment-row')
    .first()
    .getByLabel('Role')
    .selectOption({ label: 'Cashier' });
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(
    page
      .getByTestId('toast')
      .filter({ hasText: 'You cannot grant permissions beyond your own authority.' }),
  ).toBeVisible();
});

test('manager layout works on a phone-sized screen with the drawer menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'manager', DEV.owner);
  await expect(page.getByRole('navigation', { name: 'Manager navigation' })).not.toBeInViewport();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Branches' }).click();
  await expect(page.getByRole('heading', { name: 'Branches' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
