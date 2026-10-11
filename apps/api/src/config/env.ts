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
});

export type Env = z.infer<typeof envSchema>;

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
