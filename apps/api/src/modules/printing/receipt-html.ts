import type { OrderSlipData, ReceiptData } from '@arabat/pos-core';
import { sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';

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
             l.unit_price_minor::text, l.regular_unit_price_minor::text, l.gross_minor::text, l.line_discount_minor::text,
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
        regularUnitPriceMinor:
          l['regular_unit_price_minor'] === null
            ? null
            : BigInt(l['regular_unit_price_minor'] as string),
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

/** Reads an online order for its packing slip (ADR-0123), inside the caller's transaction. */
export async function loadOrderSlipData(tx: Transaction, orderId: string): Promise<OrderSlipData> {
  const [o] = (
    await tx.execute(sql`
      select o.number, o.status, o.fulfillment, o.payment_mode, o.sale_id, o.created_at, o.scheduled_for,
             o.customer_name, o.customer_phone, o.delivery_address, o.delivery_area_name, o.note,
             o.subtotal_minor::text, o.discount_minor::text, o.delivery_fee_minor::text, o.total_minor::text,
             m.display_name_en, m.display_name_ar, m.timezone, b.name_en as b_en, b.name_ar as b_ar
      from online_orders o join merchants m on m.id = o.merchant_id join branches b on b.id = o.branch_id
      where o.id = ${orderId}`)
  ).rows as Record<string, unknown>[];
  if (!o) throw new Error(`Online order ${orderId} not found.`);
  const lines = (
    await tx.execute(sql`
      select name_en, name_ar, variant_name_en, variant_name_ar, sku, quantity::text, line_total_minor::text
      from online_order_lines where order_id = ${orderId} order by position`)
  ).rows as Record<string, unknown>[];
  return {
    merchantName: ar(o['display_name_ar'], o['display_name_en']),
    branchName: ar(o['b_ar'], o['b_en']),
    orderNumber: o['number'] as string,
    status: o['status'] as string,
    fulfillment: o['fulfillment'] as string,
    paymentMode: o['payment_mode'] as string,
    paid: o['sale_id'] !== null,
    createdAt: new Date(o['created_at'] as string),
    scheduledFor: o['scheduled_for'] ? new Date(o['scheduled_for'] as string) : null,
    timezone: o['timezone'] as string,
    customerName: o['customer_name'] as string,
    customerPhone: o['customer_phone'] as string,
    deliveryAddress: (o['delivery_address'] as string | null) ?? null,
    deliveryAreaName: (o['delivery_area_name'] as string | null) ?? null,
    note: (o['note'] as string | null) ?? null,
    lines: lines.map((l) => ({
      name: [ar(l['name_ar'], l['name_en']), ar(l['variant_name_ar'], l['variant_name_en'])]
        .filter(Boolean)
        .join(' — '),
      sku: (l['sku'] as string | null) ?? null,
      quantity: String(l['quantity']).replace(/\.?0+$/, ''),
      lineTotalMinor: BigInt(l['line_total_minor'] as string),
    })),
    subtotalMinor: BigInt(o['subtotal_minor'] as string),
    discountMinor: BigInt(o['discount_minor'] as string),
    deliveryFeeMinor: BigInt(o['delivery_fee_minor'] as string),
    totalMinor: BigInt(o['total_minor'] as string),
  };
}

export { renderOrderSlipHtml, renderReceiptHtml, type ReceiptData } from '@arabat/pos-core';
