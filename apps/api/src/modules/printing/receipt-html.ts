import { Money } from '@arabat/money';
import { sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';

/** Everything a printed receipt shows. Empty fields are left out of the document. */
export type ReceiptData = {
  merchantName: string | null;
  branchName: string | null;
  branchPhone: string | null;
  branchAddress: string | null;
  receiptHeader: string | null;
  receiptFooter: string | null;
  receiptNumber: string;
  onlineOrderNumber: string | null;
  fulfillment: string | null;
  createdAt: Date;
  timezone: string;
  cashierName: string | null;
  registerName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  note: string | null;
  lines: {
    name: string;
    modifiers: string[];
    quantity: string;
    unitPriceMinor: bigint;
    grossMinor: bigint;
    lineDiscountMinor: bigint;
  }[];
  subtotalMinor: bigint;
  discountsMinor: bigint;
  totalMinor: bigint;
  payments: { name: string; amountMinor: bigint }[];
  changeMinor: bigint;
};

const ar = (nameAr: unknown, nameEn: unknown): string | null =>
  ((nameAr as string | null) || (nameEn as string | null) || null)?.trim() || null;

/**
 * Reads a sale for its printed receipt inside the caller's transaction (the sale may not be
 * committed yet). `onlineOrderId` links an online order whose `sale_id` is set after the sale.
 */
export async function loadReceiptData(
  tx: Transaction,
  saleId: string,
  onlineOrderId: string | null = null,
): Promise<ReceiptData> {
  const [s] = (
    await tx.execute(sql`
      select s.receipt_number, s.created_at, s.subtotal_minor::text, s.line_discounts_minor::text,
             s.order_discount_minor::text, s.total_minor::text, s.change_minor::text,
             m.display_name_en, m.display_name_ar, m.timezone,
             b.name_en as b_en, b.name_ar as b_ar, b.phone as b_phone, b.address as b_address,
             b.receipt_header, b.receipt_footer, r.code as r_code, r.name_en as r_en, r.name_ar as r_ar,
             u.full_name as cashier, c.full_name as c_name, c.phone as c_phone, c.address as c_address,
             o.number as o_number, o.fulfillment, o.customer_name as o_name,
             o.customer_phone as o_phone, o.delivery_address, o.note as o_note
      from sales s join merchants m on m.id = s.merchant_id join branches b on b.id = s.branch_id
      left join registers r on r.id = s.register_id left join users u on u.id = s.user_id
      left join customers c on c.id = s.customer_id
      left join online_orders o on o.id = coalesce(${onlineOrderId}::uuid,
        (select oo.id from online_orders oo where oo.sale_id = s.id limit 1))
      where s.id = ${saleId}`)
  ).rows as Record<string, unknown>[];
  if (!s) throw new Error(`Sale ${saleId} not found for its receipt`);
  const lines = (
    await tx.execute(sql`
      select l.position, l.name_en, l.name_ar, l.variant_name_en, l.variant_name_ar, l.quantity::text,
             l.unit_price_minor::text, l.gross_minor::text, l.line_discount_minor::text,
             coalesce((select array_agg(coalesce(nullif(md.name_ar, ''), md.name_en) order by md.name_en)
                       from sale_line_modifiers md where md.sale_id = l.sale_id and md.position = l.position),
                      '{}') as modifiers
      from sale_lines l where l.sale_id = ${saleId} order by l.position`)
  ).rows as Record<string, unknown>[];
  const payments = (
    await tx.execute(sql`
      select method_name_en, method_name_ar, coalesce(tendered_minor, amount_minor)::text as amount
      from payments where sale_id = ${saleId} order by created_at, id`)
  ).rows as Record<string, unknown>[];
  const str = (v: unknown) => ((v as string | null) ?? '').trim() || null;
  return {
    merchantName: ar(s['display_name_ar'], s['display_name_en']),
    branchName: ar(s['b_ar'], s['b_en']),
    branchPhone: str(s['b_phone']),
    branchAddress: str(s['b_address']),
    receiptHeader: str(s['receipt_header']),
    receiptFooter: str(s['receipt_footer']),
    receiptNumber: s['receipt_number'] as string,
    onlineOrderNumber: str(s['o_number']),
    fulfillment: str(s['fulfillment']),
    createdAt: new Date(s['created_at'] as string | Date),
    timezone: (s['timezone'] as string | null) ?? 'Asia/Kuwait',
    cashierName: str(s['cashier']),
    registerName: ar(s['r_ar'], s['r_en']) ?? str(s['r_code']),
    customerName: str(s['o_name']) ?? str(s['c_name']),
    customerPhone: str(s['o_phone']) ?? str(s['c_phone']),
    customerAddress: str(s['delivery_address']) ?? str(s['c_address']),
    note: str(s['o_note']),
    lines: lines.map((l) => {
      const variant = ar(l['variant_name_ar'], l['variant_name_en']);
      const name = ar(l['name_ar'], l['name_en']) ?? '';
      return {
        name: variant ? `${name} — ${variant}` : name,
        modifiers: (l['modifiers'] as string[]).filter(Boolean),
        quantity: (l['quantity'] as string).replace(/\.?0+$/, ''),
        unitPriceMinor: BigInt(l['unit_price_minor'] as string),
        grossMinor: BigInt(l['gross_minor'] as string),
        lineDiscountMinor: BigInt(l['line_discount_minor'] as string),
      };
    }),
    subtotalMinor: BigInt(s['subtotal_minor'] as string),
    discountsMinor:
      BigInt(s['line_discounts_minor'] as string) + BigInt(s['order_discount_minor'] as string),
    totalMinor: BigInt(s['total_minor'] as string),
    payments: payments.map((p) => ({
      name: ar(p['method_name_ar'], p['method_name_en']) ?? '',
      amountMinor: BigInt(p['amount'] as string),
    })),
    changeMinor: BigInt(s['change_minor'] as string),
  };
}

const FULFILLMENT: Record<string, string> = {
  delivery: 'توصيل',
  pickup: 'استلام من الفرع',
};

function escape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const kwd = (minor: bigint) => `${Money.ofMinor(minor, 'KWD').toDecimalString()} د.ك`;

/** "16/10/2026 15:37" in the merchant's zone: plain digits, so it never reorders in RTL text. */
function dateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(',', '');
}

