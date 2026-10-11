import { currenciesSeed } from './001-currencies.js';
import { devDemoMerchantsSeed } from './100-dev-demo-merchants.js';
import type { Seed } from './seed.types.js';

/** Seeds run in this order. Seeds numbered 100+ are development-only demo data. */
export const SEEDS: readonly Seed[] = [currenciesSeed, devDemoMerchantsSeed];
