import { SEEDS } from '../seeds/index.js';
import { runSeeds } from '../seeds/run-seeds.js';
import { createOwnerPool } from './owner-pool.js';

const { env, pool } = createOwnerPool();
try {
  const results = await runSeeds(pool, env.NODE_ENV, SEEDS);
  for (const r of results) console.log(`[${r.status}] ${r.name}: ${r.summary}`);
} catch (error) {
  console.error('Seeding failed (nothing was written):', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
