ALTER TABLE "branches" ADD COLUMN "pin_link_key_hash" "bytea";--> statement-breakpoint
ALTER TABLE "pos_devices" ADD COLUMN "role" text DEFAULT 'secondary' NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD COLUMN "branch_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_merchant_id_device_id_pos_devices_merchant_id_id_fk" FOREIGN KEY ("merchant_id","device_id") REFERENCES "public"."pos_devices"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_pin_link_key" ON "branches" USING btree ("pin_link_key_hash") WHERE "branches"."pin_link_key_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_one_primary_per_branch" ON "pos_devices" USING btree ("merchant_id","branch_id") WHERE "pos_devices"."role" = 'primary' and "pos_devices"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_role_valid" CHECK ("pos_devices"."role" in ('primary', 'secondary'));--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_one_claimer" CHECK ("print_jobs"."agent_id" is null or "print_jobs"."device_id" is null);
--> statement-breakpoint
-- Plan A (ADR-0112 amendment 2): the oldest live device of each branch becomes its primary, so
-- branches that already sell on a device keep a cash-drawer till and a browser print target.
UPDATE pos_devices d SET role = 'primary'
WHERE d.revoked_at IS NULL AND d.id = (
  SELECT x.id FROM pos_devices x
  WHERE x.merchant_id = d.merchant_id AND x.branch_id = d.branch_id AND x.revoked_at IS NULL
  ORDER BY x.created_at, x.id LIMIT 1);
--> statement-breakpoint
GRANT UPDATE (role, branch_id, register_id, branch_changed_at) ON pos_devices TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (device_id) ON print_jobs TO app_runtime;
--> statement-breakpoint
-- The device's identity now carries its role (primary devices also act as print agents).
DROP FUNCTION device_authenticate(bytea);
--> statement-breakpoint
CREATE FUNCTION device_authenticate(p_token_hash bytea)
RETURNS TABLE (id uuid, merchant_id uuid, branch_id uuid, register_id uuid, revoked boolean, role text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE pos_devices d SET last_seen_at = CASE WHEN d.revoked_at IS NULL THEN now() ELSE d.last_seen_at END
  WHERE d.token_hash = p_token_hash
  RETURNING d.id, d.merchant_id, d.branch_id, d.register_id, d.revoked_at IS NOT NULL, d.role
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION device_authenticate(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION device_authenticate(bytea) TO app_runtime;
--> statement-breakpoint
-- The PIN sign-in link of a branch (Plan A): the key's SHA-256 resolves to the branch without a
-- merchant context, for the public browser sign-in page only.
CREATE FUNCTION branch_by_pin_link(p_key_hash bytea)
RETURNS TABLE (merchant_id uuid, branch_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.merchant_id, b.id FROM branches b
  WHERE b.pin_link_key_hash = p_key_hash AND b.status = 'active'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION branch_by_pin_link(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION branch_by_pin_link(bytea) TO app_runtime;
