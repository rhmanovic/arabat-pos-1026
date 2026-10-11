/**
 * Integration tests run against a real PostgreSQL database. They never skip silently:
 * a missing configuration fails the run with instructions (docs/TESTING.md).
 */
export function integrationDatabaseUrls(): { runtimeUrl: string; ownerUrl: string } {
  const runtimeUrl = process.env['TEST_DATABASE_URL'];
  const ownerUrl = process.env['TEST_DATABASE_OWNER_URL'];
  if (!runtimeUrl || !ownerUrl) {
    throw new Error(
      'TEST_DATABASE_URL and TEST_DATABASE_OWNER_URL must be set for integration tests. ' +
        'Start PostgreSQL with `pnpm db:up` and copy .env.example to .env.',
    );
  }
  return { runtimeUrl, ownerUrl };
}
