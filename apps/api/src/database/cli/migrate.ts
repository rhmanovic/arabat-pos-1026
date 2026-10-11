import { runMigrations } from '../migrate.js';
import { createOwnerPool } from './owner-pool.js';

const { pool } = createOwnerPool();
try {
  await runMigrations(pool);
  console.log('Migrations applied successfully.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
