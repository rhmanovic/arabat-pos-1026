import {
  type CategoryRowValues,
  type ProductRowValues,
  type SaveProduct,
  TRANSFER_COLUMNS,
  TRANSFER_MAX_ROWS,
  TRANSFER_SHEETS,
  type TransferColumn,
  type TransferIssue,
  type TransferKind,
  type TransferResult,
  type TransferRow,
  PRODUCT_TYPES,
  YES_NO,
  checkCategoryInput,
  checkProductInput,
  listingIssues,
  newProductInput,
  readCategoryRow,
  readProductRow,
  saveProductSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { sql } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { EcommerceService } from './ecommerce.service.js';

/*
 * Products and categories in Excel from the store console (ADR-0132). The columns come from
 * `TRANSFER_COLUMNS` (contracts): the template, "download all" and the upload all read them.
 * An upload is checked row by row first (nothing written), then applied in ONE transaction
 * through the catalog's and the store's own save functions: every row is written or none.
 * A file never deletes or archives anything; rows without an id create, rows with one update.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const amount = (minor: string | bigint | null) =>
  minor === null ? null : Money.ofMinor(BigInt(minor), 'KWD').toJSON().amount;
const yesNo = (v: boolean) => (v ? YES_NO[0]!.ar : YES_NO[1]!.ar);

type Variant = {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  sku: string | null;
  price: string;
  cost: string | null;
  barcodes: string[];
};
type ProductSnap = {
  id: string;
  version: number;
  nameEn: string | null;
  nameAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  categoryId: string | null;
  type: 'standard' | 'service';
  hasVariants: boolean;
  trackInventory: boolean;
  availableInAllBranches: boolean;
  posVisible: boolean;
  branchIds: string[];
  variants: Variant[];
  listing: {
    visible: boolean;
    featured: boolean;
    maxPerOrder: number | null;
    titleEn: string | null;
    titleAr: string | null;
    descriptionEn: string | null;
    descriptionAr: string | null;
  };
};
type CategorySnap = {
  id: string;
  version: number;
  parentId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  sortOrder: number;
  onlineNameEn: string | null;
  onlineNameAr: string | null;
  visible: boolean;
};
type Snapshot = { categories: CategorySnap[]; products: ProductSnap[] };

/** A row that changes something, ready to be written. */
type ProductPlan = {
  row: number;
  name: string;
  existing: ProductSnap | null;
  product: SaveProduct | null;
  listing: ProductSnap['listing'] | null;
  categoryId: string | null;
};
type CategoryPlan = {
  row: number;
  name: string;
  existing: CategorySnap | null;
  values: CategoryRowValues;
  parentId: string | null;
  /** A parent created earlier in the same file, by its name. */
  parentNew: string | null;
};

type WithValidations = {
  dataValidations: { add(range: string, rule: ExcelJS.DataValidation): void };
};

class RowFailure extends Error {
  constructor(
    readonly row: number,
    override readonly cause: unknown,
  ) {
    super('row failed');
  }
}

@Injectable()
export class CatalogTransferService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly store: EcommerceService,
  ) {}

  // -------------------------------------------------------------------- snapshot
  private async snapshot(tx: Transaction): Promise<Snapshot> {
    const categories = (
      await tx.execute(sql`
        select id, version, parent_id, name_en, name_ar, sort_order, online_name_en,
               online_name_ar, online_visible
        from categories where status = 'active'
        order by coalesce(online_position, sort_order), created_at`)
    ).rows.map((r) => ({
      id: String(r['id']),
      version: Number(r['version']),
      parentId: (r['parent_id'] as string | null) ?? null,
      nameEn: (r['name_en'] as string | null) ?? null,
      nameAr: (r['name_ar'] as string | null) ?? null,
      sortOrder: Number(r['sort_order']),
      onlineNameEn: (r['online_name_en'] as string | null) ?? null,
      onlineNameAr: (r['online_name_ar'] as string | null) ?? null,
      visible: Boolean(r['online_visible']),
    }));
    const productRows = (
      await tx.execute(sql`
        select p.id, p.version, p.name_en, p.name_ar, p.description_en, p.description_ar,
               p.category_id, p.type, p.has_variants, p.track_inventory,
               p.available_in_all_branches, p.pos_visible,
               l.visible, l.featured, l.max_per_order, l.title_en, l.title_ar,
               l.description_en as l_description_en, l.description_ar as l_description_ar
        from products p
        join online_listings l on l.product_id = p.id
        where p.status = 'active'
        order by l.position, p.created_at`)
    ).rows;
    const variantRows = (
      await tx.execute(sql`
        select v.id, v.product_id, v.name_en, v.name_ar, v.sku, v.price_minor, v.cost_minor,
               coalesce(
                 (select array_agg(b.barcode order by b.created_at) from product_barcodes b
                  where b.variant_id = v.id), '{}') as barcodes
        from product_variants v
        where v.status = 'active'
        order by v.position, v.created_at`)
    ).rows;
    const branchRows = (
      await tx.execute(sql`select product_id, branch_id from product_branch_availability`)
    ).rows;
    const products: ProductSnap[] = productRows.map((r) => {
      const id = String(r['id']);
      return {
        id,
        version: Number(r['version']),
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        descriptionEn: (r['description_en'] as string | null) ?? null,
        descriptionAr: (r['description_ar'] as string | null) ?? null,
        categoryId: (r['category_id'] as string | null) ?? null,
        type: r['type'] === 'service' ? 'service' : 'standard',
        hasVariants: Boolean(r['has_variants']),
        trackInventory: Boolean(r['track_inventory']),
        availableInAllBranches: Boolean(r['available_in_all_branches']),
        posVisible: Boolean(r['pos_visible']),
        branchIds: branchRows
          .filter((b) => b['product_id'] === id)
          .map((b) => String(b['branch_id'])),
        variants: variantRows
          .filter((v) => v['product_id'] === id)
          .map((v) => ({
            id: String(v['id']),
            nameEn: (v['name_en'] as string | null) ?? null,
            nameAr: (v['name_ar'] as string | null) ?? null,
            sku: (v['sku'] as string | null) ?? null,
            price: amount(v['price_minor'] as string)!,
            cost: amount((v['cost_minor'] as string | null) ?? null),
            barcodes: (v['barcodes'] as string[]) ?? [],
          })),
        listing: {
          visible: Boolean(r['visible']),
          featured: Boolean(r['featured']),
          maxPerOrder: r['max_per_order'] === null ? null : Number(r['max_per_order']),
          titleEn: (r['title_en'] as string | null) ?? null,
          titleAr: (r['title_ar'] as string | null) ?? null,
          descriptionEn: (r['l_description_en'] as string | null) ?? null,
          descriptionAr: (r['l_description_ar'] as string | null) ?? null,
        },
      };
    });
    return { categories, products };
  }

  /** "Parent › Child" labels of the drop-down list, by category id. */
  private categoryLabels(categories: CategorySnap[]): Map<string, string> {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const name = (c: CategorySnap) => c.nameAr || c.nameEn || '';
    const labels = new Map<string, string>();
    const label = (c: CategorySnap, depth = 0): string => {
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      return parent && depth < 10 ? `${label(parent, depth + 1)} › ${name(c)}` : name(c);
    };
    for (const c of categories) labels.set(c.id, label(c));
    return labels;
  }

  /** A category by its label, or by its own name when that name is unique. */
  private findCategory(
    categories: CategorySnap[],
    labels: Map<string, string>,
    value: string,
  ): { id: string } | 'unknown' | 'ambiguous' {
    const wanted = value
      .trim()
      .replace(/\s*›\s*/g, ' › ')
      .toLowerCase();
    for (const [id, l] of labels) if (l.toLowerCase() === wanted) return { id };
    const byName = categories.filter(
      (c) => c.nameAr?.toLowerCase() === wanted || c.nameEn?.toLowerCase() === wanted,
    );
    if (byName.length === 1) return { id: byName[0]!.id };
    return byName.length > 1 ? 'ambiguous' : 'unknown';
  }

  // -------------------------------------------------------------------- workbook
  /** The template (no rows) or every record, built for this store now. */
  async workbook(actor: MerchantActor, kind: TransferKind, withRows: boolean): Promise<Buffer> {
    const snap = await this.database.withMerchantTx(actor.merchantId, (tx) => this.snapshot(tx));
    const showCost = can(actor.access, 'catalog.prices.manage', null);
    const columns = TRANSFER_COLUMNS[kind].filter((c) => showCost || c.key !== 'cost');
    const labels = this.categoryLabels(snap.categories);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Arabat';
    wb.created = new Date();
    const ws = wb.addWorksheet(TRANSFER_SHEETS[kind], {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    });
    ws.columns = columns.map((c) => ({
      header: c.ar,
      key: c.key,
      width: c.width,
      // Codes, amounts and ids stay text: Excel keeps leading zeros and long numbers.
      style: { numFmt: '@', alignment: { vertical: 'top', wrapText: c.kind === 'longText' } },
    }));
    const header = ws.getRow(1);
    header.height = 30;
    columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      const required = c.required !== 'no';
      cell.font = { bold: true, color: { argb: required ? 'FFFFFFFF' : 'FF1F2937' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: required ? 'FFDC2626' : c.kind === 'info' ? 'FFF3F4F6' : 'FFD1D5DB' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      const notes = [
        c.required === 'yes'
          ? 'إلزامي'
          : c.required === 'oneOf'
            ? 'إلزامي: الاسم العربي أو الإنجليزي (أحدهما على الأقل)'
            : 'اختياري',
        c.hint?.ar,
        c.choices ? `القيم: ${c.choices.map((x) => x.ar).join(' / ')}` : undefined,
      ].filter(Boolean);
      cell.note = notes.join('\n');
    });
    // The drop-down lists live in a hidden sheet (no 255-character limit of inline lists).
    const lists = wb.addWorksheet('lists', { state: 'hidden' });
    const categoryList = [...labels.values()].sort((a, b) => a.localeCompare(b, 'ar'));
    lists.getColumn(1).values = ['categories', ...categoryList];
    lists.getColumn(2).values = ['yesNo', ...YES_NO.map((x) => x.ar)];
    lists.getColumn(3).values = ['types', ...PRODUCT_TYPES.map((x) => x.ar)];
    const listRange: Record<string, string | null> = {
      category: categoryList.length ? `lists!$A$2:$A$${categoryList.length + 1}` : null,
      yesNo: `lists!$B$2:$B$${YES_NO.length + 1}`,
      choice: `lists!$C$2:$C$${PRODUCT_TYPES.length + 1}`,
    };
    const lastRow = TRANSFER_MAX_ROWS + 1;
    columns.forEach((c, i) => {
      const range = listRange[c.kind];
      if (!range) return;
      const letter = ws.getColumn(i + 1).letter;
      // `dataValidations.add` sets one rule for a whole range (missing from the typings).
      (ws as unknown as WithValidations).dataValidations.add(`${letter}2:${letter}${lastRow}`, {
        type: 'list',
        allowBlank: true,
        formulae: [range],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: c.ar,
        error: 'اختر قيمة من القائمة.',
      });
    });
    if (withRows) {
      if (kind === 'products')
        for (const p of snap.products) ws.addRow(this.productCells(p, labels, showCost));
      else for (const c of snap.categories) ws.addRow(this.categoryCells(c, labels));
    }
    this.instructions(wb, kind, columns);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private productCells(p: ProductSnap, labels: Map<string, string>, showCost: boolean) {
    const simple = !p.hasVariants && p.variants.length === 1;
    const v = simple ? p.variants[0]! : null;
    return {
      id: p.id,
      nameAr: p.nameAr ?? '',
      nameEn: p.nameEn ?? '',
      category: p.categoryId ? (labels.get(p.categoryId) ?? '') : '',
      price: v?.price ?? '',
      sku: v?.sku ?? '',
      barcodes: v ? v.barcodes.join(', ') : '',
      ...(showCost ? { cost: v?.cost ?? '' } : {}),
      trackInventory: yesNo(p.trackInventory),
      type: PRODUCT_TYPES.find((t) => t.value === p.type)!.ar,
      visible: yesNo(p.listing.visible),
      featured: yesNo(p.listing.featured),
      maxPerOrder: p.listing.maxPerOrder === null ? '' : String(p.listing.maxPerOrder),
      descriptionAr: p.descriptionAr ?? '',
      descriptionEn: p.descriptionEn ?? '',
      options: simple ? '' : `${p.variants.length} خيارات`,
    };
  }

  private categoryCells(c: CategorySnap, labels: Map<string, string>) {
    return {
      id: c.id,
      nameAr: c.nameAr ?? '',
      nameEn: c.nameEn ?? '',
      parent: c.parentId ? (labels.get(c.parentId) ?? '') : '',
      onlineNameAr: c.onlineNameAr ?? '',
      onlineNameEn: c.onlineNameEn ?? '',
      visible: yesNo(c.visible),
    };
  }

  private instructions(wb: ExcelJS.Workbook, kind: TransferKind, columns: TransferColumn[]) {
    const ws = wb.addWorksheet('تعليمات', { views: [{ rightToLeft: true }] });
    ws.getColumn(1).width = 110;
    const lines = [
      kind === 'products' ? 'رفع المنتجات دفعة واحدة' : 'رفع التصنيفات دفعة واحدة',
      '',
      '• الأعمدة الحمراء إلزامية، والرمادية اختيارية.',
      '• صف بلا معرّف = إضافة جديدة. صف فيه معرّف = تعديل نفس السجل. لا تغيّر المعرّف.',
      '• الملف لا يحذف شيئًا: السجلات غير الموجودة في الملف تبقى كما هي.',
      '• قبل التطبيق تظهر معاينة بالجديد والمعدّل والأخطاء. لا يُكتب شيء حتى تضغط «تطبيق».',
      '• التطبيق يكتب كل الصفوف مرة واحدة: إذا رُفض صف واحد لا يُكتب أي صف.',
      kind === 'products'
        ? '• الأسعار والتكلفة بالدينار الكويتي بثلاث خانات عشرية مثل 1.250.'
        : '• التصنيف الأب يُختار من القائمة، أو اكتب اسم تصنيف جديد أضفته في صف سابق من نفس الملف.',
      kind === 'products'
        ? '• منتج له خيارات (مقاسات، ألوان…): عدّل اسمه وتصنيفه ووصفه وظهوره هنا، أما أسعار الخيارات ورموزها ففي الكتالوج الكامل.'
        : '• تغيير الاسم يغيّر التصنيف في نقاط البيع أيضًا.',
      '',
      'الأعمدة:',
      ...columns.map(
        (c) =>
          `• ${c.ar}: ${c.required === 'no' ? 'اختياري' : 'إلزامي'}${c.hint ? ` — ${c.hint.ar}` : ''}`,
      ),
    ];
    lines.forEach((text, i) => {
      const cell = ws.getCell(i + 1, 1);
      cell.value = text;
      if (i === 0) cell.font = { bold: true, size: 14 };
    });
  }

  // ---------------------------------------------------------------------- import
  /** Reads an uploaded file; `apply` writes every row in one transaction when nothing is wrong. */
  async import(
    actor: MerchantActor,
    kind: TransferKind,
    data: Buffer,
    apply: boolean,
    ip: string,
  ): Promise<TransferResult> {
    if (!can(actor.access, 'catalog.manage', null)) throw AppError.forbidden();
    const read = await this.readSheet(kind, data);
    if (read.issues.length) return this.result('preview', [], 0, read.issues);
    try {
      return await this.importInTx(actor, kind, read.rows, apply, ip);
    } catch (error) {
      if (!(error instanceof RowFailure)) throw error;
      // Nothing of the file was kept: the whole transaction rolled back.
      return this.result('preview', [], 0, [
        { row: error.row, column: '', code: 'rejected', message: this.refusal(error) },
      ]);
    }
  }

  private importInTx(
    actor: MerchantActor,
    kind: TransferKind,
    rows: { row: number; cells: TransferRow }[],
    apply: boolean,
    ip: string,
  ): Promise<TransferResult> {
    const read = { rows };
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const snap = await this.snapshot(tx);
      const plan =
        kind === 'products'
          ? this.planProducts(actor, read.rows, snap)
          : this.planCategories(read.rows, snap);
      if (plan.issues.length || !apply)
        return this.result('preview', plan.changes, plan.unchanged, plan.issues);
      if (kind === 'products')
        await this.applyProducts(tx, actor, plan.changes as ProductPlan[], ip);
      else await this.applyCategories(tx, actor, plan.changes as CategoryPlan[], snap, ip);
      const counts = this.counts(plan.changes, plan.unchanged);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: kind === 'products' ? 'catalog.products_imported' : 'catalog.categories_imported',
        targetType: 'merchant',
        targetId: actor.merchantId,
        ip,
        details: counts,
      });
      return this.result('applied', plan.changes, plan.unchanged, []);
    });
  }

  private refusal(error: RowFailure): string {
    const cause = error.cause;
    const message =
      cause instanceof AppError
        ? cause.message
        : isUniqueViolation(cause, 'product_variants_merchant_sku_key')
          ? 'Another product already uses this SKU.'
          : isUniqueViolation(cause, 'product_barcodes_merchant_id_barcode_pk')
            ? 'Another product already uses this barcode.'
            : 'The row could not be saved.';
    return message;
  }

  private counts(changes: { existing: unknown }[], unchanged: number) {
    return {
      created: changes.filter((c) => !c.existing).length,
      updated: changes.filter((c) => c.existing).length,
      unchanged,
    };
  }

  private result(
    mode: TransferResult['mode'],
    changes: (ProductPlan | CategoryPlan)[],
    unchanged: number,
    issues: TransferIssue[],
  ): TransferResult {
    return {
      mode,
      counts: this.counts(changes, unchanged),
      rows: changes.slice(0, 200).map((c) => ({
        row: c.row,
        action: c.existing ? 'update' : 'create',
        name: c.name,
      })),
      issues: issues.slice(0, 500),
    };
  }

  /** Every non-empty row as text by column key; headers matched in Arabic or English. */
  private async readSheet(
    kind: TransferKind,
    data: Buffer,
  ): Promise<{ rows: { row: number; cells: TransferRow }[]; issues: TransferIssue[] }> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(data as unknown as ArrayBuffer);
    } catch {
      return { rows: [], issues: [{ row: 0, column: '', code: 'notASheet' }] };
    }
    const ws =
      wb.getWorksheet(TRANSFER_SHEETS[kind]) ??
      wb.worksheets.find((w) => w.state === 'visible' && w.name !== 'تعليمات');
    if (!ws) return { rows: [], issues: [{ row: 0, column: '', code: 'notASheet' }] };
    const columns = TRANSFER_COLUMNS[kind];
    const byHeader = new Map<number, string>();
    ws.getRow(1).eachCell((cell, col) => {
      const h = cellText(cell)
        .replace(/\s*\*$/, '')
        .trim()
        .toLowerCase();
      const c = columns.find((x) => [x.ar, x.en, x.key].some((n) => n.toLowerCase() === h));
      if (c) byHeader.set(col, c.key);
    });
    const present = new Set(byHeader.values());
    const issues: TransferIssue[] = [];
    for (const c of columns)
      if (c.required === 'yes' && !present.has(c.key))
        issues.push({ row: 1, column: c.key, code: 'missingColumn' });
    const groups = new Set(columns.filter((c) => c.required === 'oneOf').map((c) => c.group));
    for (const g of groups)
      if (!columns.some((c) => c.group === g && present.has(c.key)))
        issues.push({
          row: 1,
          column: columns.find((c) => c.group === g)!.key,
          code: 'missingColumn',
        });
    const rows: { row: number; cells: TransferRow }[] = [];
    ws.eachRow((r, n) => {
      if (n === 1) return;
      const cells: TransferRow = {};
      for (const [col, key] of byHeader) cells[key] = cellText(r.getCell(col)).trim();
      if (Object.entries(cells).some(([k, v]) => v && k !== 'options'))
        rows.push({ row: n, cells });
    });
    if (rows.length > TRANSFER_MAX_ROWS)
      issues.push({ row: 0, column: '', code: 'tooManyRows', message: String(TRANSFER_MAX_ROWS) });
    return { rows, issues };
  }

  // -------------------------------------------------------------------- products
  private planProducts(
    actor: MerchantActor,
    rows: { row: number; cells: TransferRow }[],
    snap: Snapshot,
  ) {
    const issues: TransferIssue[] = [];
    const changes: ProductPlan[] = [];
    let unchanged = 0;
    const labels = this.categoryLabels(snap.categories);
    const byId = new Map(snap.products.map((p) => [p.id, p]));
    const seenIds = new Set<string>();
    const canPrice = can(actor.access, 'catalog.prices.manage', null);
    // Codes in the file and in other products, to report duplicates before writing.
    const skuOwner = new Map<string, string>();
    const barcodeOwner = new Map<string, string>();
    for (const p of snap.products)
      for (const v of p.variants) {
        if (v.sku) skuOwner.set(v.sku.toLowerCase(), p.id);
        for (const b of v.barcodes) barcodeOwner.set(b, p.id);
      }
    for (const { row, cells } of rows) {
      const add = (list: Omit<TransferIssue, 'row'>[]) =>
        issues.push(...list.map((i) => ({ ...i, row })));
      const { values, issues: cellIssues } = readProductRow(cells);
      add(cellIssues);
      const id = cells['id'] ?? '';
      let existing: ProductSnap | null = null;
      if (id) {
        if (!UUID.test(id) || !byId.has(id)) add([{ column: 'id', code: 'unknownId' }]);
        else if (seenIds.has(id)) add([{ column: 'id', code: 'duplicateId' }]);
        else existing = byId.get(id)!;
        seenIds.add(id);
        if (!existing) continue;
      }
      let categoryId: string | null = null;
      if (cells['category']) {
        const found = this.findCategory(snap.categories, labels, cells['category']);
        if (found === 'unknown') add([{ column: 'category', code: 'unknownCategory' }]);
        else if (found === 'ambiguous') add([{ column: 'category', code: 'ambiguousCategory' }]);
        else categoryId = found.id;
      }
      if (cellIssues.length) continue;
      const owner = existing?.id ?? `row-${row}`;
      if (values.sku) {
        const key = values.sku.toLowerCase();
        const other = skuOwner.get(key);
        if (other && other !== owner) add([{ column: 'sku', code: 'duplicateSku' }]);
        else skuOwner.set(key, owner);
      }
      for (const b of values.barcodes) {
        const other = barcodeOwner.get(b);
        if (other && other !== owner) add([{ column: 'barcodes', code: 'duplicateBarcode' }]);
        else barcodeOwner.set(b, owner);
      }
      const name = values.nameAr || values.nameEn || '';
      if (!existing) {
        const input = newProductInput(values, categoryId);
        const found = checkProductInput(input);
        add(found);
        add(listingIssues(values));
        if (found.length) continue;
        changes.push({
          row,
          name,
          existing: null,
          product: input as SaveProduct,
          listing: {
            visible: values.visible ?? true,
            featured: values.featured ?? false,
            maxPerOrder: values.maxPerOrder,
            titleEn: null,
            titleAr: null,
            descriptionEn: null,
            descriptionAr: null,
          },
          categoryId,
        });
        continue;
      }
      const plan = this.productUpdate(row, existing, values, categoryId, canPrice, add);
      if (plan === 'unchanged') unchanged++;
      else if (plan) changes.push(plan);
    }
    return { changes, unchanged, issues };
  }

  /** The update a row asks for, `unchanged`, or null when it was refused (issues added). */
  private productUpdate(
    row: number,
    p: ProductSnap,
    v: ProductRowValues,
    categoryId: string | null,
    canPrice: boolean,
    add: (list: Omit<TransferIssue, 'row'>[]) => void,
  ): ProductPlan | 'unchanged' | null {
    const simple = !p.hasVariants && p.variants.length === 1;
    if (!simple && (v.price || v.sku || v.barcodes.length || v.cost)) {
      add([{ column: 'price', code: 'optionsProduct' }]);
      return null;
    }
    const type = v.type ?? p.type;
    const product: SaveProduct = {
      nameAr: v.nameAr,
      nameEn: v.nameEn,
      descriptionAr: v.descriptionAr,
      descriptionEn: v.descriptionEn,
      categoryId,
      type,
      hasVariants: p.hasVariants,
      trackInventory: type === 'service' ? false : (v.trackInventory ?? p.trackInventory),
      availableInAllBranches: p.availableInAllBranches,
      branchIds: p.branchIds,
      posVisible: p.posVisible,
      variants: p.variants.map((x) =>
        simple
          ? {
              id: x.id,
              nameEn: x.nameEn,
              nameAr: x.nameAr,
              sku: v.sku,
              barcodes: v.barcodes,
              price: v.price ?? '',
              // Without the right to see costs, the file has no cost: keep the stored one.
              cost: canPrice ? v.cost : x.cost,
            }
          : { ...x },
      ),
      version: p.version,
    };
    const found = checkProductInput(product);
    add(found);
    add(listingIssues(v));
    if (found.length) return null;
    const listing = {
      ...p.listing,
      visible: v.visible ?? p.listing.visible,
      featured: v.featured ?? p.listing.featured,
      maxPerOrder: v.maxPerOrder,
    };
    const x = p.variants[0]!;
    const productChanged =
      product.nameAr !== p.nameAr ||
      product.nameEn !== p.nameEn ||
      product.descriptionAr !== p.descriptionAr ||
      product.descriptionEn !== p.descriptionEn ||
      categoryId !== p.categoryId ||
      type !== p.type ||
      product.trackInventory !== p.trackInventory ||
      (simple &&
        (v.price !== x.price ||
          (v.sku ?? null) !== x.sku ||
          v.barcodes.join(',') !== x.barcodes.join(',') ||
          (canPrice && v.cost !== x.cost)));
    const listingChanged =
      listing.visible !== p.listing.visible ||
      listing.featured !== p.listing.featured ||
      listing.maxPerOrder !== p.listing.maxPerOrder;
    if (!productChanged && !listingChanged) return 'unchanged';
    return {
      row,
      name: v.nameAr || v.nameEn || '',
      existing: p,
      product: productChanged ? product : null,
      listing: listingChanged ? listing : null,
      categoryId,
    };
  }

  private async applyProducts(
    tx: Transaction,
    actor: MerchantActor,
    plans: ProductPlan[],
    ip: string,
  ) {
    for (const plan of plans) {
      try {
        let productId = plan.existing?.id ?? null;
        if (!productId)
          productId = await this.catalog.createProductInTx(
            tx,
            actor,
            saveProductSchema.parse(plan.product),
            ip,
          );
        else if (plan.product)
          await this.catalog.updateProductInTx(
            tx,
            actor,
            productId,
            saveProductSchema.parse(plan.product),
            ip,
          );
        if (plan.listing) await this.store.saveListingInTx(tx, actor, productId, plan.listing, ip);
      } catch (error) {
        throw new RowFailure(plan.row, error);
      }
    }
  }

  // ------------------------------------------------------------------ categories
  private planCategories(rows: { row: number; cells: TransferRow }[], snap: Snapshot) {
    const issues: TransferIssue[] = [];
    const changes: CategoryPlan[] = [];
    let unchanged = 0;
    const labels = this.categoryLabels(snap.categories);
    const byId = new Map(snap.categories.map((c) => [c.id, c]));
    const seenIds = new Set<string>();
    const names = new Set(
      snap.categories.flatMap((c) =>
        [c.nameAr, c.nameEn].filter(Boolean).map((n) => n!.toLowerCase()),
      ),
    );
    const newNames = new Set<string>();
    for (const { row, cells } of rows) {
      const add = (list: Omit<TransferIssue, 'row'>[]) =>
        issues.push(...list.map((i) => ({ ...i, row })));
      const { values, issues: cellIssues } = readCategoryRow(cells);
      add(cellIssues);
      const found = checkCategoryInput(values);
      add(found);
      const id = cells['id'] ?? '';
      let existing: CategorySnap | null = null;
      if (id) {
        if (!UUID.test(id) || !byId.has(id)) add([{ column: 'id', code: 'unknownId' }]);
        else if (seenIds.has(id)) add([{ column: 'id', code: 'duplicateId' }]);
        else existing = byId.get(id)!;
        seenIds.add(id);
        if (!existing) continue;
      }
      let parentId: string | null = null;
      let parentNew: string | null = null;
      if (cells['parent']) {
        const hit = this.findCategory(snap.categories, labels, cells['parent']);
        if (hit === 'ambiguous') add([{ column: 'parent', code: 'ambiguousCategory' }]);
        else if (hit === 'unknown') {
          // A category added by an earlier row of the same file.
          if (newNames.has(cells['parent'].trim().toLowerCase()))
            parentNew = cells['parent'].trim();
          else add([{ column: 'parent', code: 'unknownCategory' }]);
        } else if (existing && hit.id === existing.id)
          add([{ column: 'parent', code: 'selfParent' }]);
        else parentId = hit.id;
      }
      if (cellIssues.length || found.length) continue;
      const name = values.nameAr || values.nameEn || '';
      if (!existing) {
        const own = [values.nameAr, values.nameEn].filter(Boolean).map((n) => n!.toLowerCase());
        if (own.some((n) => names.has(n) || newNames.has(n))) {
          add([{ column: values.nameAr ? 'nameAr' : 'nameEn', code: 'duplicateName' }]);
          continue;
        }
        own.forEach((n) => newNames.add(n));
        changes.push({ row, name, existing: null, values, parentId, parentNew });
        continue;
      }
      const same =
        values.nameAr === existing.nameAr &&
        values.nameEn === existing.nameEn &&
        values.onlineNameAr === existing.onlineNameAr &&
        values.onlineNameEn === existing.onlineNameEn &&
        (values.visible ?? existing.visible) === existing.visible &&
        parentId === existing.parentId &&
        !parentNew;
      if (same) unchanged++;
      else changes.push({ row, name, existing, values, parentId, parentNew });
    }
    return { changes, unchanged, issues };
  }

  private async applyCategories(
    tx: Transaction,
    actor: MerchantActor,
    plans: CategoryPlan[],
    snap: Snapshot,
    ip: string,
  ) {
    let next = Math.max(-1, ...snap.categories.map((c) => c.sortOrder)) + 1;
    const created = new Map<string, string>();
    for (const plan of plans) {
      try {
        const v = plan.values;
        const parentId = plan.parentNew
          ? (created.get(plan.parentNew.toLowerCase()) ?? null)
          : plan.parentId;
        const e = plan.existing;
        let id = e?.id ?? null;
        if (!e) {
          id = await this.catalog.saveCategoryInTx(
            tx,
            actor,
            null,
            { nameEn: v.nameEn, nameAr: v.nameAr, parentId, sortOrder: Math.min(next++, 10000) },
            ip,
          );
          for (const n of [v.nameAr, v.nameEn]) if (n) created.set(n.toLowerCase(), id);
        } else if (v.nameAr !== e.nameAr || v.nameEn !== e.nameEn || parentId !== e.parentId) {
          await this.catalog.saveCategoryInTx(
            tx,
            actor,
            e.id,
            {
              nameEn: v.nameEn,
              nameAr: v.nameAr,
              parentId,
              sortOrder: e.sortOrder,
              version: e.version,
            },
            ip,
          );
        }
        const visible = v.visible ?? e?.visible ?? true;
        if (
          !e ||
          v.onlineNameAr !== e.onlineNameAr ||
          v.onlineNameEn !== e.onlineNameEn ||
          visible !== e.visible
        )
          await this.store.updateCategoryInTx(
            tx,
            actor,
            id!,
            {
              nameEn: v.nameEn,
              nameAr: v.nameAr,
              onlineNameEn: v.onlineNameEn,
              onlineNameAr: v.onlineNameAr,
              visible,
            },
            ip,
          );
      } catch (error) {
        throw new RowFailure(plan.row, error);
      }
    }
  }
}

/** A cell's text whatever Excel stored (text, number, rich text, formula result, link). */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if ('richText' in v) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return String(v.text);
  if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
  return String(cell.text ?? '');
}
