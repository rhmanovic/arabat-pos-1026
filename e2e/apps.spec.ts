import { expect, test } from '@playwright/test';

test.describe('three separate applications', () => {
  test('root shows the public landing page, which leads to the manager sign-in', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/عربات POS/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.locator('#home').getByRole('link', { name: 'تسجيل الدخول' }).click();
    await expect(page).toHaveURL(/\/manager\/login$/);
    await expect(page.getByRole('heading', { name: 'تسجيل الدخول إلى الإدارة' })).toBeVisible();
  });

  test('each interface serves its own application and sign-in screen', async ({ page }) => {
    const expectations = [
      { path: '/manager/', heading: 'تسجيل الدخول إلى الإدارة', title: 'Arabat Manager' },
      { path: '/pos/', heading: 'دخول الكاشير', title: 'Arabat POS' },
      { path: '/platform/', heading: 'دخول مشغّل المنصة', title: 'Arabat Platform' },
    ];
    const bundles = new Set<string>();
    for (const { path, heading, title } of expectations) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expect(page).toHaveTitle(title);
      const script = await page.locator('script[type="module"]').first().getAttribute('src');
      bundles.add(script ?? '');
    }
    // Separate builds: no interface loads another interface's application bundle.
    expect(bundles.size).toBe(3);
  });

  test('protected deep links redirect to the sign-in page of the same interface', async ({
    page,
  }) => {
    await page.goto('/pos/some/deep/link');
    await expect(page).toHaveURL(/\/pos\/login$/);
    await page.goto('/platform/merchants');
    await expect(page).toHaveURL(/\/platform\/login$/);
  });

  test('the frontend reaches the backend and the database', async ({ page }) => {
    await page.goto('/manager/login');
    const status = page.getByTestId('api-status');
    await expect(status).toHaveAttribute('data-status', 'success');
    await expect(status).toHaveText('الخادم متصل');
  });

  test('Arabic is RTL and switching to English flips to LTR and persists', async ({ page }) => {
    await page.goto('/manager/login');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByRole('radio', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Sign in to management' })).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('API default deny', () => {
  for (const iface of ['manager', 'pos', 'platform']) {
    test(`${iface} session endpoint rejects anonymous requests`, async ({ request }) => {
      const res = await request.get(`/api/v1/auth/${iface}/me`);
      expect(res.status()).toBe(401);
      expect(res.headers()['content-type']).toContain('application/problem+json');
      expect((await res.json()).code).toBe('UNAUTHENTICATED');
    });
  }
});

test('applications load without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // The anonymous session check answers 401 by design; Chrome logs it as a failed resource.
    if (message.type() === 'error' && !message.text().includes('401')) errors.push(message.text());
  });
  for (const path of ['/manager/login', '/pos/login', '/platform/login']) {
    await page.goto(path);
    await expect(page.getByTestId('api-status')).toHaveAttribute('data-status', 'success');
  }
  expect(errors).toEqual([]);
});
