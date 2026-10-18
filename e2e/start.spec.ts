import { expect, test } from '@playwright/test';
import { latestMailText, uniqueEmail } from './helpers.js';

test('a visitor tries the till, sets up the shop, confirms the e-mail and lands in a trial account', async ({
  page,
}) => {
  const email = uniqueEmail('trial');
  await page.goto('/');
  await page.locator('#home').getByRole('link', { name: 'أنشئ حساب وجهّز محلك' }).click();
  await expect(page).toHaveURL(/\/start$/);

  await page.getByRole('button', { name: /كافيه/ }).click();
  await page.getByRole('button', { name: /^قهوة عربية/ }).click();
  await page.getByRole('button', { name: 'ادفع' }).click();
  await page.getByPlaceholder('إيميلك').fill(email);
  await page.getByRole('button', { name: 'أرسل' }).click();
  await expect(page.getByText(`أرسلنا الإيصال إلى ${email}`)).toBeVisible();
  await page.getByRole('button', { name: 'التالي' }).click();

  await page.getByRole('button', { name: /عندي أجهزتي/ }).click();
  await page.getByRole('button', { name: 'التالي' }).click();

  await expect(page.getByRole('heading', { name: 'خطوة أخيرة وتبدأ تجربتك' })).toBeVisible();
  await expect(page.getByLabel('إيميلك')).toHaveValue(email);
  await page.getByLabel('اسمك').fill('E2E Trial');
  await page.getByLabel('الرقم السري').fill('Strong-Pass-2026');
  await page.getByRole('button', { name: 'أنشئ حسابي' }).click();

  await expect(page.getByRole('heading', { name: 'تأكد من إيميلك' })).toBeVisible();
  let code = '';
  await expect
    .poll(async () => {
      code = /\b(\d{6})\b/.exec(await latestMailText(email).catch(() => ''))?.[1] ?? '';
      return code;
    })
    .toMatch(/^\d{6}$/);
  await page.getByLabel('الرمز').fill(code);
  await page.getByRole('button', { name: 'تأكيد' }).click();
  await expect(
    page.getByRole('heading', { name: /مبروك! تجربتك المجانية \d+ يوم بدأت/ }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'ادخل لوحة التحكم' }).click();
  await expect(page).toHaveURL(/\/manager\/?$/);
});
