import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createOwnerPool } from './owner-pool.js';
import { resetOperatorPassword } from '../../modules/platform-admin/operators.js';

/**
 * Gives an existing platform operator a new one-time password and keeps the TOTP secret, so the
 * authenticator app already set up keeps working (OPERATIONS.md §9.2).
 *   node apps/api/dist/database/cli/reset-operator-password.js --email a@b.c
 */
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: { email: { type: 'string' } },
});
if (!values.email) {
  console.error('Usage: --email <operator e-mail>');
  process.exit(1);
}

const { pool } = createOwnerPool();
try {
  const password = randomBytes(12).toString('base64url');
  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const reset = await drizzle({ client: pool, casing: 'snake_case' }).transaction((tx) =>
    resetOperatorPassword(tx as never, { email: values.email!, passwordHash }),
  );
  if (!reset) {
    console.error(`No platform operator with the e-mail ${values.email}. Nothing was changed.`);
    process.exitCode = 1;
  } else {
    console.log('Password reset; the authenticator (TOTP) is unchanged. Share ONCE, securely:');
    console.log(`  e-mail:   ${values.email}`);
    console.log(`  password: ${password}`);
  }
} finally {
  await pool.end();
}
