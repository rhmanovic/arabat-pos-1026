-- Remediation R3.1 / R3.2 / R3.3 (ADR-0100, BR-177 to BR-179): supervisor overrides on the cashier's till, price-change bounds, zero-total sales.
CREATE TABLE "sale_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"cashier_membership_id" uuid NOT NULL,
	"cashier_user_id" uuid NOT NULL,
	"approver_membership_id" uuid NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"permissions" text[] NOT NULL,
	"note" text,
	"status" text DEFAULT 'granted' NOT NULL,
	"kinds" text[],
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_overrides_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "sale_overrides_status_valid" CHECK ("sale_overrides"."status" in ('granted', 'used')),
	CONSTRAINT "sale_overrides_used_consistent" CHECK (("sale_overrides"."status" = 'used') = ("sale_overrides"."used_at" is not null) and ("sale_overrides"."status" = 'used') = ("sale_overrides"."kinds" is not null))
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "price_override_reason" text;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "price_override_reason" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "above_limit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "discount_limit_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "zero_total_reason" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "override_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "price_override_floor_percent" numeric(5, 2) DEFAULT '50';--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "price_override_ceiling_percent" numeric(5, 2) DEFAULT '200';--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "price_override_below_cost" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_overrides" ADD CONSTRAINT "sale_overrides_cashier_user_id_users_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_overrides" ADD CONSTRAINT "sale_overrides_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_overrides" ADD CONSTRAINT "sale_overrides_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_overrides" ADD CONSTRAINT "sale_overrides_merchant_id_shift_id_shifts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","shift_id") REFERENCES "public"."shifts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_overrides_cashier_idx" ON "sale_overrides" USING btree ("merchant_id","cashier_membership_id","status");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_merchant_id_override_id_sale_overrides_merchant_id_id_fk" FOREIGN KEY ("merchant_id","override_id") REFERENCES "public"."sale_overrides"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_override_key" UNIQUE("merchant_id","override_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_zero_total_reason" CHECK ("sales"."channel" <> 'pos' or "sales"."total_minor" > 0 or "sales"."zero_total_reason" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE sale_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sale_overrides FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON sale_overrides USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON sale_overrides FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, kinds, used_at) ON sale_overrides TO app_runtime;
--> statement-breakpoint
-- A grant is consumed by exactly one sale; nothing else about it ever changes.
CREATE FUNCTION sale_overrides_use() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'granted' OR NEW.status <> 'used' THEN
    RAISE EXCEPTION 'sale override % was already used', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sale_overrides_use BEFORE UPDATE ON sale_overrides
  FOR EACH ROW EXECUTE FUNCTION sale_overrides_use();
