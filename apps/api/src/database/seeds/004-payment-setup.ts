import { sql } from 'drizzle-orm';
import { merchants } from '../../modules/merchants/merchants.schema.js';
import { ensureDefaultPaymentSetup } from '../../modules/payments/merchant-defaults.js';
import type { Seed } from './seed.types.js';

/**
 * Gives merchants without any internal balance the default payment setup (ADR-0089): cash
 * box, two bank accounts, Cash / KNET / Visa-Mastercard / payment link / WAMD, each linked to
 * a balance. Merchants that already have an internal balance are untouched. Idempotent.
 */
export const paymentSetupSeed: Seed = {
  name: '004-payment-setup',
  environments: ['development', 'test', 'production'],
  async run(tx) {
    let set = 0;
    for (const { id } of await tx.select({ id: merchants.id }).from(merchants)) {
      if ((await ensureDefaultPaymentSetup(tx, id)).accounts > 0) set++;
    }
    // The first release named the cash account «صندوق النقد» / «Cash box», which reads like
    // the register; rename it where the owner has not edited it (version 1).
    const renamed = await tx.execute(
      sql`update financial_accounts set name_ar = 'الخزينة', name_en = 'Cash on hand'
          where kind = 'cash' and name_ar = 'صندوق النقد' and name_en = 'Cash box' and version = 1`,
    );
    return `${set} merchants given the default payment setup, ${renamed.rowCount ?? 0} cash accounts renamed`;
  },
};
