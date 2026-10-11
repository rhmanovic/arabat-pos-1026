import { defineConfig } from 'drizzle-kit';

// Generates SQL migrations from the Drizzle schema files. Migrations are reviewed by hand
// and applied with `pnpm db:migrate` (see docs/DATABASE.md §8).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/**/*.schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
