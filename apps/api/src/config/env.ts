import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Environment variables of the API. Invalid configuration aborts startup (fail fast). */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanString.default(false),
  /** Runtime connection (role `app_runtime`, no BYPASSRLS). */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Owner connection (role `app_owner`) used only by migrations and seeds. */
  DATABASE_OWNER_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(15000),
  /** When true, the API also serves the built SPAs under /manager, /pos and /platform. */
  SERVE_WEB: booleanString.default(false),
  APP_VERSION: z.string().default('0.1.0'),

  /** Session cookies get the Secure flag. Defaults to true in production. */
  COOKIE_SECURE: booleanString.optional(),
  /** Extra origins allowed to send state-changing requests (comma separated). */
  TRUSTED_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  /** Multiplies every authentication rate limit (e.g. 50 for E2E runs). */
  AUTH_RATE_LIMIT_SCALE: z.coerce.number().positive().default(1),
  /** 32-byte key (base64) encrypting platform operators' TOTP secrets. */
  MFA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 encoded'),

  /** Outgoing e-mail. Local development uses Mailpit (no paid provider). */
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Arabat POS <no-reply@arabat.local>'),
  /** Public URLs of the apps, used in e-mail links (password reset). */
  PUBLIC_MANAGER_URL: z.url().default('http://localhost:5173/manager'),
  PUBLIC_POS_URL: z.url().default('http://localhost:5174/pos'),
  /** Public URL of the storefront app (payment return links). */
  PUBLIC_STORE_URL: z.url().default('http://localhost:5176/store'),
  /**
   * The mock payment gateway (test payments, no money moves). Off by default in
   * production; real gateways (Tap, UPayments, Hesabe, Bookeey) are never live without
   * approval and tested credentials (ADR-0078).
   */
  PAYMENT_MOCK_ENABLED: booleanString.optional(),
  /** Secret signing mock gateway webhooks (HMAC-SHA256). */
  PAYMENT_MOCK_SECRET: z.string().min(16).default('dev-only-mock-gateway-secret'),
  /** Local directory for uploaded files (product images). */
  FILE_STORAGE_DIR: z.string().default('var/uploads'),
});

export type Env = z.infer<typeof envSchema>;

export function mockPaymentsEnabled(env: Env): boolean {
  return env.PAYMENT_MOCK_ENABLED ?? env.NODE_ENV !== 'production';
}

export function cookieSecure(env: Env): boolean {
  return env.COOKIE_SECURE ?? env.NODE_ENV === 'production';
}

export class InvalidEnvironmentError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n  ${issues.join('\n  ')}`);
    this.name = 'InvalidEnvironmentError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
