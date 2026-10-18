import { expect, test } from '@playwright/test';
import { uniqueEmail } from './helpers.js';

test('the call to action leads to the pricing page, where the visitor opens a trial account', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#home').getByRole('link', { name: 'أنشئ حساب وجهّز محلك' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { name: 'نظامك الكامل' })).toBeVisible();
  await expect(page.getByText(/✓ تجربة مجانية \d+ يوم بدون بطاقة/).first()).toBeVisible();

  await page.getByRole('button', { name: 'التالي: جهّز محلك' }).first().click();
  await expect(page.getByRole('heading', { name: 'جهّز محلك' })).toBeVisible();
  const skip = page.getByRole('button', { name: 'تخطَّ — عندي أجهزتي' });
  const next = page.getByRole('button', { name: 'التالي: راجع طلبك' }).first();
  await ((await skip.isVisible()) ? skip : next).click();

  await page.getByLabel('اسمك').fill('Tester');
  await page.getByLabel('رقم الهاتف').fill('+965 5555 0000');
  await page.getByLabel('البريد الإلكتروني').fill(uniqueEmail('pricing'));
  await page.getByLabel('الرقم السري لحسابك').fill('Strong-Pass-2026');
  await page.getByRole('button', { name: 'أرسل الطلب' }).click();
  await expect(
    page.getByRole('heading', { name: /مبروك! تجربتك المجانية \d+ يوم بدأت/ }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'ادخل لوحة التحكم' }).click();
  await expect(page).toHaveURL(/\/manager\/?$/);
});