/** A label / value row; null values are skipped. `ltr` keeps numbers and codes in order. */
function row(label: string, value: string | null, options: { ltr?: boolean; cls?: string } = {}) {
  if (!value) return '';
  const dir = options.ltr ? 'ltr' : 'auto';
  return `<div class="row${options.cls ? ` ${options.cls}` : ''}"><span class="k">${escape(label)}</span><span class="v" dir="${dir}">${escape(value)}</span></div>`;
}

const block = (text: string | null, cls = 'center') =>
  text ? `<p class="${cls}" dir="auto">${escape(text)}</p>` : '';

const section = (body: string) => (body ? `<section>${body}</section>` : '');

const STYLE = `
@page { size: 72mm 210mm; margin: 0; }
* { box-sizing: border-box; color: #000; background: transparent; box-shadow: none; text-shadow: none; }
html { background: #fff; }
body { width: 72mm; margin: 0; padding: 2mm 3mm; font-family: Arial, sans-serif; font-size: 12px;
  line-height: 1.35; color: #000; background: #fff; -webkit-print-color-adjust: economy; print-color-adjust: economy; }
p { margin: 0; overflow-wrap: anywhere; }
.center { text-align: center; }
.pre { white-space: pre-wrap; text-align: center; }
.company { font-size: 16px; font-weight: 700; text-align: center; }
section { border-top: 1px dashed #000; margin-top: 1.5mm; padding-top: 1.5mm; }
.row { display: flex; justify-content: space-between; align-items: flex-start; gap: 2mm; break-inside: avoid; }
.row .k { flex: 0 0 auto; max-width: 50%; }
/* The document is right to left: labels on the right, values flush with the left edge. */
.row .v { flex: 1 1 auto; min-width: 0; text-align: left; overflow-wrap: anywhere; }
.big { font-size: 15px; font-weight: 700; }
.item { break-inside: avoid; padding: 0.5mm 0; }
.mods { font-size: 11px; padding-inline-start: 2mm; }
.printed { font-size: 11px; text-align: center; }
`;

