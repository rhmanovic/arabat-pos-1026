/**
 * Start command for managed hosting (Railway, Google Cloud Run; OPERATIONS.md §8–9). The
 * platform gives one administrative connection (DATABASE_ADMIN_URL); this script:
 *   1. creates or updates the roles app_owner (schema owner) and app_runtime (API) with the
 *      passwords from APP_OWNER_PASSWORD / APP_RUNTIME_PASSWORD (hosted-setup.ts),
 *   2. applies migrations and the reference seeds as app_owner, under an advisory lock so
 *      instances starting together migrate once,
 *   3. starts the API as app_runtime — the same separation as Docker Compose and CI.
 * Every step is idempotent, so it runs on every deploy.
 *
 * `--migrate-only` stops after step 2 (Cloud Run job run before each release);
 * `--roles-only` stops after step 1 (target database of a restore, OPERATIONS.md §9.6).
 */
import pg from 'pg';
import {
  dropOwnerBypass,
  hostedRolesFromEnv,
  prepareRoles,
  withMigrationLock,
  withUser,
} from './hosted-setup.js';

const mode = process.argv.includes('--roles-only')
  ? 'roles'
  : process.argv.includes('--migrate-only')
    ? 'migrate'
    : 'serve';

const adminUrl = process.env['DATABASE_ADMIN_URL'];
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required');
const roles = hostedRolesFromEnv(process.env);

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
try {
  for (const line of await prepareRoles(admin, roles)) console.log(line);
} finally {
  await admin.end();
}
if (mode === 'roles') {
  console.log('Database roles ready; --roles-only, stopping.');
  process.exit(0);
}

process.env['DATABASE_OWNER_URL'] = withUser(adminUrl, 'app_owner', roles.ownerPassword);
process.env['DATABASE_URL'] = withUser(adminUrl, 'app_runtime', roles.runtimePassword);

const { runMigrations } = await import('../migrate.js');
const { runSeeds } = await import('../seeds/run-seeds.js');
const { SEEDS } = await import('../seeds/index.js');
const { loadEnv } = await import('../../config/env.js');
const env = loadEnv();
const owner = new pg.Pool({ connectionString: env.DATABASE_OWNER_URL, max: 3 });
try {
  await withMigrationLock(owner, async () => {
    await runMigrations(owner);
    const cleanup = new pg.Client({ connectionString: adminUrl });
    await cleanup.connect();
    try {
      if (await dropOwnerBypass(cleanup))
        console.log('Removed BYPASSRLS from app_owner (ADR-0105).');
    } finally {
      await cleanup.end();
    }
    for (const r of await runSeeds(owner, env.NODE_ENV, SEEDS))
      console.log(`[${r.status}] ${r.name}: ${r.summary}`);
  });
  const bootstrapEmail = process.env['PLATFORM_BOOTSTRAP_EMAIL'];
  if (bootstrapEmail) {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { bootstrapFirstOperator } = await import('./bootstrap-operator.js');
    const created = await drizzle({ client: owner, casing: 'snake_case' }).transaction((tx) =>
      bootstrapFirstOperator(tx as never, {
        email: bootstrapEmail,
        fullName: process.env['PLATFORM_BOOTSTRAP_NAME'] ?? 'Platform owner',
        encryptionKey: env.MFA_ENCRYPTION_KEY,
      }),
    );
    if (created) {
      // Printed once, to the deploy log only the project's members can read.
      console.log('First platform operator created (platform.super_admin). Sign in at /platform:');
      console.log(`  e-mail:      ${created.email}`);
      console.log(`  password:    ${created.password}`);
      console.log(`  TOTP secret: ${created.totpSecret}`);
      console.log(`  otpauth URI: ${created.otpauthUri}`);
    } else {
      console.log('Platform operators exist; PLATFORM_BOOTSTRAP_EMAIL ignored.');
    }
  }
} finally {
  await owner.end();
}
if (mode === 'migrate') {
  console.log('Migrations and reference data applied; --migrate-only, stopping.');
  process.exit(0);
}
console.log('Migrations and reference data applied; starting the API.');
await import('../../main.js');
