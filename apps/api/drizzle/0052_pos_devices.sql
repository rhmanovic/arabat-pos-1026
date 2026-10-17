CREATE TABLE "pos_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"registered_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	CONSTRAINT "pos_devices_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "pos_devices_name_present" CHECK (length(trim("pos_devices"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "register_code_sequences" (
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"last_number" integer NOT NULL,
	CONSTRAINT "register_code_sequences_merchant_id_branch_id_pk" PRIMARY KEY("merchant_id","branch_id"),
	CONSTRAINT "register_code_sequences_positive" CHECK ("register_code_sequences"."last_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_registered_by_user_id_users_id_fk" FOREIGN KEY ("registered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_merchant_id_register_id_branch_id_registers_merchant_id_id_branch_id_fk" FOREIGN KEY ("merchant_id","register_id","branch_id") REFERENCES "public"."registers"("merchant_id","id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_code_sequences" ADD CONSTRAINT "register_code_sequences_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_token_hash_key" ON "pos_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_devices_register_key" ON "pos_devices" USING btree ("register_id");--> statement-breakpoint
-- Local-first devices (ADR-0112). RLS enabled, not forced (ADR-0105).
ALTER TABLE pos_devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON pos_devices USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- A device row is history: never deleted; only its last-seen, last-sync and revocation change.
REVOKE UPDATE, DELETE ON pos_devices FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (last_seen_at, last_sync_at, revoked_at, revoked_by_user_id) ON pos_devices TO app_runtime;
--> statement-breakpoint
ALTER TABLE register_code_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON register_code_sequences USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE DELETE ON register_code_sequences FROM app_runtime;
--> statement-breakpoint
-- The device's bearer token is checked before a merchant context exists. Returns the device with
-- that token hash (revoked ones too, so the API can answer DEVICE_REVOKED) and stamps the
-- last-seen time of a live device. SECURITY DEFINER runs as the table owner.
CREATE FUNCTION device_authenticate(p_token_hash bytea)
RETURNS TABLE (id uuid, merchant_id uuid, branch_id uuid, register_id uuid, revoked boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE pos_devices d SET last_seen_at = CASE WHEN d.revoked_at IS NULL THEN now() ELSE d.last_seen_at END
  WHERE d.token_hash = p_token_hash
  RETURNING d.id, d.merchant_id, d.branch_id, d.register_id, d.revoked_at IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION device_authenticate(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION device_authenticate(bytea) TO app_runtime;
