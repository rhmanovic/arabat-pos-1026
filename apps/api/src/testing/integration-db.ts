import pg from 'pg';
import { runMigrations } from '../database/migrate.js';
import { SEEDS } from '../database/seeds/index.js';
import { runSeeds } from '../database/seeds/run-seeds.js';
import { integrationDatabaseUrls } from './integration-env.js';

const IDENTITY_TABLES = [
  'audit_log',
  'sessions',
  'auth_tickets',
  'password_reset_tokens',
  'rate_limit_buckets',
  'role_assignments',
  'role_permissions',
  'roles',
  'memberships',
  'branches',
  'merchants',
  'users',
  'platform_operators',
];

/** Migrates the test database and empties identity tables (reference data stays). */
export async function prepareIntegrationDatabase(): Promise<{
  owner: pg.Pool;
  runtimeUrl: string;
}> {
  const { runtimeUrl, ownerUrl } = integrationDatabaseUrls();
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 3 });
  await runMigrations(owner);
  await runSeeds(owner, 'test', SEEDS);
  await owner.query(`truncate ${IDENTITY_TABLES.join(', ')} cascade`);
  return { owner, runtimeUrl };
}
