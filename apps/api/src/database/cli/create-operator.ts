import { PLATFORM_ROLES, type PlatformRole } from '@arabat/permissions';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadEnv } from '../../config/env.js';
import { upsertOperator } from '../../modules/platform-admin/operators.js';

/**
 * Creates or re-keys a platform operator. Prints a one-time password and the TOTP secret.
 *   pnpm --filter @arabat/api run platform:create-operator -- --email a@b.c --name "Name" --role platform.super_admin
 */
const { values } = parseArgs({
  // pnpm forwards the `--` separator as an argument; it is ignored.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'platform.support' },
  },
});
if (!values.email || !values.name || !PLATFORM_ROLES.includes(values.role as PlatformRole)) {
  console.error(`Usage: --email <email> --name <full name> --role <${PLATFORM_ROLES.join('|')}>`);
  process.exit(1);
}

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 });
try {
  const password = randomBytes(12).toString('base64url');
  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const created = await drizzle({ client: pool, casing: 'snake_case' }).transaction((tx) =>
    upsertOperator(tx as never, {
      email: values.email!,
      fullName: values.name!,
      role: values.role as PlatformRole,
      passwordHash,
      encryptionKey: env.MFA_ENCRYPTION_KEY,
    }),
  );
  console.log('Platform operator ready. Share these ONCE through a secure channel:');
  console.log(`  e-mail:      ${values.email}`);
  console.log(`  password:    ${password}`);
  console.log(`  TOTP secret: ${created.totpSecret}`);
  console.log(`  otpauth URI: ${created.otpauthUri}`);
} finally {
  await pool.end();
}
