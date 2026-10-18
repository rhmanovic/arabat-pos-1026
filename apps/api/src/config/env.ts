import { createHash } from 'node:crypto';
import { z } from 'zod';

const DEV_MOCK_SECRET_DEFAULT = 'dev-only-mock-gateway-secret';
/** Mailpit from docker compose; in production this default means "no e-mail delivery". */
export const SMTP_URL_LOCAL_DEFAULT = 'smtp://localhost:1025';

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

  /**
   * Outgoing e-mail (password reset, invitations, account set-up). `smtp` sends through
   * `SMTP_URL` (Mailpit in local development); `resend` and `brevo` send through the
   * provider's HTTP API with `MAIL_API_KEY`, which hosting platforms that block outbound
   * SMTP need (Railway below the Pro plan, ADR-0106).
   */
  MAIL_PROVIDER: z.enum(['smtp', 'resend', 'brevo']).default('smtp'),
  MAIL_API_KEY: z.string().trim().min(1).optional(),
  SMTP_URL: z.string().default(SMTP_URL_LOCAL_DEFAULT),
  MAIL_FROM: z.string().default('Arabat POS <no-reply@arabat.local>'),
  /** Public URLs of the apps, used in e-mail links (password reset). */
  PUBLIC_MANAGER_URL: z.url().default('http://localhost:5173/manager'),
  PUBLIC_POS_URL: z.url().default('http://localhost:5174/pos'),
  /** Receives the purchase requests sent from the public pricing page (ADR-0114). */
  SALES_NOTIFY_EMAIL: z.email().default('info@arabatapp.com'),
  /** Public URL of the storefront app (payment return links). */
  PUBLIC_STORE_URL: z.url().default('http://localhost:5176/store'),
  /**
   * The mock payment gateway (test payments, no money moves). Off by default in
   * production; real gateways (Tap, UPayments, Hesabe, Bookeey) are never live without
   * approval and tested credentials (ADR-0078).
   */
  PAYMENT_MOCK_ENABLED: booleanString.optional(),
  /** Secret signing mock gateway webhooks (HMAC-SHA256). */
  PAYMENT_MOCK_SECRET: z.string().min(16).default(DEV_MOCK_SECRET_DEFAULT),
  /**
   * Which proxies may set X-Forwarded-For (client IP for rate limits and audit). `false`
   * (default) ignores the header; behind a load balancer set the hop count (e.g. `1`) or
   * its addresses/CIDRs (comma separated). Never `true`: clients could fake their IP.
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v, ctx) => {
      const value = v.trim();
      if (value === 'false' || value === '') return false as const;
      if (/^\d+$/.test(value)) return Number(value);
      if (value === 'true') {
        ctx.addIssue({ code: 'custom', message: 'use a hop count or proxy addresses, not true' });
        return z.NEVER;
      }
      return value.split(',').map((s) => s.trim());
    }),
  /** Where uploaded files (product images) live: local disk or Google Cloud Storage. */
  FILE_STORAGE_DRIVER: z.enum(['local', 'gcs']).default('local'),
  /** Local directory for uploaded files (FILE_STORAGE_DRIVER=local). */
  FILE_STORAGE_DIR: z.string().default('var/uploads'),
  /** Bucket for uploaded files (FILE_STORAGE_DRIVER=gcs), e.g. `arabat-prod-uploads`. */
  GCS_BUCKET: z.string().min(3).optional(),
  /** Cloud Storage JSON API endpoint (overridden only by tests). */
  GCS_API_URL: z.url().default('https://storage.googleapis.com'),
  /** Access token source: the Cloud Run metadata server (overridden only by tests). */
  GCS_TOKEN_URL: z
    .url()
    .default(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    ),
  /**
   * POS assistant (ADR-0107). Without a key the assistant is off: no request leaves the
   * server and nothing is billed. Set only with the owner's approval (paid usage).
   */
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  ASSISTANT_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),
});

export type Env = z.infer<typeof envSchema>;

const DEV_MOCK_SECRET = DEV_MOCK_SECRET_DEFAULT;
/** Keys published in .env.example / CI; refused in production. */
const DEV_SECRETS = new Set([
  'VFZOJrTc/gBvE/+ElghyAt/0JVSBdrV8+m1D1ZOdSp4=',
  'Y2ktb25seS1rZXktZm9yLXRlc3RzLTMyLWJ5dGVzISE=',
]);

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
  // Hosting platforms generate random strings, not base64 keys: a long random
  // MFA_ENCRYPTION_SECRET is turned into the 32-byte key (SHA-256) when no key is given.
  const secret = source['MFA_ENCRYPTION_SECRET'];
  if (!source['MFA_ENCRYPTION_KEY'] && secret && secret.length >= 32)
    source = {
      ...source,
      MFA_ENCRYPTION_KEY: createHash('sha256').update(secret).digest('base64'),
    };
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvironmentError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const env = result.data;
  if (env.MAIL_PROVIDER !== 'smtp' && !env.MAIL_API_KEY)
    throw new InvalidEnvironmentError([
      `MAIL_API_KEY: required when MAIL_PROVIDER is ${env.MAIL_PROVIDER}`,
    ]);
  // Development secrets must never protect production data (audit finding, Prompt 18).
  if (env.NODE_ENV === 'production') {
    const issues: string[] = [];
    if (DEV_SECRETS.has(env.MFA_ENCRYPTION_KEY))
      issues.push('MFA_ENCRYPTION_KEY: the development key from .env.example cannot be used');
    if (env.FILE_STORAGE_DRIVER === 'gcs' && !env.GCS_BUCKET)
      issues.push('GCS_BUCKET: required when FILE_STORAGE_DRIVER=gcs');
    if (mockPaymentsEnabled(env) && env.PAYMENT_MOCK_SECRET === DEV_MOCK_SECRET)
      issues.push('PAYMENT_MOCK_SECRET: set a real secret when mock payments are enabled');
    if (issues.length > 0) throw new InvalidEnvironmentError(issues);
  }
  return env;
}
