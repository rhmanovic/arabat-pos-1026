import { expect, test } from '@playwright/test';

test('POS sign-in is touch friendly', async ({ page }) => {
  await page.goto('/pos/login');
  const button = page.getByRole('button', { name: 'تسجيل الدخول' });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  // No horizontal scrolling on a tablet viewport.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});
