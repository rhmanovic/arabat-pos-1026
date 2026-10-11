import { expect, test } from '@playwright/test';
import {
  DEV,
  DEV_PASSWORD,
  latestMailText,
  signIn,
  totp,
  uniqueEmail,
  useEnglish,
} from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('a company owner registers, lands in /manager, signs out and signs in again', async ({
  page,
}) => {
  const email = uniqueEmail('owner');
  const password = 'Owner-Pass-2026';
  await page.goto('/manager/register');
  await page.getByLabel('Company name').fill('E2E Trading');
  await page.getByLabel('Full name').fill('E2E Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/manager\/?$/);
  await expect(page.getByTestId('merchant-name')).toHaveText('E2E Trading');
  await expect(page.getByTestId('user-name')).toHaveText('E2E Owner');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/manager\/login$/);
  // The server session is gone, not just the UI state.
  expect((await page.request.get('/api/v1/auth/manager/me')).status()).toBe(401);

  await signIn(page, 'manager', email, password);
  await expect(page.getByTestId('merchant-name')).toHaveText('E2E Trading');
});

test('wrong credentials show a neutral error', async ({ page }) => {
  await signIn(page, 'manager', DEV.owner, 'Not-The-Password-1');
  await expect(page.getByText('The e-mail or password is incorrect.')).toBeVisible();
});

test('password recovery through the e-mailed link', async ({ page }) => {
  const email = uniqueEmail('reset');
  const res = await page.request.post('/api/v1/auth/register', {
    data: {
      company: { nameEn: 'Reset Co' },
      owner: { fullName: 'Reset Owner', email, password: 'Initial-Pass-2026' },
    },
  });
  expect(res.status()).toBe(201);

  await page.goto('/manager/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('If an account exists for this e-mail')).toBeVisible();

  const text = await latestMailText(email);
  const link = /https?:\/\/\S+reset-password\?token=[\w-]+/.exec(text)![0];
  await page.goto(link);
  await page.getByLabel('New password').fill('Changed-Pass-2026');
  await page.getByLabel('Confirm password').fill('Changed-Pass-2026');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Your password was changed.')).toBeVisible();

  await signIn(page, 'manager', email, 'Changed-Pass-2026');
  await expect(page.getByTestId('merchant-name')).toHaveText('Reset Co');
});

test('a cashier is directed to the POS and works in an explicit merchant and branch', async ({
  page,
}) => {
  await signIn(page, 'manager', DEV.cashier);
  await expect(page.getByText('Your account is set up for another application.')).toBeVisible();
  await page.getByRole('link', { name: 'Open Point of Sale' }).click();

  await expect(page).toHaveURL(/\/pos\/login$/);
  await signIn(page, 'pos', DEV.cashier);
  // The demo cashier works in two companies: choose one.
  await page.getByRole('button', { name: 'Demo Store' }).click();
  await expect(page.getByTestId('pos-context')).toContainText('Demo Store');
  await expect(page.getByTestId('pos-context')).toContainText('Main branch');
  // No route into management for a cashier.
  await expect(page.getByRole('button', { name: 'Manager' })).toHaveCount(0);
  expect((await page.request.get('/api/v1/manager/merchant')).status()).toBe(401);
});

test('an owner can switch from /manager to the POS only through the server', async ({ page }) => {
  await signIn(page, 'manager', DEV.owner);
  await expect(page.getByTestId('merchant-name')).toHaveText('Demo Store');
  await page.getByRole('button', { name: 'Switch to Point of Sale' }).click();
  // Demo Store has two branches, so the owner picks the POS branch.
  await page.getByRole('button', { name: 'Salmiya branch' }).click();
  await expect(page).toHaveURL(/\/pos\/$/);
  await expect(page.getByTestId('pos-context')).toContainText('Salmiya branch');
});

test('a manager without POS permission is not offered the POS', async ({ page }) => {
  await signIn(page, 'manager', DEV.manager);
  await expect(page.getByTestId('merchant-name')).toHaveText('Demo Store');
  await expect(page.getByRole('button', { name: 'Switch to Point of Sale' })).toHaveCount(0);
  const res = await page.request.post('/api/v1/auth/manager/switch-interface', {
    data: { target: 'pos' },
  });
  expect(res.status()).toBe(403);
});

test('platform operators sign in with password and TOTP; merchants cannot', async ({ page }) => {
  await page.goto('/platform/login');
  await page.getByLabel('Email').fill(DEV.owner);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('The e-mail or password is incorrect.')).toBeVisible();

  await page.getByLabel('Email').fill(DEV.operator);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-factor verification' })).toBeVisible();
  // A code can be used only once; if this step was already used in a previous run, use the next one.
  const nav = page.getByRole('navigation', { name: 'Platform navigation' });
  for (const offset of [0, 1]) {
    await page.getByLabel('Verification code').fill(totp(DEV.totpSecret, offset));
    await page.getByRole('button', { name: 'Verify' }).click();
    const outcome = await Promise.race([
      nav.waitFor().then(() => 'ok'),
      page
        .getByText('The verification code is incorrect.')
        .waitFor()
        .then(() => 'retry'),
    ]);
    if (outcome === 'ok') break;
  }
  await expect(page.getByRole('navigation', { name: 'Platform navigation' })).toBeVisible();
  expect((await page.request.get('/api/v1/manager/merchant')).status()).toBe(401);
});
