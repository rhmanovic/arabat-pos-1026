import { expect, test } from '@playwright/test';
import { uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('the owner builds a link page in the manager and a visitor opens it (ADR-0116)', async ({
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
  await page.goto('/manager/online');
  await page.getByRole('button', { name: 'Link page' }).click();

  // Two links; the address is completed from what people usually type.
  await page.getByRole('button', { name: 'Add link' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type').selectOption('instagram');
  await dialog.getByLabel('Address').fill('@linksco');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('https://instagram.com/linksco')).toBeVisible();
  await page.getByRole('button', { name: 'Add link' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Type').selectOption('whatsapp');
  await dialog.getByLabel('Address').fill('+965 5000 0001');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('https://wa.me/96550000001')).toBeVisible();
  // WhatsApp first.
  await page.getByRole('button', { name: 'Move WhatsApp up' }).click();
  await expect(page.getByRole('button', { name: 'Move WhatsApp up' })).toBeDisabled();

  await page.getByLabel('Address (letters, digits and dashes)').fill(slug);
  await page.getByLabel('Title (English)').fill('Links Co');
  await page.getByLabel('Description (English)').fill('Coffee & sweets');
  await page.getByLabel('Page status').selectOption('published');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('link', { name: new RegExp(`/store/links/${slug}$`) })).toBeVisible();

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
  // Count an open without leaving to the external site.
  const counted = visitor.waitForRequest(
    (r) => r.url().includes('/click') && r.method() === 'POST',
  );
  await links.nth(1).evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
  await links.nth(1).click();
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
