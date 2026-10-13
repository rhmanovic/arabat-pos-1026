CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_minor" bigint,
	"to_minor" bigint,
	"source" text DEFAULT 'manual' NOT NULL,
	"changed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_history_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "price_history_kind_valid" CHECK ("price_history"."kind" in ('price', 'cost')),
	CONSTRAINT "price_history_source_valid" CHECK ("price_history"."source" in ('manual', 'created'))
);
--> statement-breakpoint
CREATE TABLE "ownership_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"from_membership_id" uuid NOT NULL,
	"to_membership_id" uuid NOT NULL,
	"initiated_by" text NOT NULL,
	"token_hash" text,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_transfers_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "ownership_transfers_initiated_valid" CHECK ("ownership_transfers"."initiated_by" in ('owner', 'platform')),
	CONSTRAINT "ownership_transfers_status_valid" CHECK ("ownership_transfers"."status" in ('pending', 'accepted', 'cancelled', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "owner_frozen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "owner_frozen_reason" text;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_history_product_idx" ON "price_history" USING btree ("merchant_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "ownership_transfers_merchant_idx" ON "ownership_transfers" USING btree ("merchant_id","status");--> statement-breakpoint
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE price_history FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON price_history USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON price_history FROM app_runtime;
--> statement-breakpoint
ALTER TABLE ownership_transfers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ownership_transfers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON ownership_transfers USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON ownership_transfers FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, accepted_at, cancelled_at) ON ownership_transfers TO app_runtime;
--> statement-breakpoint
-- A transfer leaves "pending" exactly once (BR-020).
CREATE FUNCTION ownership_transfers_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'ownership transfer % is %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ownership_transfers_final BEFORE UPDATE ON ownership_transfers
  FOR EACH ROW EXECUTE FUNCTION ownership_transfers_final();
