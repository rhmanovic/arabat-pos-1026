-- Row-Level Security and privileges for the identity tables (ADR-0004, DATABASE.md §3).

-- Current user of the transaction, set by DatabaseService.withContext({ userId }).
-- Used only to let a user see their own memberships (and those merchants) before a
-- merchant context exists, e.g. while choosing a merchant at sign-in.
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- merchants: own context, or merchants where the current user has a membership.
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchants_select ON merchants FOR SELECT USING (
  id = app_current_merchant_id()
  OR id IN (SELECT m.merchant_id FROM memberships m WHERE m.user_id = app_current_user_id())
);
--> statement-breakpoint
CREATE POLICY merchants_insert ON merchants FOR INSERT WITH CHECK (id = app_current_merchant_id());
--> statement-breakpoint
CREATE POLICY merchants_update ON merchants FOR UPDATE
  USING (id = app_current_merchant_id()) WITH CHECK (id = app_current_merchant_id());
--> statement-breakpoint
-- Merchants are never deleted by the application (status 'closed' instead).
REVOKE DELETE ON merchants FROM app_runtime;
--> statement-breakpoint

-- memberships: merchant context, plus read access to the current user's own rows.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  merchant_id = app_current_merchant_id() OR user_id = app_current_user_id()
);
--> statement-breakpoint
CREATE POLICY memberships_insert ON memberships FOR INSERT WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (merchant_id = app_current_merchant_id()) WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
CREATE POLICY memberships_delete ON memberships FOR DELETE USING (merchant_id = app_current_merchant_id());
--> statement-breakpoint

-- Strictly merchant-scoped tables.
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON branches
  USING (merchant_id = app_current_merchant_id()) WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON roles
  USING (merchant_id = app_current_merchant_id()) WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON role_permissions
  USING (merchant_id = app_current_merchant_id()) WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON role_assignments
  USING (merchant_id = app_current_merchant_id()) WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint

-- audit_log: append-only; merchants read only their own events; events without a
-- merchant (failed sign-in, platform actions) are writable but never readable here.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_select ON audit_log FOR SELECT USING (merchant_id = app_current_merchant_id());
--> statement-breakpoint
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (
  merchant_id IS NULL OR merchant_id = app_current_merchant_id()
);
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_log FROM app_runtime;
--> statement-breakpoint

-- Hot lookups.
CREATE INDEX memberships_user_idx ON memberships (user_id);
--> statement-breakpoint
CREATE INDEX role_assignments_membership_idx ON role_assignments (merchant_id, membership_id);
--> statement-breakpoint
CREATE INDEX sessions_expires_idx ON sessions (expires_at) WHERE revoked_at IS NULL;
