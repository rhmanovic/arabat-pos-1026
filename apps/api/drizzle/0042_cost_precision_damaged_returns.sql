-- Remediation R2.6 / R2.7 / R2.8 (ADR-0099, BR-174 to BR-176): micro-precision average cost, custody of returned goods.
CREATE TABLE "damaged_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost_minor" bigint,
	"reason" text NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"disposed_by_user_id" uuid,
	"disposed_at" timestamp with time zone,
	"disposal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damaged_returns_line_key" UNIQUE("merchant_id","refund_id","position"),
	CONSTRAINT "damaged_returns_status_valid" CHECK ("damaged_returns"."status" in ('held', 'disposed')),
	CONSTRAINT "damaged_returns_quantity_positive" CHECK ("damaged_returns"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "stock_levels" ADD COLUMN "avg_cost_micro" bigint;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "avg_cost_micro_after" bigint;--> statement-breakpoint
ALTER TABLE "damaged_returns" ADD CONSTRAINT "damaged_returns_disposed_by_user_id_users_id_fk" FOREIGN KEY ("disposed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damaged_returns" ADD CONSTRAINT "damaged_returns_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damaged_returns" ADD CONSTRAINT "damaged_returns_merchant_id_variant_id_product_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variants"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "damaged_returns_branch_idx" ON "damaged_returns" USING btree ("merchant_id","branch_id","status");--> statement-breakpoint
-- Promote existing averages to micro precision (10⁻⁶ KWD = thousandths of a fils).
UPDATE stock_levels SET avg_cost_micro = avg_cost_minor * 1000 WHERE avg_cost_minor IS NOT NULL AND avg_cost_micro IS NULL;
--> statement-breakpoint
UPDATE stock_movements SET avg_cost_micro_after = avg_cost_after_minor * 1000 WHERE avg_cost_after_minor IS NOT NULL AND avg_cost_micro_after IS NULL;
--> statement-breakpoint
ALTER TABLE damaged_returns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE damaged_returns FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON damaged_returns USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON damaged_returns FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, disposed_by_user_id, disposed_at, disposal_note) ON damaged_returns TO app_runtime;
--> statement-breakpoint
-- Returned goods are disposed of once; the record itself never changes.
CREATE FUNCTION damaged_returns_dispose() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'held' OR NEW.status <> 'disposed' THEN
    RAISE EXCEPTION 'damaged return % is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER damaged_returns_dispose BEFORE UPDATE ON damaged_returns
  FOR EACH ROW EXECUTE FUNCTION damaged_returns_dispose();
