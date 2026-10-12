/**
 * Start command for managed hosting (Railway; OPERATIONS.md §3). The platform gives one
 * superuser connection (DATABASE_ADMIN_URL); this script:
 *   1. creates or updates the roles app_owner (schema owner, BYPASSRLS) and app_runtime
 *      (API, no BYPASSRLS) with the passwords from APP_OWNER_PASSWORD / APP_RUNTIME_PASSWORD,
 *   2. applies migrations and the reference seeds as app_owner,
 *   3. starts the API as app_runtime — the same separation as Docker Compose and CI.
 * Every step is idempotent, so it runs on every deploy.
 */
import pg from 'pg';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function withUser(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

const adminUrl = required('DATABASE_ADMIN_URL');
const ownerPassword = required('APP_OWNER_PASSWORD');
const runtimePassword = required('APP_RUNTIME_PASSWORD');
if (ownerPassword.length < 16 || runtimePassword.length < 16)
  throw new Error('APP_OWNER_PASSWORD and APP_RUNTIME_PASSWORD need at least 16 characters');

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
try {
  const database = (await admin.query('select current_database() as db')).rows[0].db as string;
  const ident = (v: string) => admin.escapeIdentifier(v);
  const literal = (v: string) => admin.escapeLiteral(v);
  for (const [role, password, extra] of [
    ['app_owner', ownerPassword, 'NOSUPERUSER NOCREATEROLE BYPASSRLS'],
    ['app_runtime', runtimePassword, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'],
  ] as const) {
    const exists = (await admin.query('select 1 from pg_roles where rolname = $1', [role]))
      .rowCount;
    await admin.query(
      `${exists ? 'ALTER' : 'CREATE'} ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)} ${extra}`,
    );
  }
  await admin.query(`REVOKE ALL ON DATABASE ${ident(database)} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${ident(database)} TO app_runtime`);
  await admin.query(`GRANT CONNECT, TEMPORARY, CREATE ON DATABASE ${ident(database)} TO app_owner`);
  await admin.query('ALTER SCHEMA public OWNER TO app_owner');
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  // Extensions need more rights than the schema owner has on managed databases.
  for (const ext of ['citext', 'pg_trgm'])
    await admin.query(`CREATE EXTENSION IF NOT EXISTS ${ident(ext)} SCHEMA public`);
  console.log(`Database roles ready on ${database}.`);
} finally {
  await admin.end();
}

process.env['DATABASE_OWNER_URL'] = withUser(adminUrl, 'app_owner', ownerPassword);
process.env['DATABASE_URL'] = withUser(adminUrl, 'app_runtime', runtimePassword);

const { runMigrations } = await import('../migrate.js');
const { runSeeds } = await import('../seeds/run-seeds.js');
const { SEEDS } = await import('../seeds/index.js');
const { loadEnv } = await import('../../config/env.js');
const env = loadEnv();
const owner = new pg.Pool({ connectionString: env.DATABASE_OWNER_URL, max: 2 });
try {
  await runMigrations(owner);
  for (const r of await runSeeds(owner, env.NODE_ENV, SEEDS))
    console.log(`[${r.status}] ${r.name}: ${r.summary}`);
} finally {
  await owner.end();
}
console.log('Migrations and reference data applied; starting the API.');
await import('../../main.js');
