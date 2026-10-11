import type { Env } from '../../config/env.js';
import type { Transaction } from '../database.service.js';

export interface Seed {
  /** Unique, ordered name, e.g. "001-currencies". */
  name: string;
  /** Environments in which the seed may run. Demo data must never list "production". */
  environments: ReadonlyArray<Env['NODE_ENV']>;
  /** Must be idempotent: seeds can be re-run at any time. Returns a short summary. */
  run(db: Transaction): Promise<string>;
}
