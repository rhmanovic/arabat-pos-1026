import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { rateLimitBuckets } from './auth.schema.js';

export interface RateLimit {
  limit: number;
  windowSeconds: number;
}

/** Authentication limits (AUTH.md §2.2). Scaled by AUTH_RATE_LIMIT_SCALE. */
export const AUTH_LIMITS = {
  loginPerIp: { limit: 30, windowSeconds: 600 },
  loginFailuresPerEmail: { limit: 10, windowSeconds: 900 },
  registerPerIp: { limit: 10, windowSeconds: 3600 },
  forgotPerIp: { limit: 20, windowSeconds: 3600 },
  forgotPerEmail: { limit: 5, windowSeconds: 3600 },
  resetPerIp: { limit: 20, windowSeconds: 3600 },
  selectPerIp: { limit: 30, windowSeconds: 600 },
  platformLoginPerIp: { limit: 10, windowSeconds: 900 },
  platformFailuresPerEmail: { limit: 5, windowSeconds: 900 },
  mfaPerIp: { limit: 20, windowSeconds: 900 },
} as const satisfies Record<string, RateLimit>;

/**
 * Fixed-window counters stored in PostgreSQL so limits hold across API instances.
 * Keys never contain secrets; e-mail keys are counted whether or not the account exists.
 */
@Injectable()
export class RateLimiterService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Counts one attempt and throws 429 when the limit is exceeded. */
  async consume(key: string, rule: RateLimit): Promise<void> {
    const { count, retryAfter } = await this.increment(key, rule);
    if (count > this.scaled(rule)) throw AppError.rateLimited(retryAfter);
  }

  /** Throws 429 if the key is already over its limit, without counting. */
  async assertNotLimited(key: string, rule: RateLimit): Promise<void> {
    const [row] = await this.database.db
      .select({
        count: rateLimitBuckets.count,
        retryAfter: sql<number>`greatest(1, ceil(extract(epoch from (${rateLimitBuckets.windowStart} + make_interval(secs => ${rule.windowSeconds}) - now()))))::int`,
        active: sql<boolean>`${rateLimitBuckets.windowStart} > now() - make_interval(secs => ${rule.windowSeconds})`,
      })
      .from(rateLimitBuckets)
      .where(eq(rateLimitBuckets.key, key));
    if (row?.active && row.count >= this.scaled(rule)) throw AppError.rateLimited(row.retryAfter);
  }

  /** Counts a failure without throwing (used for per-account failure counters). */
  async hit(key: string, rule: RateLimit): Promise<void> {
    await this.increment(key, rule);
  }

  async reset(key: string): Promise<void> {
    await this.database.db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, key));
  }

  private scaled(rule: RateLimit): number {
    return Math.max(1, Math.floor(rule.limit * this.env.AUTH_RATE_LIMIT_SCALE));
  }

  private async increment(
    key: string,
    rule: RateLimit,
  ): Promise<{ count: number; retryAfter: number }> {
    const window = sql`make_interval(secs => ${rule.windowSeconds})`;
    const result = await this.database.db.execute<{ count: number; retry_after: number }>(sql`
      insert into rate_limit_buckets (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        count = case when rate_limit_buckets.window_start <= now() - ${window} then 1 else rate_limit_buckets.count + 1 end,
        window_start = case when rate_limit_buckets.window_start <= now() - ${window} then now() else rate_limit_buckets.window_start end
      returning count, greatest(1, ceil(extract(epoch from (window_start + ${window} - now()))))::int as retry_after`);
    const row = result.rows[0]!;
    return { count: row.count, retryAfter: row.retry_after };
  }
}
