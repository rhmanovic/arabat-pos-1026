import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { totp, uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

/** A fresh operator from the CLI (the only way operators are created). */
function createOperator(role: string) {
  const email = uniqueEmail('e2e-op');
  const out = execFileSync(
    'pnpm',
    [
      '--silent',
      '--filter',
      '@arabat/api',
      'run',
      'platform:create-operator',
      '--',
      '--email',
      email,
      '--name',
      'E2E Operator',
      '--role',
      role,
    ],
    { encoding: 'utf8' },
  );
  return {
    email,
    password: /password:\s+(\S+)/.exec(out)![1]!,
    secret: /TOTP secret:\s+(\S+)/.exec(out)![1]!,
  };
}

test('operators manage plans and status; limits and suspension reach the merchant', async ({
  page,
  browser,
}) => {
  // A merchant registers (its owner stays signed in through page.request).
  const ownerEmail = uniqueEmail('pl-owner');
  const company = `Platform Co ${Date.now().toString(36)}`;
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: company },
          owner: { fullName: 'Plan Owner', email: ownerEmail, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  // Merchant sessions never reach the platform API.
  expect((await page.request.get('/api/v1/platform/merchants')).status()).toBe(401);

  // An operator signs in (password + TOTP) in a separate browser context.
  const op = createOperator('platform.super_admin');
  const opContext = await browser.newContext();
  await opContext.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  const opPage = await opContext.newPage();
  await opPage.goto('/platform/login');
  await opPage.getByLabel('Email').fill(op.email);
  await opPage.getByLabel('Password').fill(op.password);
  await opPage.getByRole('button', { name: 'Sign in' }).click();
  await opPage.getByLabel('Verification code').fill(totp(op.secret));
  await opPage.getByRole('button', { name: 'Verify' }).click();
  await expect(opPage.getByRole('navigation', { name: 'Platform navigation' })).toBeVisible();
  await expect(opPage.getByRole('heading', { name: 'Overview' })).toBeVisible();

  // Find the merchant and move it to the Basic plan (usage fits).
  await opPage.getByRole('link', { name: 'Merchants' }).click();
  await opPage.getByLabel('Name, e-mail or id').fill(company);
  await opPage.getByText(company).click();
  await expect(opPage.getByTestId('usage-branches')).toHaveText(/1 \/ unlimited/);
  await opPage.getByRole('button', { name: 'Change plan or status' }).click();
  const subDialog = opPage.getByRole('dialog');
  await subDialog.getByLabel('Plan').selectOption({ label: 'Basic' });
  await expect(subDialog.getByTestId('plan-check')).toContainText('Current usage fits this plan.');
  await subDialog.getByLabel('Status').selectOption('active');
  await subDialog.getByLabel('Reason (recorded)').fill('Signed the basic offer');
  await subDialog.getByRole('button', { name: 'Save subscription' }).click();
  await expect(opPage.getByTestId('subscription-status')).toHaveText('Active');
  await expect(opPage.getByTestId('usage-branches')).toHaveText(/1 \/ 1/);

  // The plan limit is enforced for the merchant and shown on its subscription page.
  const branch = await page.request.post('/api/v1/manager/branches', {
    data: { code: 'B2', nameEn: 'Second' },
  });
  expect(branch.status()).toBe(409);
  expect((await branch.json()).code).toBe('PLAN_LIMIT_REACHED');
  await page.goto('/manager/subscription');
  await expect(page.getByRole('heading', { name: 'Subscription' })).toBeVisible();
  await expect(page.getByTestId('usage-branches')).toHaveText(/1 \/ 1/);
  await expect(page.getByText('Restaurant — not included')).toBeVisible();

  // Suspension signs the merchant out everywhere and blocks sign-in.
  await opPage.getByRole('button', { name: 'Suspend' }).click();
  const statusDialog = opPage.getByRole('dialog');
  await statusDialog.getByLabel('Reason (recorded in the audit log)').fill('Compliance review');
  await statusDialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(opPage.getByTestId('merchant-status')).toHaveText('Suspended');
  expect((await page.request.get('/api/v1/manager/merchant')).status()).toBe(401);
  await page.goto('/manager/login');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password', { exact: true }).fill('Owner-Pass-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(
    page.getByText('This company account is suspended. Contact the platform support.'),
  ).toBeVisible();

  const detailUrl = opPage.url();
  // The platform audit log records who did it and why.
  await opPage.getByRole('link', { name: 'Audit log' }).click();
  await opPage.getByLabel('Action contains').fill('merchant.suspended');
  await expect(opPage.getByRole('cell', { name: 'Compliance review' }).first()).toBeVisible();

  // Reactivation restores access.
  await opPage.goto(detailUrl);
  await opPage.getByRole('button', { name: 'Reactivate' }).click();
  await opPage
    .getByRole('dialog')
    .getByLabel('Reason (recorded in the audit log)')
    .fill('Review passed');
  await opPage.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(opPage.getByTestId('merchant-status')).toHaveText('Active');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/manager\/?$/);
  await opContext.close();
});
