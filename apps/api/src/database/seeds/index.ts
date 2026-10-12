import { currenciesSeed } from './001-currencies.js';
import { roleTemplatesSeed } from './002-role-templates.js';
import { paymentDefaultsSeed } from './003-payment-defaults.js';
import { paymentSetupSeed } from './004-payment-setup.js';
import { devDemoMerchantsSeed } from './100-dev-demo-merchants.js';
import type { Seed } from './seed.types.js';

/** Seeds run in this order. Seeds numbered 100+ are development-only demo data. */
export const SEEDS: readonly Seed[] = [
  currenciesSeed,
  devDemoMerchantsSeed,
  roleTemplatesSeed,
  paymentDefaultsSeed,
  paymentSetupSeed,
];
