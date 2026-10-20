import { Money } from '@arabat/money';
import { receiptHtmlParts as h } from './receipt-html.js';

/** What the branch needs to prepare an online order (packing slip / kitchen ticket, ADR-0123). */
export type OrderSlipData = {
  merchantName: string | null;
  branchName: string | null;
  orderNumber: string;
  status: string;
  fulfillment: string;
  paymentMode: string;
  paid: boolean;
  createdAt: Date;
  scheduledFor: Date | null;
  timezone: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string | null;
  deliveryAreaName: string | null;
  note: string | null;
  lines: { name: string; sku: string | null; quantity: string; lineTotalMinor: bigint }[];
  subtotalMinor: bigint;
  deliveryFeeMinor: bigint;
  totalMinor: bigint;
};

const STATUS: Record<string, string> = {
  placed: 'جديد',
  confirmed: 'مؤكد',
  paid: 'مدفوع',
  preparing: 'قيد التجهيز',
  ready: 'جاهز',
  out_for_delivery: 'خرج للتوصيل',
};

/**
 * The order slip as one self-contained HTML document, in the receipt's style: big order
 * number, when it is wanted, who and where, the items with quantities, and whether the
 * money is still to be collected.
 */
export function renderOrderSlipHtml(data: OrderSlipData, printedAt: Date): string {
  const header = [
    `<p class="company" dir="auto">${h.escape(data.merchantName ?? '')}</p>`,
    h.block(data.branchName),
    `<p class="center big">طلب إلكتروني</p>`,
  ].join('');
  const order = [
    h.row('رقم الطلب', data.orderNumber, { ltr: true, cls: 'big' }),
    h.row('الحالة', STATUS[data.status] ?? data.status),
    h.row('نوع الطلب', h.FULFILLMENT[data.fulfillment] ?? data.fulfillment),
    h.row('وقت الطلب', h.dateTime(data.createdAt, data.timezone), { ltr: true }),
    h.row(
      'الموعد المطلوب',
      data.scheduledFor ? h.dateTime(data.scheduledFor, data.timezone) : 'في أقرب وقت',
      { ltr: Boolean(data.scheduledFor), cls: 'big' },
    ),
  ].join('');
  const customer = [
    h.row('العميل', data.customerName),
    h.row('الهاتف', data.customerPhone, { ltr: true }),
    h.row('المنطقة', data.deliveryAreaName),
    h.row('العنوان', data.deliveryAddress),
  ].join('');
  const items = data.lines
    .map(
      (l) =>
        `<div class="item"><div class="row"><span class="k big" dir="ltr">${h.escape(l.quantity)} ×</span><span class="v" dir="auto">${h.escape(l.name)}</span></div>` +
        (l.sku ? `<p class="mods" dir="ltr">${h.escape(l.sku)}</p>` : '') +
        `</div>`,
    )
    .join('');
  const totals = [
    h.row('المجموع', h.kwd(data.subtotalMinor), { ltr: true }),
    data.deliveryFeeMinor > 0n
      ? h.row('رسوم التوصيل', h.kwd(data.deliveryFeeMinor), { ltr: true })
      : '',
    h.row('الإجمالي', h.kwd(data.totalMinor), { ltr: true, cls: 'big' }),
    h.row(
      'الدفع',
      data.paid
        ? 'مدفوع'
        : data.paymentMode === 'on_receipt'
          ? `يُحصّل عند التسليم: ${Money.ofMinor(data.totalMinor, 'KWD').toDecimalString()} د.ك`
          : 'بانتظار الدفع الإلكتروني',
      { cls: 'big' },
    ),
  ].join('');
  return [
    '<!doctype html>',
    '<html lang="ar" dir="rtl"><head><meta charset="utf-8">',
    `<title>${h.escape(data.orderNumber)}</title>`,
    `<style>${h.STYLE}</style></head><body>`,
    header,
    h.section(order),
    h.section(customer),
    h.section(items),
    h.section(totals),
    h.section(h.block(data.note ? `ملاحظات: ${data.note}` : null, 'pre')),
    h.section(
      `<p class="printed">وقت الطباعة <bdi dir="ltr">${h.escape(h.dateTime(printedAt, data.timezone))}</bdi></p>`,
    ),
    '</body></html>',
  ].join('');
}
