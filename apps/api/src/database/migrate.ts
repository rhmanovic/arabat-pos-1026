import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/** Directory containing the generated SQL migrations (apps/api/drizzle). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies pending migrations. Must be called with the schema owner connection (app_owner). */
export async function runMigrations(pool: pg.Pool): Promise<void> {
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema: 'drizzle' });
}
