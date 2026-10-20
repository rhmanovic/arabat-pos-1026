import { Money } from '@arabat/money';

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
/** Building blocks shared with the other printed documents (order slip, ADR-0123). */
export const receiptHtmlParts = { escape, kwd, dateTime, row, block, section, STYLE, FULFILLMENT };

export function renderReceiptHtml(data: ReceiptData, printedAt: Date, copyNumber = 0): string {
  const header = [
    `<p class="company" dir="auto">${escape(data.merchantName ?? '')}</p>`,
    block(data.branchName),
    block(data.branchAddress),
    data.branchPhone ? `<p class="center" dir="ltr">${escape(data.branchPhone)}</p>` : '',
    data.receiptHeader ? block(data.receiptHeader, 'pre') : '',
    copyNumber > 0 ? `<p class="center big">نسخة رقم ${copyNumber}</p>` : '',
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
