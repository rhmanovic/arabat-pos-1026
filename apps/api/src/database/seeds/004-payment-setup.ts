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
    return `${set} merchants given the default payment setup`;
  },
};
