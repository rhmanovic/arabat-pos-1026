import { expect, test } from '@playwright/test';

test('a visitor reads the yearly price, goes through the steps and sends a purchase request', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'شاهد الأسعار وجهّز محلك' }).click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { name: 'نظامك الكامل' })).toBeVisible();

  await page.getByRole('button', { name: 'التالي: جهّز محلك' }).first().click();
  await expect(page.getByRole('heading', { name: 'جهّز محلك' })).toBeVisible();
  const skip = page.getByRole('button', { name: 'تخطَّ — عندي أجهزتي' });
  const next = page.getByRole('button', { name: 'التالي: راجع طلبك' }).first();
  await ((await skip.isVisible()) ? skip : next).click();

  await page.getByLabel('اسم الشركة أو المحل').fill('E2E Coffee');
  await page.getByLabel('اسمك').fill('Tester');
  await page.getByLabel('رقم الهاتف').fill('+965 5555 0000');
  await page.getByLabel('البريد الإلكتروني').fill('e2e.pricing@test.arabat');
  await page.getByRole('button', { name: 'أرسل الطلب' }).click();
  await expect(page.getByRole('heading', { name: 'وصلنا طلبك!' })).toBeVisible();
  await expect(page.getByText(/Q-\d{6}/)).toBeVisible();
});
