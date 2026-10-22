import { type ReceiptData, renderReceiptHtml } from '@arabat/pos-core';
import type { LocalSale } from './sales.js';
import type { LocalContext, StaffMember } from './snapshot.js';

const ar = (nameAr: string | null, nameEn: string | null) =>
  (nameAr || nameEn || null)?.trim() || null;

/** The printed receipt of a local sale: the same document the server prints (ADR-0111). */
export function receiptDataFor(
  sale: LocalSale,
  ctx: LocalContext,
  cashier: StaffMember | null,
): ReceiptData {
  return {
    merchantName: ar(ctx.merchant.nameAr, ctx.merchant.nameEn),
    branchName: ar(ctx.branch.nameAr, ctx.branch.nameEn),
    branchPhone: ctx.branch.phone?.trim() || null,
    branchAddress: ctx.branch.address?.trim() || null,
    receiptHeader: ctx.branch.receiptHeader?.trim() || null,
    receiptFooter: ctx.branch.receiptFooter?.trim() || null,
    receiptNumber: sale.receiptNumber,
    onlineOrderNumber: null,
    fulfillment: null,
    createdAt: new Date(sale.occurredAt),
    timezone: ctx.merchant.timezone,
    cashierName: cashier?.fullName ?? null,
    registerName: ctx.device.name || ctx.device.code,
    customerName: null,
    customerPhone: null,
    customerAddress: null,
    note: null,
    lines: sale.lines.map((l) => {
      const variant = ar(l.variantNameAr, l.variantNameEn);
      const name = ar(l.nameAr, l.nameEn) ?? '';
      return {
        name: variant ? `${name} — ${variant}` : name,
        modifiers: [],
        quantity: l.quantity.replace(/\.?0+$/, ''),
        unitPriceMinor: l.unitPriceMinor,
        regularUnitPriceMinor: l.regularUnitPriceMinor,
        grossMinor: l.grossMinor,
        lineDiscountMinor: l.lineDiscountMinor,
      };
    }),
    subtotalMinor: sale.subtotalMinor,
    discountsMinor: sale.lineDiscountsMinor + sale.orderDiscountMinor,
    totalMinor: sale.totalMinor,
    payments: sale.payments.map((p) => ({
      name: ar(p.nameAr, p.nameEn) ?? '',
      amountMinor: p.tenderedMinor ?? p.amountMinor,
    })),
    changeMinor: sale.changeMinor,
  };
}

export function receiptHtmlFor(
  sale: LocalSale,
  ctx: LocalContext,
  cashier: StaffMember | null,
  printedAt = new Date(),
  copyNumber = 0,
): string {
  return renderReceiptHtml(receiptDataFor(sale, ctx, cashier), printedAt, copyNumber);
}
