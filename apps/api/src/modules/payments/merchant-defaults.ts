import { sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
import { registers } from '../registers/registers.schema.js';
import { paymentMethods } from './payments.schema.js';

/**
 * Starting configuration of a new merchant (Prompt 9): Cash, Card and Bank transfer
 * without fees, all editable. Idempotent: existing methods are never changed.
 */
export async function ensureDefaultPaymentMethods(tx: Transaction, merchantId: string) {
  const existing = await tx.execute(
    sql`select 1 from payment_methods where merchant_id = ${merchantId} limit 1`,
  );
  if (existing.rows.length > 0) return 0;
  const defaults = [
    { kind: 'cash', nameEn: 'Cash', nameAr: 'نقدًا', sortOrder: 0 },
    { kind: 'card', nameEn: 'Card (KNET)', nameAr: 'بطاقة (كي نت)', sortOrder: 1 },
    { kind: 'bank_transfer', nameEn: 'Bank transfer', nameAr: 'تحويل بنكي', sortOrder: 2 },
  ];
  await tx.insert(paymentMethods).values(
    defaults.map((d) => ({
      id: newId(),
      merchantId,
      ...d,
      availableInPos: d.kind !== 'bank_transfer',
    })),
  );
  return defaults.length;
}

/** Every branch starts with one register ("Register 1"). Idempotent. */
export async function ensureDefaultRegister(tx: Transaction, merchantId: string, branchId: string) {
  const existing = await tx.execute(
    sql`select 1 from registers where merchant_id = ${merchantId} and branch_id = ${branchId} limit 1`,
  );
  if (existing.rows.length > 0) return 0;
  await tx.insert(registers).values({
    id: newId(),
    merchantId,
    branchId,
    code: 'R1',
    nameEn: 'Register 1',
    nameAr: 'الصندوق 1',
  });
  return 1;
}
