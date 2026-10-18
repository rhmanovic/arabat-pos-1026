import { expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('the owner builds a link page in its own interface and a visitor opens it (ADR-0116)', async ({
  page,
  browser,
}) => {
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Links Co' },
          owner: {
            fullName: 'Links Owner',
            email: uniqueEmail('ln-owner'),
            password: 'Owner-Pass-2026',
          },
        },
      })
    ).status(),
  ).toBe(201);

  const slug = `e2e-links-${Date.now().toString(36)}`;
  // The manager menu opens the link page's own interface, signed in with the same account.
  await page.goto('/manager/');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: /Link page/ })
    .click();
  await expect(page).toHaveURL(/\/links\/$/);
  await expect(page.getByRole('heading', { name: 'Link page', level: 1 })).toBeVisible();

  // Two links; the address is completed from what people usually type.
  await page.getByRole('button', { name: 'Add link' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type').selectOption('instagram');
  await dialog.getByLabel('Address').fill('@linksco');
  await dialog.getByRole('button', { name: '📸' }).click();
  await dialog.getByLabel('Effect').selectOption('pulse');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('https://instagram.com/linksco')).toBeVisible();
  await page.getByRole('button', { name: 'Add link' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type').selectOption('whatsapp');
  await dialog.getByLabel('Address').fill('+965 5000 0001');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('https://wa.me/96550000001')).toBeVisible();
  // WhatsApp first, by dragging its card above Instagram.
  const from = await page.getByRole('button', { name: 'Drag WhatsApp' }).boundingBox();
  const to = await page.getByRole('button', { name: 'Drag Instagram' }).boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + 4, { steps: 12 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y - 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Move WhatsApp up' })).toBeDisabled();

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Address (letters, digits and dashes)').fill(slug);
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByLabel('Title (English)').fill('Links Co');
  await page.getByLabel('Description (English)').fill('Coffee & sweets');
  // A ready-made theme (gradient, Cairo font) and a motion.
  await page.getByRole('button', { name: 'Sunset' }).click();
  await page.getByRole('button', { name: 'Pop' }).click();
  // The header switch publishes and saves the design in one go.
  await page.getByRole('switch', { name: 'Page published' }).click();
  await expect(page.getByRole('switch', { name: 'Page published' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByText(`/store/links/${slug}`)).toBeVisible();
  // The live preview follows the saved page.
  await expect(
    page.getByRole('complementary', { name: 'Preview' }).getByRole('heading', { name: 'Links Co' }),
  ).toBeVisible();

  // An anonymous visitor (no session) sees the page and opens a link.
  const visitorContext = await browser.newContext();
  await visitorContext.addInitScript(() => localStorage.setItem('arabat.language', 'en'));
  const visitor = await visitorContext.newPage();
  await visitor.goto(`/store/links/${slug}`);
  await expect(visitor.getByRole('heading', { name: 'Links Co' })).toBeVisible();
  await expect(visitor.getByText('Coffee & sweets')).toBeVisible();
  const links = visitor.getByRole('listitem').getByRole('link');
  await expect(links).toHaveCount(2);
  await expect(links.first()).toHaveAttribute('href', 'https://wa.me/96550000001');
  await expect(links.nth(1)).toHaveAttribute('href', 'https://instagram.com/linksco');
  await expect(links.nth(1)).toContainText('📸');
  await expect(links.nth(1)).toHaveClass(/lp-fx-pulse/);
  await expect(visitor.locator('[data-font="cairo"]')).toBeVisible();
  // Count an open without leaving to the external site.
  const counted = visitor.waitForRequest(
    (r) => r.url().includes('/click') && r.method() === 'POST',
  );
  await links.nth(1).evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
  // The pulse effect never stops moving, so Playwright must not wait for it to settle.
  await links.nth(1).click({ force: true });
  await counted;
  await visitorContext.close();

  await expect
    .poll(async () => {
      const p = await (await page.request.get('/api/v1/manager/link-page')).json();
      return (p.items as { kind: string; clicks: number }[]).find((i) => i.kind === 'instagram')
        ?.clicks;
    })
    .toBe(1);
});

test('the link page asks for the management account and signs in with it', async ({ page }) => {
  const email = uniqueEmail('ln-login');
  await page.request.post('/api/v1/auth/register', {
    data: {
      company: { nameEn: 'Login Links Co' },
      owner: { fullName: 'Owner', email, password: 'Owner-Pass-2026' },
    },
  });
  await page.request.post('/api/v1/auth/logout', { data: { interface: 'manager' } });
  await page.context().clearCookies();
  await page.goto('/links/');
  await expect(page).toHaveURL(/\/links\/login$/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Owner-Pass-2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Link page', level: 1 })).toBeVisible();
  await expect(page.getByTestId('merchant-name')).toHaveText('Login Links Co');
  // Same session as the management app.
  await page.goto('/manager/');
  await expect(page.getByTestId('merchant-name')).toHaveText('Login Links Co');
});
