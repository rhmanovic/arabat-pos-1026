import { merchants } from '../../modules/merchants/merchants.schema.js';
import { ensureDefaultPaymentSetup } from '../../modules/payments/merchant-defaults.js';
import type { Seed } from './seed.types.js';

/**
 * Gives merchants without any bank or other non-custody account the default payment setup
 * (ADR-0089): two bank accounts and Cash / KNET / Visa-Mastercard / payment link / WAMD, the
 * card-type methods linked to a bank (cash settles into register drawers, ADR-0090).
 * Merchants that already have such an account are untouched. Idempotent.
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
