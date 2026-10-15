/**
 * Database preparation for managed hosting (Railway, Google Cloud SQL; OPERATIONS.md §8–9).
 * The platform gives one administrative connection (DATABASE_ADMIN_URL). On Railway it is
 * a superuser; on Cloud SQL it is `postgres` (member of `cloudsqlsuperuser`): CREATEROLE and
 * CREATEDB, but no SUPERUSER and no BYPASSRLS, which Cloud SQL never grants (ADR-0105).
 * Everything here therefore works without those attributes:
 *   - roles are created with defaults (NOSUPERUSER NOBYPASSRLS) and attributes are only
 *     changed where the admin is allowed to;
 *   - app_owner owns every table, and tables do not force RLS (migration 0048), so the
 *     owner is exempt from RLS without BYPASSRLS while app_runtime is always filtered.
 */
import pg from 'pg';

export type HostedRoles = { ownerPassword: string; runtimePassword: string };

/** Advisory lock keys serialising role setup and migrations when instances start at once. */
export const ROLES_LOCK_KEY = 0x0a2ab46;
export const MIGRATION_LOCK_KEY = 0x0a2ab47;

export function withUser(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}

export function hostedRolesFromEnv(source: Record<string, string | undefined>): HostedRoles {
  const ownerPassword = source['APP_OWNER_PASSWORD'];
  const runtimePassword = source['APP_RUNTIME_PASSWORD'];
  if (!ownerPassword || !runtimePassword)
    throw new Error('APP_OWNER_PASSWORD and APP_RUNTIME_PASSWORD are required');
  if (ownerPassword.length < 16 || runtimePassword.length < 16)
    throw new Error('APP_OWNER_PASSWORD and APP_RUNTIME_PASSWORD need at least 16 characters');
  if (ownerPassword === runtimePassword)
    throw new Error('APP_OWNER_PASSWORD and APP_RUNTIME_PASSWORD must differ');
  return { ownerPassword, runtimePassword };
}

type RoleRow = { rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean };

/**
 * Creates or updates app_owner and app_runtime and the database grants. Idempotent.
 * Returns what was done, for the deploy log.
 */
export async function prepareRoles(admin: pg.Client, roles: HostedRoles): Promise<string[]> {
  await admin.query('select pg_advisory_lock($1)', [ROLES_LOCK_KEY]);
  try {
    return await prepareRolesLocked(admin, roles);
  } finally {
    await admin.query('select pg_advisory_unlock($1)', [ROLES_LOCK_KEY]);
  }
}

async function prepareRolesLocked(admin: pg.Client, roles: HostedRoles): Promise<string[]> {
  const log: string[] = [];
  const ident = (v: string) => admin.escapeIdentifier(v);
  const literal = (v: string) => admin.escapeLiteral(v);
  const me = (
    await admin.query<{ db: string; superuser: boolean }>(
      `select current_database() as db, rolsuper as superuser from pg_roles where rolname = current_user`,
    )
  ).rows[0]!;

  for (const [role, password] of [
    ['app_owner', roles.ownerPassword],
    ['app_runtime', roles.runtimePassword],
  ] as const) {
    const exists = (await admin.query('select 1 from pg_roles where rolname = $1', [role]))
      .rowCount;
    // Only attributes every CREATEROLE admin may set; the defaults are NOSUPERUSER NOBYPASSRLS.
    await admin.query(
      exists
        ? `ALTER ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)}`
        : `CREATE ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)} NOCREATEDB NOCREATEROLE`,
    );
    log.push(`${exists ? 'updated' : 'created'} role ${role}`);
  }

  // Databases set up before ADR-0105 gave app_owner BYPASSRLS. It is no longer needed once
  // migration 0048 has run, so a superuser admin removes it after the migrations
  // (dropOwnerBypass). Anything else is refused: the API must never bypass RLS.
  const runtime = (
    await admin.query<RoleRow>(
      `select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = 'app_runtime'`,
    )
  ).rows[0]!;
  const owner = (
    await admin.query<RoleRow>(
      `select rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname = 'app_owner'`,
    )
  ).rows[0]!;
  if (runtime.rolsuper || runtime.rolbypassrls || runtime.rolcreaterole)
    throw new Error('app_runtime must not be superuser, bypass RLS or create roles');
  if (owner.rolsuper || owner.rolcreaterole)
    throw new Error('app_owner must not be superuser or create roles');

  // PostgreSQL 16+: a non-superuser admin holds ADMIN on the roles it created but may not
  // SET ROLE to them, which ALTER ... OWNER TO needs. Membership without INHERIT gives only that.
  if (!me.superuser) {
    const member = (
      await admin.query(
        `select 1 from pg_auth_members m join pg_roles r on r.oid = m.roleid
          where r.rolname = 'app_owner' and m.member = (select oid from pg_roles where rolname = current_user)
            and m.set_option`,
      )
    ).rowCount;
    if (!member) {
      await admin.query('GRANT app_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE');
      log.push('granted SET ROLE app_owner to the admin user');
    }
  }

  const db = ident(me.db);
  await admin.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO app_runtime`);
  await admin.query(`GRANT CONNECT, TEMPORARY, CREATE ON DATABASE ${db} TO app_owner`);
  await admin.query('ALTER SCHEMA public OWNER TO app_owner');
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  // Trusted extensions: the database owner may create them on managed databases.
  for (const ext of ['citext', 'pg_trgm'])
    await admin.query(`CREATE EXTENSION IF NOT EXISTS ${ident(ext)} SCHEMA public`);
  log.push(`database ${me.db} ready (admin ${me.superuser ? 'superuser' : 'non-superuser'})`);
  return log;
}

/**
 * Removes BYPASSRLS from app_owner on databases created before ADR-0105. Run after the
 * migrations (0048 must be applied first). Only a superuser can change the attribute; on
 * Cloud SQL the role never had it.
 */
export async function dropOwnerBypass(admin: pg.Client): Promise<boolean> {
  const row = (
    await admin.query<{ bypass: boolean; superuser: boolean }>(
      `select (select rolbypassrls from pg_roles where rolname = 'app_owner') as bypass,
              (select rolsuper from pg_roles where rolname = current_user) as superuser`,
    )
  ).rows[0]!;
  if (!row.bypass) return false;
  if (!row.superuser) throw new Error('app_owner has BYPASSRLS and only a superuser can remove it');
  await admin.query('ALTER ROLE app_owner NOBYPASSRLS');
  return true;
}

/** Runs `fn` while holding the migration advisory lock on a dedicated owner connection. */
export async function withMigrationLock<T>(owner: pg.Pool, fn: () => Promise<T>): Promise<T> {
  const client = await owner.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
