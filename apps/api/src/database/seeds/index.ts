import { currenciesSeed } from './001-currencies.js';
import type { Seed } from './seed.types.js';

/** Seeds run in this order. Development demo data (merchants, users) is added in M1. */
export const SEEDS: readonly Seed[] = [currenciesSeed];
