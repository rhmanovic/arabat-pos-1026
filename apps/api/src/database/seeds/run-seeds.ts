import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { Env } from '../../config/env.js';
import * as schema from '../schema/index.js';
import type { Seed } from './seed.types.js';

export interface SeedResult {
  name: string;
  status: 'applied' | 'skipped';
  summary: string;
}

/** Runs all seeds allowed for the environment in one transaction (all or nothing). */
export async function runSeeds(
  pool: pg.Pool,
  nodeEnv: Env['NODE_ENV'],
  seeds: readonly Seed[],
): Promise<SeedResult[]> {
  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return db.transaction(async (tx) => {
    const results: SeedResult[] = [];
    for (const seed of seeds) {
      if (!seed.environments.includes(nodeEnv)) {
        results.push({ name: seed.name, status: 'skipped', summary: `not allowed in ${nodeEnv}` });
        continue;
      }
      results.push({ name: seed.name, status: 'applied', summary: await seed.run(tx) });
    }
    return results;
  });
}
