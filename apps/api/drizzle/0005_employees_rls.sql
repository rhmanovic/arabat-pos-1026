-- RLS for invitations and data migration of renamed permission keys (Prompt 5).

-- Hex-encoded SHA-256 of an invitation token, set by DatabaseService.withContext({ inviteHash }).
-- Lets the invited person open exactly their own invitation before a merchant context exists.
CREATE FUNCTION app_current_invite_hash() RETURNS bytea
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT decode(nullif(current_setting('app.invite_hash', true), ''), 'hex') $$;
--> statement-breakpoint
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_select ON invitations FOR SELECT USING (
  merchant_id = app_current_merchant_id() OR token_hash = app_current_invite_hash()
);
--> statement-breakpoint
CREATE POLICY invitations_insert ON invitations FOR INSERT WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
CREATE POLICY invitations_update ON invitations FOR UPDATE
  USING (merchant_id = app_current_merchant_id()) WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE DELETE ON invitations FROM app_runtime;
--> statement-breakpoint
ALTER TABLE invitation_assignments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invitation_assignments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON invitation_assignments
  USING (merchant_id = app_current_merchant_id()) WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
CREATE INDEX memberships_merchant_status_idx ON memberships (merchant_id, status);
--> statement-breakpoint

-- Data migration: renamed permission keys and the renamed "manager" template.
-- Runs as app_owner, which has BYPASSRLS (ADR-0031), so every merchant is updated.
INSERT INTO role_permissions (merchant_id, role_id, permission_key)
  SELECT rp.merchant_id, rp.role_id, m.new_key
  FROM role_permissions rp
  JOIN (VALUES
    ('users.read', 'employees.read'), ('users.invite', 'employees.manage'),
    ('users.update', 'employees.manage'), ('users.deactivate', 'employees.manage'),
    ('roles.read', 'employees.read'), ('roles.assign', 'employees.manage'),
    ('branches.create', 'branches.manage')
  ) AS m(old_key, new_key) ON rp.permission_key = m.old_key
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM role_permissions WHERE permission_key IN
  ('users.read', 'users.invite', 'users.update', 'users.deactivate', 'roles.read', 'roles.assign', 'branches.create');
--> statement-breakpoint
UPDATE roles SET template_key = 'company_manager' WHERE template_key = 'manager';
