import { branches } from '../../modules/branches/branches.schema.js';
import { ensureDefaultRegister } from '../../modules/payments/merchant-defaults.js';
import type { Seed } from './seed.types.js';

/**
 * Gives every branch created before Prompt 9 one register (payment methods: `004`). Never changes existing configuration. Runs as app_owner; idempotent.
 */
export const paymentDefaultsSeed: Seed = {
  name: '003-payment-defaults',
  environments: ['development', 'test', 'production'],
  async run(tx) {
    let registers = 0;
    for (const b of await tx
      .select({ id: branches.id, merchantId: branches.merchantId })
      .from(branches)) {
      registers += await ensureDefaultRegister(tx, b.merchantId, b.id);
    }
    return `${registers} registers added`;
  },
};
