-- Bootstrap: privileges and helpers shared by every later migration.
-- Requires roles app_owner (runs this migration) and app_runtime to exist
-- (created by docker/postgres/init or the CI setup step).

-- The runtime role may use the schema but never create objects in it.
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint
-- Tables created later by app_owner are readable/writable by app_runtime by default.
-- Append-only tables revoke UPDATE/DELETE explicitly in their own migration (DATABASE.md §5).
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO app_runtime;
--> statement-breakpoint
-- Current merchant of the transaction, set by DatabaseService.withMerchantTx().
-- Returns NULL when unset, so RLS policies comparing against it match no rows.
CREATE FUNCTION app_current_merchant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.merchant_id', true), '')::uuid $$;
