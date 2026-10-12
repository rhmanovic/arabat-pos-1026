import { branches } from '../../modules/branches/branches.schema.js';
import { merchants } from '../../modules/merchants/merchants.schema.js';
import {
  ensureDefaultPaymentMethods,
  ensureDefaultRegister,
} from '../../modules/payments/merchant-defaults.js';
import type { Seed } from './seed.types.js';

/**
 * Gives merchants created before Prompt 9 the default payment methods and one register per
 * branch. Never changes existing configuration. Runs as app_owner; idempotent.
 */
export const paymentDefaultsSeed: Seed = {
  name: '003-payment-defaults',
  environments: ['development', 'test', 'production'],
  async run(tx) {
    let methods = 0;
    let registers = 0;
    for (const { id } of await tx.select({ id: merchants.id }).from(merchants)) {
      methods += await ensureDefaultPaymentMethods(tx, id);
    }
    for (const b of await tx
      .select({ id: branches.id, merchantId: branches.merchantId })
      .from(branches)) {
      registers += await ensureDefaultRegister(tx, b.merchantId, b.id);
    }
    return `${methods} payment methods and ${registers} registers added`;
  },
};
