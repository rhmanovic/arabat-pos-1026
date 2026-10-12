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
    return this.retrying(() => this.db.transaction(work));
  }

  /**
   * Re-runs a whole transaction when PostgreSQL aborted it because of a deadlock or a
   * serialization conflict (audit finding, Prompt 18). The transaction was rolled back, so a
   * re-run is safe; work functions keep external side effects (e-mail, gateways) outside.
   */
  private async retrying<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
        this.logger.warn(`Transaction retried after ${pgCode(error)} (attempt ${attempt})`);
        await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40 * attempt));
      }
    }
  }

  /**
   * Runs `work` in a transaction scoped to one merchant. `SET LOCAL` semantics (via
   * set_config(..., true)) guarantee the setting cannot leak to other pooled connections.
   */
  async withMerchantTx<T>(merchantId: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.withContext({ merchantId }, work);
  }

  /**
   * Transaction with an explicit RLS context. `userId` lets a user read their own
   * memberships (and those merchants) before a merchant context exists (sign-in).
   */
  async withContext<T>(
    context: { merchantId?: string; userId?: string; inviteHash?: Buffer },
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const merchantId = context.merchantId ? uuidSchema.parse(context.merchantId) : '';
    const userId = context.userId ? uuidSchema.parse(context.userId) : '';
    const inviteHash = context.inviteHash ? context.inviteHash.toString('hex') : '';
    return this.retrying(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.merchant_id', ${merchantId}, true), set_config('app.user_id', ${userId}, true),
                   set_config('app.invite_hash', ${inviteHash}, true)`,
        );
        return work(tx);
      }),
    );
  }

  /**
   * Transaction of a platform operator acting on one merchant (ADR-0080): the merchant's RLS
   * context plus `app.operator_id`, which the database requires for subscription and
   * merchant-status changes. Only the platform-admin module calls this.
   */
  async withPlatformContext<T>(
    operatorId: string,
    merchantId: string | null,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const operator = uuidSchema.parse(operatorId);
    const merchant = merchantId ? uuidSchema.parse(merchantId) : '';
    return this.retrying(() =>
      this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.merchant_id', ${merchant}, true), set_config('app.operator_id', ${operator}, true)`,
        );
        return work(tx);
      }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

const MAX_ATTEMPTS = 3;
/** deadlock_detected, serialization_failure */
const RETRYABLE = new Set(['40P01', '40001']);

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

function isRetryable(error: unknown): boolean {
  const code = pgCode(error);
  return code !== undefined && RETRYABLE.has(code);
}
