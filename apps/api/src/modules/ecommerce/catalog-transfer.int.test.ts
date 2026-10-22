import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  app = await createTestApp({ env: testEnv({ DATABASE_URL: prepared.runtimeUrl }), mailer });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

function multipart(data: Buffer) {
  const boundary = '----arabat' + Math.random().toString(16).slice(2);
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sheet.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function setup() {
  const c = await createCompany(app, db, mailer);
  const ok = async (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => {
    const r = await c.client.request(method, path, {
      cookies: c.cookies,
      ...(body === undefined ? {} : { body }),
    });
    if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
    return r.json();
  };
  const file = async (path: string) => {
    const r = await c.client.request('GET', path, { cookies: c.cookies });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
    return wb;
  };
  const upload = async (kind: string, wb: ExcelJS.Workbook, apply = false) => {
    const data = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await c.client.request(
      'POST',
      `/manager/online/transfer/${kind}/import${apply ? '?apply=true' : ''}`,
      { cookies: c.cookies, ...multipart(data) },
    );
    if (r.statusCode !== 201 && r.statusCode !== 200) throw new Error(`${r.statusCode} ${r.body}`);
    return r.json();
  };
  return { c, ok, file, upload };
}

/** Appends a row with values under their Arabic headers. */
function addRow(ws: ExcelJS.Worksheet, values: Record<string, string>) {
  const row = ws.getRow(ws.rowCount + 1);
  ws.getRow(1).eachCell((cell, i) => {
    const v = values[String(cell.value)];
    if (v !== undefined) row.getCell(i).value = v;
  });
  row.commit();
}

/** A sheet's rows as objects keyed by the Arabic header. */
function rowsOf(ws: ExcelJS.Worksheet) {
  const headers = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
  const out: Record<string, string>[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const o: Record<string, string> = {};
    (r.values as unknown[]).forEach((v, i) => (o[headers[i]!] = v == null ? '' : String(v)));
    out.push(o);
  });
  return out;
}

describe('products and categories in Excel (ADR-0132)', () => {
  it('builds the template for the store: Arabic headers, RTL, frozen, red required, lists from a hidden sheet', async () => {
    const s = await setup();
    await s.ok('POST', '/manager/categories', { nameAr: 'مشروبات', nameEn: 'Drinks' });
    const wb = await s.file('/manager/online/transfer/products/template');
    const ws = wb.getWorksheet('المنتجات')!;
    expect(ws.views[0]).toMatchObject({ rightToLeft: true, state: 'frozen', ySplit: 1 });
    const header = (title: string) => {
      let found: ExcelJS.Cell | undefined;
      ws.getRow(1).eachCell((cell) => {
        if (cell.value === title) found = cell;
      });
      return found!;
    };
    const red = (cell: ExcelJS.Cell) => (cell.fill as ExcelJS.FillPattern).fgColor?.argb;
    expect(red(header('السعر (د.ك)'))).toBe('FFDC2626');
    expect(red(header('الاسم (عربي)'))).toBe('FFDC2626');
    expect(red(header('رمز المنتج SKU'))).toBe('FFD1D5DB');
    // Codes and prices are text, so Excel keeps their zeros.
    expect(ws.getColumn(header('رمز المنتج SKU').col).numFmt).toBe('@');
    expect(ws.rowCount).toBe(1);
    // The sheet is protected: the id column and the headers are locked, the rest is open.
    expect(
      (ws as unknown as { sheetProtection: { sheet: boolean } }).sheetProtection,
    ).toMatchObject({ sheet: true });
    // Locked is Excel's default (no mark); open columns carry an explicit unlock.
    const lockedOf = (n: number | string) =>
      ws.getColumn(Number(n)).style.protection?.locked ?? true;
    expect(lockedOf(header('المعرّف (لا تعدّله)').col)).toBe(true);
    expect(lockedOf(header('الاسم (عربي)').col)).toBe(false);
    expect(header('الاسم (عربي)').protection?.locked ?? true).toBe(true);
    const lists = wb.getWorksheet('lists')!;
    expect(lists.state).toBe('hidden');
    expect(lists.getColumn(1).values).toContain('مشروبات');
    // The category column reads its drop-down list from the hidden sheet.
    const category = ws.getCell(2, header('التصنيف').col);
    expect(category.dataValidation).toMatchObject({ type: 'list', formulae: ['lists!$A$2:$A$2'] });
  });

  it('downloads every product, then checks and applies an edited file in one go', async () => {
    const s = await setup();
    const drinks = await s.ok('POST', '/manager/categories', {
      nameAr: 'مشروبات',
      nameEn: 'Drinks',
    });
    const tea = await s.ok('POST', '/manager/products', {
      nameAr: 'شاي',
      nameEn: 'Tea',
      variants: [{ sku: '0042', price: '1.250', cost: '0.400', barcodes: ['00012345'] }],
    });
    const wb = await s.file('/manager/online/transfer/products/export');
    const ws = wb.getWorksheet('المنتجات')!;
    const [row] = rowsOf(ws);
    expect(row).toMatchObject({
      'المعرّف (لا تعدّله)': tea.id,
      'الاسم (عربي)': 'شاي',
      'السعر (د.ك)': '1.250',
      'رمز المنتج SKU': '0042',
      الباركود: '00012345',
      'ظاهر على الموقع': 'نعم',
    });
    // Unchanged file: nothing to write.
    expect((await s.upload('products', wb)).counts).toEqual({
      created: 0,
      updated: 0,
      unchanged: 1,
    });
    // A new price, a new product in a category, and a row without a name.
    const col = (title: string) => {
      let n = 0;
      ws.getRow(1).eachCell((cell, i) => {
        if (cell.value === title) n = i;
      });
      return n;
    };
    ws.getCell(2, col('السعر (د.ك)')).value = '1.5';
    ws.getCell(3, col('الاسم (عربي)')).value = 'قهوة';
    ws.getCell(3, col('السعر (د.ك)')).value = 2;
    ws.getCell(3, col('التصنيف')).value = 'مشروبات';
    ws.getCell(4, col('السعر (د.ك)')).value = '3';
    let result = await s.upload('products', wb, true);
    expect(result.mode).toBe('preview');
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 4, column: 'nameAr', code: 'nameRequired' }),
    ]);
    // Nothing was written while a row was wrong.
    expect((await s.ok('GET', `/manager/products/${tea.id}`)).variants[0].price.amount).toBe(
      '1.250',
    );
    ws.spliceRows(4, 1);
    result = await s.upload('products', wb);
    expect(result).toMatchObject({
      mode: 'preview',
      counts: { created: 1, updated: 1, unchanged: 0 },
      issues: [],
    });
    result = await s.upload('products', wb, true);
    expect(result.mode).toBe('applied');
    const updated = await s.ok('GET', `/manager/products/${tea.id}`);
    expect(updated.variants[0]).toMatchObject({ sku: '0042', barcodes: ['00012345'] });
    expect(updated.variants[0].price.amount).toBe('1.500');
    expect(updated.variants[0].cost.amount).toBe('0.400');
    const listings = (await s.ok('GET', '/manager/online/listings')).products as {
      nameAr: string;
      visible: boolean;
      category: { id: string } | null;
    }[];
    expect(listings.find((l) => l.nameAr === 'قهوة')).toMatchObject({
      visible: true,
      category: expect.objectContaining({ id: drinks.id }),
    });
  });

  it('ticks products into several special lists, one column per list, and refuses an unknown list', async () => {
    const s = await setup();
    const offers = await s.ok('POST', '/manager/online/collections', { nameAr: 'عروض' });
    const fresh = await s.ok('POST', '/manager/online/collections', { nameAr: 'وصل حديثًا' });
    const tea = await s.ok('POST', '/manager/products', {
      nameAr: 'شاي',
      variants: [{ price: '1.000' }],
    });
    const wb = await s.file('/manager/online/transfer/products/export');
    const ws = wb.getWorksheet('المنتجات')!;
    const at = (sheet: ExcelJS.Worksheet) => {
      const cols: Record<string, number> = {};
      sheet.getRow(1).eachCell((cell, i) => {
        cols[String(cell.value)] = i;
      });
      return cols;
    };
    const cols = at(ws);
    // One column per list, right after the category, with a ✓ drop-down; no comma column.
    expect(cols['قائمة: عروض']).toBe(cols['التصنيف']! + 1);
    expect(cols['قائمة: وصل حديثًا']).toBe(cols['التصنيف']! + 2);
    expect(cols['العروض والقوائم الخاصة']).toBeUndefined();
    expect(ws.getCell(2, cols['قائمة: عروض']!).dataValidation).toMatchObject({
      type: 'list',
      errorStyle: 'stop',
      formulae: ['lists!$D$2:$D$2'],
    });
    expect(wb.getWorksheet('lists')!.getCell('D2').value).toBe('✓');
    expect(ws.getCell(2, cols['قائمة: عروض']!).value).toBe('');
    // Two ticks at once put the product in both lists.
    ws.getCell(2, cols['قائمة: عروض']!).value = '✓';
    ws.getCell(2, cols['قائمة: وصل حديثًا']!).value = '✓';
    expect((await s.upload('products', wb, true)).counts).toMatchObject({ updated: 1 });
    const lists = async () =>
      [
        ...(
          (await s.ok('GET', '/manager/online/listings')).products as {
            productId: string;
            collectionIds: string[];
          }[]
        ).find((l) => l.productId === tea.id)!.collectionIds,
      ].sort();
    expect(await lists()).toEqual([offers.id, fresh.id].sort());
    // The file shows the ticks back; clearing one takes the product out of that list only.
    const back = await s.file('/manager/online/transfer/products/export');
    const sheet = back.getWorksheet('المنتجات')!;
    expect(sheet.getCell(2, cols['قائمة: عروض']!).value).toBe('✓');
    expect(sheet.getCell(2, cols['قائمة: وصل حديثًا']!).value).toBe('✓');
    sheet.getCell(2, cols['قائمة: عروض']!).value = '';
    expect((await s.upload('products', back, true)).counts).toMatchObject({ updated: 1 });
    expect(await lists()).toEqual([fresh.id]);
    // A list renamed or missing in the store is named on the header; another mark is refused.
    sheet.getRow(1).getCell(cols['قائمة: عروض']!).value = 'قائمة: تخفيضات';
    sheet.getCell(2, cols['قائمة: وصل حديثًا']!).value = 'ربما';
    expect((await s.upload('products', back)).issues).toEqual([
      expect.objectContaining({
        row: 1,
        column: 'list:تخفيضات',
        code: 'unknownCollection',
        message: 'تخفيضات',
      }),
      expect.objectContaining({ row: 2, column: 'list:وصل حديثًا', code: 'invalidChoice' }),
    ]);
  });

  it('reports duplicate codes before writing and keeps nothing when one row is refused', async () => {
    const s = await setup();
    const a = await s.ok('POST', '/manager/categories', { nameAr: 'أ' });
    const b = await s.ok('POST', '/manager/categories', { nameAr: 'ب' });
    await s.ok('POST', '/manager/products', {
      nameAr: 'شاي',
      variants: [{ sku: 'TEA', price: '1' }],
    });
    // A new product with a SKU another product has.
    const products = await s.file('/manager/online/transfer/products/template');
    const sheet = products.getWorksheet('المنتجات')!;
    addRow(sheet, { 'الاسم (عربي)': 'قهوة', 'السعر (د.ك)': '2', 'رمز المنتج SKU': 'tea' });
    expect((await s.upload('products', products)).issues).toEqual([
      expect.objectContaining({ row: 2, column: 'sku', code: 'duplicateSku' }),
    ]);
    // Each category under the other: the second row is refused when written, so the first is not kept.
    const wb = await s.file('/manager/online/transfer/categories/export');
    const ws = wb.getWorksheet('التصنيفات')!;
    ws.getCell(2, 4).value = 'ب';
    ws.getCell(3, 4).value = 'أ';
    const result = await s.upload('categories', wb, true);
    expect(result.mode).toBe('preview');
    expect(result.issues).toEqual([expect.objectContaining({ row: 3, code: 'rejected' })]);
    const body = await s.ok('GET', '/manager/categories');
    const cats = (body.categories ?? body) as { id: string; parentId: string | null }[];
    expect(cats.find((x) => x.id === a.id)?.parentId).toBeNull();
    expect(cats.find((x) => x.id === b.id)?.parentId).toBeNull();
  });

  it('adds categories with a parent from an earlier row and refuses duplicate names', async () => {
    const s = await setup();
    await s.ok('POST', '/manager/categories', { nameAr: 'مشروبات' });
    const wb = await s.file('/manager/online/transfer/categories/template');
    const ws = wb.getWorksheet('التصنيفات')!;
    addRow(ws, { 'الاسم (عربي)': 'حلويات', 'ظاهر في المتجر': 'نعم' });
    addRow(ws, {
      'الاسم (عربي)': 'كيك',
      'التصنيف الأب': 'حلويات',
      'الاسم في المتجر (عربي)': 'كيك طازج',
      'ظاهر في المتجر': 'لا',
    });
    addRow(ws, { 'الاسم (عربي)': 'مشروبات' });
    expect((await s.upload('categories', wb)).issues).toEqual([
      expect.objectContaining({ row: 4, column: 'nameAr', code: 'duplicateName' }),
    ]);
    ws.spliceRows(4, 1);
    expect((await s.upload('categories', wb, true)).counts).toEqual({
      created: 2,
      updated: 0,
      unchanged: 0,
    });
    const cats = (await s.ok('GET', '/manager/online/categories')).categories as {
      id: string;
      nameAr: string;
      parentId: string | null;
      onlineNameAr: string | null;
      visible: boolean;
    }[];
    const sweets = cats.find((x) => x.nameAr === 'حلويات')!;
    expect(cats.find((x) => x.nameAr === 'كيك')).toMatchObject({
      parentId: sweets.id,
      onlineNameAr: 'كيك طازج',
      visible: false,
    });
  });
});
