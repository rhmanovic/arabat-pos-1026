import { z } from 'zod';
import {
  barcodeSchema,
  moneyAmountSchema,
  saveCategorySchema,
  saveProductSchema,
} from './catalog.js';
import { saveListingSchema, saveStoreCategorySchema } from './ecommerce.js';

/*
 * Products and categories in Excel (ADR-0132): one definition of the columns builds the
 * template, the "download all" file and reads an uploaded file. Which columns are required is
 * not written by hand: it is worked out from the same schemas that check a product or a
 * category saved from the console.
 */

export const TRANSFER_KINDS = ['products', 'categories'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

/** Rows read from one file at most. */
export const TRANSFER_MAX_ROWS = 2000;

export type TransferChoice = { value: string; ar: string; en: string };
export type TransferColumnKind =
  /** The row's record id: empty = a new one, filled = that one is updated. */
  | 'id'
  | 'text'
  | 'longText'
  /** KWD with 3 decimals, kept as text in the sheet. */
  | 'money'
  /** Barcodes separated by commas. */
  | 'codes'
  | 'code'
  | 'yesNo'
  | 'choice'
  /** A category of the store, from the drop-down list. */
  | 'category'
  | 'int'
  /** Shown in the download for information; ignored when read. */
  | 'info';

export type TransferColumn = {
  key: string;
  ar: string;
  en: string;
  kind: TransferColumnKind;
  width: number;
  choices?: readonly TransferChoice[];
  /** Columns of which at least one must be filled (the two names). */
  group?: string;
  hint?: { ar: string; en: string };
  /** `yes` = this column, `oneOf` = one of its group, `no` = optional. Derived, see below. */
  required: 'yes' | 'oneOf' | 'no';
};
type ColumnSpec = Omit<TransferColumn, 'required'>;

export const YES_NO: readonly TransferChoice[] = [
  { value: 'yes', ar: 'نعم', en: 'Yes' },
  { value: 'no', ar: 'لا', en: 'No' },
];
export const PRODUCT_TYPES: readonly TransferChoice[] = [
  { value: 'standard', ar: 'منتج', en: 'Product' },
  { value: 'service', ar: 'خدمة', en: 'Service' },
];

const PRODUCT_SPECS: ColumnSpec[] = [
  {
    key: 'id',
    ar: 'المعرّف (لا تعدّله)',
    en: 'ID (do not edit)',
    kind: 'id',
    width: 38,
    hint: {
      ar: 'فارغ = منتج جديد. معبأ = تعديل هذا المنتج.',
      en: 'Empty = a new product. Filled = this product is updated.',
    },
  },
  {
    key: 'nameAr',
    ar: 'الاسم (عربي)',
    en: 'Name (Arabic)',
    kind: 'text',
    width: 30,
    group: 'name',
  },
  {
    key: 'nameEn',
    ar: 'الاسم (إنجليزي)',
    en: 'Name (English)',
    kind: 'text',
    width: 30,
    group: 'name',
  },
  { key: 'category', ar: 'التصنيف', en: 'Category', kind: 'category', width: 26 },
  {
    key: 'price',
    ar: 'السعر (د.ك)',
    en: 'Price (KWD)',
    kind: 'money',
    width: 14,
    hint: { ar: 'مثل 1.250', en: 'Like 1.250' },
  },
  { key: 'sku', ar: 'رمز المنتج SKU', en: 'SKU', kind: 'code', width: 18 },
  {
    key: 'barcodes',
    ar: 'الباركود',
    en: 'Barcodes',
    kind: 'codes',
    width: 22,
    hint: { ar: 'أكثر من باركود: افصل بفاصلة', en: 'Several: separate with commas' },
  },
  { key: 'cost', ar: 'التكلفة (د.ك)', en: 'Cost (KWD)', kind: 'money', width: 14 },
  {
    key: 'trackInventory',
    ar: 'تتبع المخزون',
    en: 'Track stock',
    kind: 'yesNo',
    width: 13,
    choices: YES_NO,
  },
  { key: 'type', ar: 'النوع', en: 'Type', kind: 'choice', width: 11, choices: PRODUCT_TYPES },
  {
    key: 'visible',
    ar: 'ظاهر على الموقع',
    en: 'On the website',
    kind: 'yesNo',
    width: 14,
    choices: YES_NO,
  },
  { key: 'featured', ar: 'مميّز', en: 'Featured', kind: 'yesNo', width: 10, choices: YES_NO },
  {
    key: 'maxPerOrder',
    ar: 'الحد الأقصى في الطلب',
    en: 'Max per order',
    kind: 'int',
    width: 16,
    hint: { ar: 'من 1 إلى 20؛ فارغ = 20', en: '1–20; empty = 20' },
  },
  {
    key: 'descriptionAr',
    ar: 'الوصف (عربي)',
    en: 'Description (Arabic)',
    kind: 'longText',
    width: 40,
  },
  {
    key: 'descriptionEn',
    ar: 'الوصف (إنجليزي)',
    en: 'Description (English)',
    kind: 'longText',
    width: 40,
  },
  {
    key: 'options',
    ar: 'الخيارات (للعلم)',
    en: 'Options (information)',
    kind: 'info',
    width: 22,
    hint: {
      ar: 'منتج بخيارات: أسعاره ورموزه في الكتالوج الكامل.',
      en: 'A product with options: its prices and codes are in the full catalog.',
    },
  },
];

const CATEGORY_SPECS: ColumnSpec[] = [
  {
    key: 'id',
    ar: 'المعرّف (لا تعدّله)',
    en: 'ID (do not edit)',
    kind: 'id',
    width: 38,
    hint: {
      ar: 'فارغ = تصنيف جديد. معبأ = تعديل هذا التصنيف.',
      en: 'Empty = a new category. Filled = this category is updated.',
    },
  },
  {
    key: 'nameAr',
    ar: 'الاسم (عربي)',
    en: 'Name (Arabic)',
    kind: 'text',
    width: 28,
    group: 'name',
  },
  {
    key: 'nameEn',
    ar: 'الاسم (إنجليزي)',
    en: 'Name (English)',
    kind: 'text',
    width: 28,
    group: 'name',
  },
  { key: 'parent', ar: 'التصنيف الأب', en: 'Parent category', kind: 'category', width: 28 },
  {
    key: 'onlineNameAr',
    ar: 'الاسم في المتجر (عربي)',
    en: 'Store name (Arabic)',
    kind: 'text',
    width: 26,
  },
  {
    key: 'onlineNameEn',
    ar: 'الاسم في المتجر (إنجليزي)',
    en: 'Store name (English)',
    kind: 'text',
    width: 26,
  },
  {
    key: 'visible',
    ar: 'ظاهر في المتجر',
    en: 'Shown in the store',
    kind: 'yesNo',
    width: 14,
    choices: YES_NO,
  },
];

// ------------------------------------------------------------------ row → saved input
/** A row read from the sheet: every cell as trimmed text ('' when empty). */
export type TransferRow = Record<string, string>;
export type TransferIssue = {
  /** 1-based row number in the sheet (the header is row 1). */
  row: number;
  column: string;
  code: TransferIssueCode;
  message?: string;
};
export const TRANSFER_ISSUE_CODES = [
  'required',
  'nameRequired',
  'invalidAmount',
  'invalidChoice',
  'invalidNumber',
  'invalidCode',
  'tooLong',
  'unknownCategory',
  'ambiguousCategory',
  'unknownId',
  'duplicateId',
  'duplicateName',
  'duplicateSku',
  'duplicateBarcode',
  'optionsProduct',
  'selfParent',
  'missingColumn',
  'tooManyRows',
  'notASheet',
  'rejected',
] as const;
export type TransferIssueCode = (typeof TRANSFER_ISSUE_CODES)[number];

/** Normalises a yes/no cell; `undefined` = not one of the accepted words. */
export function readYesNo(value: string): boolean | null | undefined {
  const v = value.trim().toLowerCase();
  if (v === '') return null;
  if (['نعم', 'yes', 'y', 'true', '1', '✓'].includes(v)) return true;
  if (['لا', 'no', 'n', 'false', '0'].includes(v)) return false;
  return undefined;
}

/** A choice cell (Arabic word, English word or the value itself); `undefined` = unknown. */
export function readChoice(choices: readonly TransferChoice[], value: string) {
  const v = value.trim().toLowerCase();
  if (v === '') return null;
  return choices.find((c) => [c.value, c.ar, c.en.toLowerCase()].includes(v))?.value;
}

/** An amount written with up to 3 decimals, as the KWD text "1.250" (no arithmetic). */
export function readAmount(value: string): string | null | undefined {
  const v = value
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace('٫', '.');
  if (v === '') return null;
  if (!moneyAmountSchema.safeParse(v).success) return undefined;
  const [whole, fraction = ''] = v.split('.');
  return `${String(Number(whole))}.${fraction.padEnd(3, '0')}`;
}

/** Barcodes separated by commas, Arabic commas, semicolons or new lines. */
export function readCodes(value: string): string[] {
  return value
    .split(/[,،;\n]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** The product a row describes, in the shape the catalog saves (before checks against data). */
export type ProductRowValues = {
  nameAr: string | null;
  nameEn: string | null;
  price: string | null;
  sku: string | null;
  barcodes: string[];
  cost: string | null;
  trackInventory: boolean | null;
  type: 'standard' | 'service' | null;
  visible: boolean | null;
  featured: boolean | null;
  maxPerOrder: number | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
};

type Read<T> = { values: T; issues: Omit<TransferIssue, 'row'>[] };
const textOrNull = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function readProductRow(row: TransferRow): Read<ProductRowValues> {
  const issues: Omit<TransferIssue, 'row'>[] = [];
  const amount = (key: string) => {
    const v = readAmount(row[key] ?? '');
    if (v === undefined) issues.push({ column: key, code: 'invalidAmount' });
    return v ?? null;
  };
  const yesNo = (key: string) => {
    const v = readYesNo(row[key] ?? '');
    if (v === undefined) issues.push({ column: key, code: 'invalidChoice' });
    return v ?? null;
  };
  const type = readChoice(PRODUCT_TYPES, row['type'] ?? '');
  if (type === undefined) issues.push({ column: 'type', code: 'invalidChoice' });
  let maxPerOrder: number | null = null;
  const max = (row['maxPerOrder'] ?? '').trim();
  if (max) {
    const n = Number(max);
    if (!Number.isInteger(n) || n < 1 || n > 20)
      issues.push({ column: 'maxPerOrder', code: 'invalidNumber' });
    else maxPerOrder = n;
  }
  const barcodes = readCodes(row['barcodes'] ?? '');
  if (barcodes.some((b) => !barcodeSchema.safeParse(b).success) || barcodes.length > 10)
    issues.push({ column: 'barcodes', code: 'invalidCode' });
  return {
    values: {
      nameAr: textOrNull(row['nameAr']),
      nameEn: textOrNull(row['nameEn']),
      price: amount('price'),
      sku: textOrNull(row['sku']),
      barcodes,
      cost: amount('cost'),
      trackInventory: yesNo('trackInventory'),
      type: (type ?? null) as ProductRowValues['type'],
      visible: yesNo('visible'),
      featured: yesNo('featured'),
      maxPerOrder,
      descriptionAr: textOrNull(row['descriptionAr']),
      descriptionEn: textOrNull(row['descriptionEn']),
    },
    issues,
  };
}

/** The input of a new simple product from a row (the same shape the console sends). */
export function newProductInput(v: ProductRowValues, categoryId: string | null) {
  const type = v.type ?? 'standard';
  return {
    nameAr: v.nameAr,
    nameEn: v.nameEn,
    descriptionAr: v.descriptionAr,
    descriptionEn: v.descriptionEn,
    categoryId,
    type,
    trackInventory: type === 'service' ? false : (v.trackInventory ?? true),
    variants: [
      {
        nameEn: null,
        nameAr: null,
        sku: v.sku,
        barcodes: v.barcodes,
        price: v.price ?? '',
        cost: v.cost,
      },
    ],
  };
}

/** Where a schema issue belongs in the sheet. */
function productIssueColumn(path: PropertyKey[]): string {
  const [first, , field] = path;
  if (first === 'variants') {
    if (field === 'barcodes') return 'barcodes';
    if (field === 'sku' || field === 'price' || field === 'cost') return String(field);
    return 'price';
  }
  return typeof first === 'string' ? first : 'nameAr';
}

/** The catalog's own checks of a product, as sheet issues. */
export function checkProductInput(input: unknown): Omit<TransferIssue, 'row'>[] {
  const parsed = saveProductSchema.safeParse(input);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => {
    const column = productIssueColumn(i.path);
    const code: TransferIssueCode =
      i.message === 'A product name is required.'
        ? 'nameRequired'
        : i.code === 'too_big'
          ? 'tooLong'
          : column === 'price' || column === 'cost'
            ? 'invalidAmount'
            : column === 'sku' || column === 'barcodes'
              ? 'invalidCode'
              : 'rejected';
    return { column: code === 'nameRequired' ? 'nameAr' : column, code, message: i.message };
  });
}

/** The listing part of a row (website switch, featured, maximum), checked by the store's schema. */
export function listingIssues(v: ProductRowValues): Omit<TransferIssue, 'row'>[] {
  const parsed = saveListingSchema.safeParse({
    titleEn: null,
    titleAr: null,
    descriptionEn: null,
    descriptionAr: null,
    featured: v.featured ?? false,
    maxPerOrder: v.maxPerOrder,
    visible: v.visible ?? true,
  });
  return parsed.success
    ? []
    : parsed.error.issues.map((i) => ({
        column: String(i.path[0] ?? 'visible'),
        code: 'rejected' as const,
        message: i.message,
      }));
}

export type CategoryRowValues = {
  nameAr: string | null;
  nameEn: string | null;
  onlineNameAr: string | null;
  onlineNameEn: string | null;
  visible: boolean | null;
};

export function readCategoryRow(row: TransferRow): Read<CategoryRowValues> {
  const issues: Omit<TransferIssue, 'row'>[] = [];
  const visible = readYesNo(row['visible'] ?? '');
  if (visible === undefined) issues.push({ column: 'visible', code: 'invalidChoice' });
  return {
    values: {
      nameAr: textOrNull(row['nameAr']),
      nameEn: textOrNull(row['nameEn']),
      onlineNameAr: textOrNull(row['onlineNameAr']),
      onlineNameEn: textOrNull(row['onlineNameEn']),
      visible: visible ?? null,
    },
    issues,
  };
}

/** The catalog's and the store's checks of a category, as sheet issues. */
export function checkCategoryInput(v: CategoryRowValues): Omit<TransferIssue, 'row'>[] {
  const issues: Omit<TransferIssue, 'row'>[] = [];
  for (const parsed of [
    saveCategorySchema.safeParse({ nameAr: v.nameAr, nameEn: v.nameEn }),
    saveStoreCategorySchema.safeParse({ ...v, visible: v.visible ?? true }),
  ])
    if (!parsed.success)
      for (const i of parsed.error.issues) {
        const column = String(i.path[0] ?? 'nameAr');
        const code: TransferIssueCode =
          i.message === 'A category name is required.'
            ? 'nameRequired'
            : i.code === 'too_big'
              ? 'tooLong'
              : 'rejected';
        if (!issues.some((x) => x.column === column && x.code === code))
          issues.push({ column, code, message: i.message });
      }
  return issues;
}

// ------------------------------------------------------------ required, from the schemas
/** A complete, valid row of each sheet; emptying a cell shows whether the schemas need it. */
const SAMPLE: Record<TransferKind, TransferRow> = {
  products: {
    nameAr: 'قهوة',
    nameEn: 'Coffee',
    category: '',
    price: '1.250',
    sku: 'C-1',
    barcodes: '12345678',
    cost: '0.500',
    trackInventory: 'نعم',
    type: 'منتج',
    visible: 'نعم',
    featured: 'لا',
    maxPerOrder: '5',
    descriptionAr: 'وصف',
    descriptionEn: 'Text',
  },
  categories: {
    nameAr: 'مشروبات',
    nameEn: 'Drinks',
    parent: '',
    onlineNameAr: 'مشروبات',
    onlineNameEn: 'Drinks',
    visible: 'نعم',
  },
};

function rowIsValid(kind: TransferKind, row: TransferRow): boolean {
  if (kind === 'products') {
    const read = readProductRow(row);
    return (
      read.issues.length === 0 &&
      checkProductInput(newProductInput(read.values, null)).length === 0 &&
      listingIssues(read.values).length === 0
    );
  }
  const read = readCategoryRow(row);
  return read.issues.length === 0 && checkCategoryInput(read.values).length === 0;
}

function withRequired(kind: TransferKind, specs: ColumnSpec[]): TransferColumn[] {
  return specs.map((spec) => {
    if (spec.kind === 'id' || spec.kind === 'info' || spec.kind === 'category')
      return { ...spec, required: 'no' };
    if (!rowIsValid(kind, { ...SAMPLE[kind], [spec.key]: '' })) return { ...spec, required: 'yes' };
    if (spec.group) {
      const emptied = Object.fromEntries(
        specs.filter((s) => s.group === spec.group).map((s) => [s.key, '']),
      );
      if (!rowIsValid(kind, { ...SAMPLE[kind], ...emptied })) return { ...spec, required: 'oneOf' };
    }
    return { ...spec, required: 'no' };
  });
}

export const TRANSFER_COLUMNS: Record<TransferKind, TransferColumn[]> = {
  products: withRequired('products', PRODUCT_SPECS),
  categories: withRequired('categories', CATEGORY_SPECS),
};

/** Sheet names in the workbook. */
export const TRANSFER_SHEETS: Record<TransferKind, string> = {
  products: 'المنتجات',
  categories: 'التصنيفات',
};

// ----------------------------------------------------------------------------- API
export const transferResultSchema = z.object({
  /** `preview` = nothing written yet; `applied` = written in one transaction. */
  mode: z.enum(['preview', 'applied']),
  counts: z.object({
    created: z.number().int(),
    updated: z.number().int(),
    unchanged: z.number().int(),
  }),
  /** A short list of what changes, row by row (at most 200). */
  rows: z.array(
    z.object({
      row: z.number().int(),
      action: z.enum(['create', 'update']),
      name: z.string(),
    }),
  ),
  issues: z.array(
    z.object({
      row: z.number().int(),
      column: z.string(),
      code: z.enum(TRANSFER_ISSUE_CODES),
      message: z.string().optional(),
    }),
  ),
});
export type TransferResult = z.infer<typeof transferResultSchema>;
