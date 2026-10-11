import { expect, test } from '@playwright/test';
import { latestMailText, signIn, uniqueEmail, useEnglish } from './helpers';

test.beforeEach(async ({ page }) => useEnglish(page));

test('an invited cashier sets their own password and works only in the POS', async ({
  page,
  request,
}) => {
  // Owner registers (API) and invites a cashier at the main branch.
  const ownerEmail = uniqueEmail('owner');
  expect(
    (
      await request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Invite Co' },
          owner: { fullName: 'Owner', email: ownerEmail, password: 'Owner-Pass-2026' },
        },
      })
    ).status(),
  ).toBe(201);
  const roles = (await (await request.get('/api/v1/manager/roles')).json()).roles as {
    id: string;
    templateKey: string;
  }[];
  const branches = (await (await request.get('/api/v1/manager/branches')).json()).branches as {
    id: string;
    isMain: boolean;
  }[];
  const cashierEmail = uniqueEmail('cashier');
  const invited = await request.post('/api/v1/manager/employees/invitations', {
    data: {
      email: cashierEmail,
      fullName: 'Noura Cashier',
      interface: 'pos',
      assignments: [
        {
          roleId: roles.find((r) => r.templateKey === 'cashier')!.id,
          branchId: branches.find((b) => b.isMain)!.id,
        },
      ],
    },
  });
  expect(invited.status()).toBe(201);

  // The cashier follows the e-mailed link and chooses a password.
  const text = await latestMailText(cashierEmail);
  const link = /https?:\/\/\S+accept-invite\?token=[\w-]+/.exec(text)![0];
  await page.goto(link);
  await expect(page.getByText('Noura Cashier, you were invited to join Invite Co')).toBeVisible();
  await page.getByLabel('New password').fill('Cashier-Pass-2026');
  await page.getByLabel('Confirm password').fill('Cashier-Pass-2026');
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByText('Your account is ready.')).toBeVisible();
  await page.getByRole('link', { name: 'Open Point of Sale' }).click();

  await signIn(page, 'pos', cashierEmail, 'Cashier-Pass-2026');
  await expect(page.getByTestId('pos-context')).toContainText('Invite Co');

  // The same link cannot be used again.
  await page.goto(link);
  await expect(
    page.getByText('This invitation is invalid, expired or already used.'),
  ).toBeVisible();
});
