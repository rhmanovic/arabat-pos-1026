import { expect, test } from '@playwright/test';
import { uniqueEmail } from './helpers.js';

test('a visitor picks a business, skips the devices and lands in a trial account', async ({
  page,
}) => {
  const email = uniqueEmail('trial');
  await page.goto('/');
  await page.locator('#home').getByRole('link', { name: 'أنشئ حساب وجهّز محلك' }).click();
  await expect(page).toHaveURL(/\/start$/);

  await page.getByRole('button', { name: /كافيه/ }).click();
  await expect(page.getByRole('heading', { name: 'اختر أجهزتك' })).toBeVisible();
  await page.getByRole('button', { name: 'تخطَّ، عندي أجهزتي' }).click();

  await expect(page.getByRole('heading', { name: 'خطوة أخيرة وتبدأ تجربتك' })).toBeVisible();
  await page.getByLabel('اسمك').fill('E2E Trial');
  await page.getByLabel('إيميلك').fill(email);
  await page.getByLabel('الرقم السري').fill('Strong-Pass-2026');
  await page.getByRole('button', { name: 'أنشئ حسابي' }).click();

  await expect(
    page.getByRole('heading', { name: /مبروك! تجربتك المجانية \(.+\) بدأت/ }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'ادخل لوحة التحكم' }).click();
  await expect(page).toHaveURL(/\/manager\/?$/);
});
