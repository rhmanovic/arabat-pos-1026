import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { z } from 'zod';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const uuidSchema = z.uuid();

export function createPool(
  env: Pick<Env, 'DATABASE_URL' | 'DATABASE_POOL_MAX' | 'DATABASE_STATEMENT_TIMEOUT_MS'>,
) {
  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    application_name: 'arabat-api',
  });
}

/**
 * Owns the PostgreSQL connection pool. All business writes go through `withTransaction` or
 * `withMerchantTx`; the latter sets `app.merchant_id` for Row-Level Security (ADR-0004).
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: pg.Pool;
  readonly db: Database;

  constructor(@Inject(ENV) env: Env) {
    this.pool = createPool(env);
    // An idle client error must not crash the process; the pool replaces the client.
    this.pool.on('error', (error) =>
      this.logger.error(`Idle PostgreSQL client error: ${error.message}`),
    );
    this.db = drizzle({ client: this.pool, schema, casing: 'snake_case' });
  }

  /** Round-trip check used by the readiness endpoint. */
  async ping(): Promise<number> {
    const started = performance.now();
    await this.pool.query('select 1');
    return Math.round(performance.now() - started);
  }

  withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /**
   * Runs `work` in a transaction scoped to one merchant. `SET LOCAL` semantics (via
   * set_config(..., true)) guarantee the setting cannot leak to other pooled connections.
   */
  async withMerchantTx<T>(merchantId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    const id = uuidSchema.parse(merchantId);
    return this.db.transaction(async (tx) => {
      await tx.execute(sqlSetMerchant(id));
      return work(tx);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

function sqlSetMerchant(merchantId: string) {
  return sql`select set_config('app.merchant_id', ${merchantId}, true)`;
}
