-- ADR-0105: managed PostgreSQL (Google Cloud SQL) never grants BYPASSRLS, so app_owner can
-- no longer rely on it. app_owner owns every table; without FORCE ROW LEVEL SECURITY the
-- table owner is exempt from RLS, which gives migrations, seeds and the operator CLI the same
-- cross-merchant access as before. app_runtime does not own any table and stays filtered by
-- every policy, exactly as before. New tables enable RLS but do not force it (DATABASE.md §3).
DO $$
DECLARE
  t regclass;
BEGIN
  FOR t IN
    SELECT c.oid::regclass
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %s NO FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relrowsecurity
       AND pg_get_userbyid(c.relowner) <> 'app_owner'
  ) THEN
    RAISE EXCEPTION 'every table with RLS must be owned by app_owner';
  END IF;
END $$;