/**
 * The receipt as one self-contained HTML document (ADR-0111): inline style, no external
 * resources, UTF-8, right to left, 72 mm wide, black only, for an 80 mm thermal printer.
 */
export function renderReceiptHtml(data: ReceiptData, printedAt: Date, copy = false): string {
  const header = [
    `<p class="company" dir="auto">${escape(data.merchantName ?? '')}</p>`,
    block(data.branchName),
    block(data.branchAddress),
    data.branchPhone ? `<p class="center" dir="ltr">${escape(data.branchPhone)}</p>` : '',
    data.receiptHeader ? block(data.receiptHeader, 'pre') : '',
    copy ? `<p class="center big">نسخة</p>` : '',
  ].join('');
  const order = [
    row('رقم الإيصال', data.receiptNumber, { ltr: true, cls: 'big' }),
    row('رقم الطلب', data.onlineOrderNumber, { ltr: true, cls: 'big' }),
    row('التاريخ', dateTime(data.createdAt, data.timezone), { ltr: true }),
    row('الفرع', data.branchName),
    row('الصندوق', data.registerName),
    row('الكاشير', data.cashierName),
    row('نوع الطلب', data.fulfillment ? (FULFILLMENT[data.fulfillment] ?? data.fulfillment) : null),
  ].join('');
  const customer = [
    row('العميل', data.customerName),
    row('الهاتف', data.customerPhone, { ltr: true }),
    row('العنوان', data.customerAddress),
  ].join('');
  const items = data.lines
    .map(
      (l) =>
        `<div class="item"><p dir="auto">${escape(l.name)}</p>` +
        (l.modifiers.length
          ? `<p class="mods" dir="auto">${escape(l.modifiers.join('، '))}</p>`
          : '') +
        `<div class="row"><span class="k" dir="ltr">${escape(l.quantity)} × ${Money.ofMinor(l.unitPriceMinor, 'KWD').toDecimalString()}</span><span class="v" dir="ltr">${Money.ofMinor(l.grossMinor, 'KWD').toDecimalString()}</span></div>` +
        (l.lineDiscountMinor > 0n
          ? row('خصم', `-${Money.ofMinor(l.lineDiscountMinor, 'KWD').toDecimalString()}`, {
              ltr: true,
            })
          : '') +
        `</div>`,
    )
    .join('');
  const totals = [
    row('المجموع', kwd(data.subtotalMinor), { ltr: true }),
    data.discountsMinor > 0n ? row('الخصومات', `-${kwd(data.discountsMinor)}`, { ltr: true }) : '',
    row('الإجمالي', kwd(data.totalMinor), { ltr: true, cls: 'big' }),
    ...data.payments.map((p) => row(p.name, kwd(p.amountMinor), { ltr: true })),
    data.changeMinor > 0n ? row('الباقي للعميل', kwd(data.changeMinor), { ltr: true }) : '',
  ].join('');
  const footer = data.receiptFooter ? block(data.receiptFooter, 'pre') : block('شكرًا لزيارتكم');
  return [
    '<!doctype html>',
    '<html lang="ar" dir="rtl"><head><meta charset="utf-8">',
    `<title>${escape(data.receiptNumber)}</title>`,
    `<style>${STYLE}</style></head><body>`,
    header,
    section(order),
    section(customer),
    section(items),
    section(totals),
    section(block(data.note ? `ملاحظات: ${data.note}` : null, 'pre')),
    section(footer),
    section(
      `<p class="printed">وقت الطباعة <bdi dir="ltr">${escape(dateTime(printedAt, data.timezone))}</bdi></p>`,
    ),
    '</body></html>',
  ].join('');
}
