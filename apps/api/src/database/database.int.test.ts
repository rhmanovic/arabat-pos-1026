import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { integrationDatabaseUrls } from '../testing/integration-env.js';
import { createTestApp, testEnv } from '../testing/test-app.js';
import { DatabaseService } from './database.service.js';
import { runMigrations } from './migrate.js';
import { SEEDS } from './seeds/index.js';
import { runSeeds } from './seeds/run-seeds.js';

const { runtimeUrl, ownerUrl } = integrationDatabaseUrls();

/** Drizzle wraps driver errors; the PostgreSQL message is on `cause`. */
async function postgresError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(error);
  }
  throw new Error('Expected the query to fail');
}
const MERCHANT_A = '0190a000-0000-7000-8000-00000000000a';
const MERCHANT_B = '0190a000-0000-7000-8000-00000000000b';

describe('database (PostgreSQL integration)', () => {
  let owner: pg.Pool;
  let app: NestFastifyApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: ownerUrl, max: 2 });
    await runMigrations(owner);
    await runSeeds(owner, 'test', SEEDS);

    // A throw-away merchant-owned table that follows the RLS convention of DATABASE.md §3.
    await owner.query(`
      drop table if exists rls_probe;
      create table rls_probe (id serial primary key, merchant_id uuid not null, label text not null);
      alter table rls_probe enable row level security;
      create policy merchant_isolation on rls_probe
        using (merchant_id = app_current_merchant_id())
        with check (merchant_id = app_current_merchant_id());
    `);
    // Seed through the merchant setting, as the API would.
    for (const [merchant, label] of [
      [MERCHANT_A, 'a1'],
      [MERCHANT_A, 'a2'],
      [MERCHANT_B, 'b1'],
    ] as const) {
      const client = await owner.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.merchant_id', $1, true)`, [merchant]);
        await client.query('insert into rls_probe (merchant_id, label) values ($1, $2)', [
          merchant,
          label,
        ]);
        await client.query('commit');
      } finally {
        client.release();
      }
    }

    app = await createTestApp({ env: testEnv({ DATABASE_URL: runtimeUrl }) });
    database = app.get(DatabaseService);
  });

  afterAll(async () => {
    await app?.close();
    await owner?.query('drop table if exists rls_probe');
    await owner?.end();
  });

  it('is idempotent: migrations and seeds can be applied again', async () => {
    await runMigrations(owner);
    const results = await runSeeds(owner, 'test', SEEDS);
    expect(results.find((r) => r.name === '001-currencies')?.status).toBe('applied');
    // Development demo data never runs outside development.
    expect(results.find((r) => r.name === '100-dev-demo-merchants')?.status).toBe('skipped');
    const { rows } = await owner.query(`select exponent from currencies where code = 'KWD'`);
    expect(rows).toEqual([{ exponent: 3 }]);
  });

  it('connects as a runtime role without superuser or BYPASSRLS', async () => {
    const result = await database.db.execute(
      sql`select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(result.rows[0]).toEqual({ name: 'app_runtime', rolsuper: false, rolbypassrls: false });
  });

  it('runs migrations as a table owner without superuser or BYPASSRLS (ADR-0105)', async () => {
    const { rows } = await owner.query(
      `select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toEqual({ name: 'app_owner', rolsuper: false, rolbypassrls: false });
    // Managed PostgreSQL cannot grant BYPASSRLS: the owner is exempt only because no table
    // forces RLS, and the runtime role owns nothing, so every policy applies to the API.
    const forced = await owner.query(
      `select relname from pg_class where relnamespace = 'public'::regnamespace
         and relkind in ('r', 'p') and relforcerowsecurity`,
    );
    expect(forced.rows).toEqual([]);
    const notOwned = await owner.query(
      `select relname from pg_class where relnamespace = 'public'::regnamespace
         and relkind in ('r', 'p') and pg_get_userbyid(relowner) <> 'app_owner'`,
    );
    expect(notOwned.rows).toEqual([]);
  });

  it('lets the owner role see every merchant for data migrations', async () => {
    const { rows } = await owner.query('select label from rls_probe order by label');
    expect(rows.map((r) => r.label)).toEqual(['a1', 'a2', 'b1']);
  });

  it('reports readiness with a real database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { database: { status: 'ok' } } });
  });

  it('shows no merchant rows outside a merchant transaction', async () => {
    const result = await database.db.execute(sql`select label from rls_probe`);
    expect(result.rows).toEqual([]);
  });

  it('isolates merchants with Row-Level Security inside withMerchantTx', async () => {
    const labelsA = await database.withMerchantTx(MERCHANT_A, async (tx) =>
      (await tx.execute(sql`select label from rls_probe order by label`)).rows.map(
        (r) => r['label'],
      ),
    );
    const labelsB = await database.withMerchantTx(MERCHANT_B, async (tx) =>
      (await tx.execute(sql`select label from rls_probe order by label`)).rows.map(
        (r) => r['label'],
      ),
    );
    expect(labelsA).toEqual(['a1', 'a2']);
    expect(labelsB).toEqual(['b1']);
  });

  it('prevents writing rows for another merchant', async () => {
    const message = await postgresError(
      database.withMerchantTx(MERCHANT_A, (tx) =>
        tx.execute(
          sql`insert into rls_probe (merchant_id, label) values (${MERCHANT_B}::uuid, 'forged')`,
        ),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it('does not leak the merchant setting to the next transaction on the same pool', async () => {
    await database.withMerchantTx(MERCHANT_A, async () => undefined);
    const result = await database.withTransaction((tx) =>
      tx.execute(sql`select app_current_merchant_id() as id`),
    );
    expect(result.rows[0]).toEqual({ id: null });
  });

  it('rolls back every statement of a failed transaction', async () => {
    await expect(
      database.withMerchantTx(MERCHANT_A, async (tx) => {
        await tx.execute(
          sql`insert into rls_probe (merchant_id, label) values (${MERCHANT_A}::uuid, 'temp')`,
        );
        throw new Error('fail after insert');
      }),
    ).rejects.toThrow('fail after insert');
    const count = await database.withMerchantTx(
      MERCHANT_A,
      async (tx) =>
        (await tx.execute(sql`select count(*)::int as n from rls_probe where label = 'temp'`))
          .rows[0],
    );
    expect(count).toEqual({ n: 0 });
  });

  it('rejects a malformed merchant id before touching the database', async () => {
    await expect(database.withMerchantTx('not-a-uuid', async () => undefined)).rejects.toThrow();
  });

  it('lets the runtime role read but not modify reference data', async () => {
    const result = await database.db.execute(sql`select code from currencies where code = 'KWD'`);
    expect(result.rows).toEqual([{ code: 'KWD' }]);
    expect(await postgresError(database.db.execute(sql`delete from currencies`))).toMatch(
      /permission denied/,
    );
  });
});
