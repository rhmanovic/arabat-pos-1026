import pg from 'pg';
import { loadEnv } from '../../config/env.js';

/** Connection pool for the schema owner role; used only by CLI tools (migrate, seed). */
export function createOwnerPool() {
  const env = loadEnv();
  if (!env.DATABASE_OWNER_URL) {
    throw new Error('DATABASE_OWNER_URL is required for migrations and seeds');
  }
  return { env, pool: new pg.Pool({ connectionString: env.DATABASE_OWNER_URL, max: 2 }) };
}
