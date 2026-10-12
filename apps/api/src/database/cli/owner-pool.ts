import pg from 'pg';
import { loadEnv } from '../../config/env.js';

/** Connection pool for the schema owner role; used only by CLI tools (migrate, seed). */
export function createOwnerPool() {
  // Hosted (hosted-start.ts): the owner URL is derived from the platform's admin URL.
  const admin = process.env['DATABASE_ADMIN_URL'];
  const ownerPassword = process.env['APP_OWNER_PASSWORD'];
  if (!process.env['DATABASE_OWNER_URL'] && admin && ownerPassword) {
    const u = new URL(admin);
    u.username = 'app_owner';
    u.password = ownerPassword;
    process.env['DATABASE_OWNER_URL'] = u.toString();
    process.env['DATABASE_URL'] ??= u.toString();
  }
  const env = loadEnv();
  if (!env.DATABASE_OWNER_URL) {
    throw new Error('DATABASE_OWNER_URL is required for migrations and seeds');
  }
  return { env, pool: new pg.Pool({ connectionString: env.DATABASE_OWNER_URL, max: 2 }) };
}
