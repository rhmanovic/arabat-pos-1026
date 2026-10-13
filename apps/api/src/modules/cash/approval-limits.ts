import { Money } from '@arabat/money';
import { eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { salesSettings } from '../sales/sales.schema.js';

const decimal = (minor: bigint) => Money.ofMinor(minor, 'KWD').toDecimalString();

/*
 * Pure helpers for disbursement approvals (BR-166). They import no service, so the shifts
 * service (registers module) and the cash services can share them without a module cycle.
 */

/** The company's disbursement approval limits (BR-166) with the engineering defaults. */
export async function approvalLimits(tx: Transaction, merchantId: string) {
  const [row] = await tx
    .select({
      expense: salesSettings.expenseApprovalLimitMinor,
      supplier: salesSettings.supplierPaymentApprovalLimitMinor,
    })
    .from(salesSettings)
    .where(eq(salesSettings.merchantId, merchantId));
  return {
    expenseMinor: row?.expense ?? 20000n,
    supplierPaymentMinor: row?.supplier ?? 100000n,
  };
}

/** Does this disbursement exceed the company's approval limit for its kind? */
export async function exceedsApprovalLimit(
  tx: Transaction,
  merchantId: string,
  kind: 'expense' | 'supplier_payment',
  amountMinor: bigint,
) {
  const limits = await approvalLimits(tx, merchantId);
  return amountMinor > (kind === 'expense' ? limits.expenseMinor : limits.supplierPaymentMinor);
}

/** Above the limit, a disbursement must carry a receipt or invoice reference (FND-420). */
export function assertReceiptReference(receiptReference: string | null | undefined) {
  if (!receiptReference)
    throw AppError.validation([
      {
        path: 'receiptReference',
        code: 'required',
        message: 'Above the approval limit, enter the receipt or invoice reference.',
      },
    ]);
}

/**
 * Ordered value of a purchase order and what has been paid against it, net of reversals
 * (BR-166, FND-602). Values in minor units.
 */
export async function orderPaymentPosition(tx: Transaction, purchaseOrderId: string) {
  const [row] = (
    await tx.execute(sql`
      select coalesce((select sum(round(l.quantity * l.unit_cost_minor)) from purchase_order_lines l
                       where l.purchase_order_id = ${purchaseOrderId}), 0)::text as total,
             coalesce((select sum(case when d.reverses_id is null then d.amount_minor else -d.amount_minor end)
                       from cash_disbursements d where d.purchase_order_id = ${purchaseOrderId}), 0)::text as paid`)
  ).rows as { total: string; paid: string }[];
  return { totalMinor: BigInt(row!.total), paidMinor: BigInt(row!.paid) };
}

/**
 * Refuses paying more than the order is worth unless the owner confirms it on purpose.
 * Returns whether an overpayment was confirmed (for the audit trail).
 */
export async function assertNotOverpaid(
  tx: Transaction,
  actor: MerchantActor,
  purchaseOrderId: string,
  amountMinor: bigint,
  confirmOverpayment: boolean | undefined,
): Promise<boolean> {
  const position = await orderPaymentPosition(tx, purchaseOrderId);
  if (position.paidMinor + amountMinor <= position.totalMinor) return false;
  if (confirmOverpayment && actor.access.isOwner) return true;
  throw new AppError(
    409,
    'ORDER_OVERPAID',
    `This payment would exceed the order's value: ordered ${decimal(position.totalMinor)}, paid to date ${decimal(position.paidMinor)}, this payment ${decimal(amountMinor)} KWD.`,
  );
}
