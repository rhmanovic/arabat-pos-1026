import { type Page, expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { latestMailText, uniqueEmail, useEnglish } from './helpers';

const BRIDGE_BUNDLE = 'test-results/device-bridge.js';
const PIN = '482913';

/**
 * The device till against the real server (ADR-0112): the page is the published /device-app/
 * bundle; `window.ArabatApp` is the fake bridge from `@arabat/device-core/testing` (in-memory
 * SQLite, token kept out of the page, prints recorded), injected before the page loads.
 */
test.beforeAll(async () => {
  mkdirSync('test-results', { recursive: true });
  await build({
    entryPoints: ['e2e/device-bridge.entry.ts'],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    conditions: ['source'],
    outfile: BRIDGE_BUNDLE,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    // sql.js probes for Node only when it runs there; the browser bundle never reaches them.
    external: ['fs', 'path', 'crypto', 'node:fs', 'node:path', 'node:crypto'],
  });
});

test.beforeEach(async ({ page }) => {
  await useEnglish(page);
  await page.addInitScript({ path: BRIDGE_BUNDLE });
});

async function typePin(page: Page) {
  const pad = page.getByTestId('pin-pad');
  for (const d of PIN) await pad.getByRole('button', { name: d, exact: true }).click();
  await pad.getByRole('button', { name: 'Enter' }).click();
}

test('register → full sync → PIN → open shift → sale → upload accepted → retry gives duplicate → refund → close shift', async ({
  page,
}) => {
  // A company and a product (manager side, online). The PIN is the owner's own business later.
  const email = uniqueEmail('device-owner');
  const password = 'Owner-Pass-2026';
  expect(
    (
      await page.request.post('/api/v1/auth/register', {
        data: {
          company: { nameEn: 'Device Co' },
          owner: { fullName: 'Device Owner', email, password },
        },
      })
    ).status(),
  ).toBe(201);
  const product = await page.request.post('/api/v1/manager/products', {
    data: {
      nameEn: 'Tea',
      nameAr: 'شاي',
      variants: [{ sku: 'TEA-E2E', price: '0.250', cost: '0.080', barcodes: ['6281000000017'] }],
    },
  });
  expect(product.status()).toBe(201);

  // The published bundle: manifest first, then the page with the fake bridge.
  const manifest = (await (await page.request.get('/device-app/manifest.json')).json()) as {
    version: string;
    entry: string;
    files: { path: string }[];
  };
  expect(manifest.entry).toBe('index.html');
  expect(manifest.files.some((f) => f.path === 'index.html')).toBe(true);
  await page.goto('/device-app/');

  // Registration on the device by the owner (one branch: registered at once).
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel('Device name').fill('E2E till');
  await page.getByRole('button', { name: 'Register' }).click();
  // A device is not a drawer (amendment 4): the manager creates a register and binds it to the
  // device, which makes it the drawer's primary (cash, shift, browser receipts).
  // The registration call runs in the page: wait for the device to exist on the server.
  type Listed = { devices: { id: string; code: string; registerId: string | null }[] };
  await expect
    .poll(
      async () =>
        ((await (await page.request.get('/api/v1/manager/devices')).json()) as Listed).devices
          .length,
      { timeout: 15_000 },
    )
    .toBe(1);
  const devices = (await (await page.request.get('/api/v1/manager/devices')).json()) as Listed;
  expect(devices.devices).toEqual([expect.objectContaining({ code: 'D1', registerId: null })]);
  const drawer = await page.request.post('/api/v1/manager/registers', {
    data: {
      branchId: (await (await page.request.get('/api/v1/manager/branches')).json()).branches[0].id,
      code: 'DRW',
      nameEn: 'Front drawer',
      isMain: true,
    },
  });
  expect(drawer.status()).toBe(201);
  const bound = await page.request.put(`/api/v1/manager/devices/${devices.devices[0]!.id}`, {
    data: { registerId: (await drawer.json()).id },
  });
  expect(bound.status()).toBe(200);
  await page.getByRole('button', { name: 'Sync now' }).click();

  // The first full sync brings the staff list. The owner has no PIN yet: "Set / reset PIN" on the
  // till e-mails a link (owner decision 6); the page behind it sets the PIN, nobody else sees it.
  await page.getByRole('button', { name: 'Device Owner' }).click();
  await page.getByTestId('reset-pin').click();
  await expect(page.getByText(/a link to choose your PIN is on its way/)).toBeVisible();
  const mail = await latestMailText(email);
  const link = /https?:\/\/\S+\/pos\/pin\?token=\S+/.exec(mail)![0];
  const pinPage = await page.context().newPage();
  await pinPage.goto(link);
  await pinPage.getByLabel('PIN', { exact: true }).fill(PIN);
  await pinPage.getByLabel('Repeat the PIN').fill(PIN);
  await pinPage.getByRole('button', { name: 'Save PIN' }).click();
  await expect(pinPage.getByText(/Your PIN is set/)).toBeVisible();
  await pinPage.close();
  // The till picks the new hash up at its next sync, then the owner signs in.
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const rows = await window.ArabatApp!.db.query(
            `SELECT pin_hash FROM staff WHERE pin_hash IS NOT NULL`,
          );
          return rows.length;
        }),
      { timeout: 15_000 },
    )
    .toBe(1);
  await typePin(page);
  await page.getByLabel('Counted cash').fill('10.000');
  await page.getByRole('button', { name: 'Open shift' }).click();

  // A sale: scan the barcode, pay cash with change, print.
  await page.getByTestId('search').fill('6281000000017');
  await page.getByTestId('search').press('Enter');
  await expect(page.getByTestId('total')).toContainText('KWD 0.250');
  await page.getByTestId('pay').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('tendered').fill('1');
  await dialog.getByTestId('add-payment').click();
  await dialog.getByTestId('complete-sale').click();
  // The receipt series is the device's own code (D1 in this branch).
  await expect(page.getByTestId('last-sale')).toContainText(/MAIN-D1-000001/);
  const receipt = /MAIN-D1-000001/.exec(
    (await page.getByTestId('last-sale').textContent()) ?? '',
  )![0];
  await expect.poll(() => page.evaluate(() => window.__arabatPrinted!().length)).toBe(1);

  // Uploaded and accepted by the real server: the sale exists for the manager.
  const outbox = () =>
    page.evaluate(() =>
      window.ArabatApp!.db.query(`SELECT kind, status, code, message FROM outbox ORDER BY seq`),
    );
  await expect.poll(outbox, { timeout: 15_000 }).toEqual([
    { kind: 'sign_in', status: 'accepted', code: null, message: null },
    { kind: 'shift_open', status: 'accepted', code: null, message: null },
    { kind: 'sale', status: 'accepted', code: null, message: null },
  ]);
  await expect(page.getByTestId('sync-line')).toContainText('Synced');
  const sales = (await (await page.request.get('/api/v1/manager/sales?pageSize=5')).json()) as {
    sales: { receiptNumber: string }[];
  };
  expect(sales.sales.map((s) => s.receiptNumber)).toContain(receipt);
  const listed = (await (await page.request.get('/api/v1/manager/devices')).json()) as {
    devices: { name: string; code: string; registerCode: string | null }[];
  };
  expect(listed.devices).toEqual([
    expect.objectContaining({ name: 'E2E till', code: 'D1', registerCode: 'DRW' }),
  ]);

  // The same records sent again are duplicates, never applied twice.
  const retry = await page.evaluate(async () => {
    const rows = await window.ArabatApp!.db.query(`SELECT body FROM outbox ORDER BY seq`);
    const res = await window.ArabatApp!.api.request('POST', '/device/sync', {
      records: rows.map((r) => JSON.parse(String(r['body']))),
    });
    return (res.body as { results: { status: string }[] }).results.map((r) => r.status);
  });
  expect(retry).toEqual(['duplicate', 'duplicate', 'duplicate']);

  // Lock keeps the owner: their PIN only, and no log-out while the branch shift is open.
  await page.getByTestId('lock').click();
  await expect(page.getByRole('heading', { name: 'Device Owner' })).toBeVisible();
  await expect(page.getByTestId('log-out')).toBeDisabled();
  await typePin(page);
  await expect(page.getByTestId('catalog')).toBeVisible();

  // Refund of this device's sale (the owner needs no second person), then the close.
  await page.getByRole('button', { name: 'Refunds' }).click();
  await page.getByRole('button', { name: receipt }).click();
  await page.getByLabel('Quantity to refund 0').fill('1');
  await expect(page.getByTestId('refund-total')).toContainText('KWD 0.250');
  await page.getByTestId('refund-submit').click();
  await expect(page.getByText(`Refund ${receipt}-R1 recorded.`).first()).toBeVisible();
  await page.getByRole('button', { name: 'Back to the till' }).click();
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByTestId('shift-summary')).toContainText('Expected cash');
  await page.getByLabel('Counted cash').fill('10.000');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByText(/Shift closed/)).toBeVisible();
  await expect
    .poll(async () => (await outbox()).map((r) => `${r['kind']}:${r['status']}`), {
      timeout: 15_000,
    })
    .toEqual([
      'sign_in:accepted',
      'shift_open:accepted',
      'sale:accepted',
      'refund:accepted',
      'shift_close:accepted',
    ]);
  const shifts = (await (await page.request.get('/api/v1/manager/shifts?pageSize=5')).json()) as {
    shifts: { status: string }[];
  };
  expect(shifts.shifts[0]).toMatchObject({ status: 'closed' });
  // The device sign-in is the owner's last sign-in; with the shift closed, log-out works.
  const employees = (await (await page.request.get('/api/v1/manager/employees')).json()) as {
    employees: { isOwner: boolean; lastLoginAt: string | null }[];
  };
  expect(employees.employees.find((e) => e.isOwner)?.lastLoginAt).not.toBeNull();
  await page.getByTestId('log-out').click();
  await expect(page.getByRole('heading', { name: 'Who is at the till?' })).toBeVisible();
});
