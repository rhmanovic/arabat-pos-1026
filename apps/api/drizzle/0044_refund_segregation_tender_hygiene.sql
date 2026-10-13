-- Remediation R3.4 / R3.5 / R3.6 / R3.7 (ADR-0101, BR-180 to BR-183): refund segregation, tender hygiene, held sales and reprints, combined discount limit.
CREATE TABLE "pos_cart_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"line_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_cart_events_kind_valid" CHECK ("pos_cart_events"."kind" in ('cleared', 'line_removed'))
);
--> statement-breakpoint
CREATE TABLE "receipt_reprints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_status_valid";--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "refund_fee_policy" text DEFAULT 'keep' NOT NULL;--> statement-breakpoint
ALTER TABLE "refund_payments" ADD COLUMN "financial_account_id" uuid;--> statement-breakpoint
ALTER TABLE "refund_payments" ADD COLUMN "fee_reversed_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "owner_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "customer_contact" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_by_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "refund_own_sales_need_approval" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "require_tender_reference" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "held_sale_expiry_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "cart_clear_log_threshold_minor" bigint DEFAULT 5000 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_cart_events" ADD CONSTRAINT "pos_cart_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_cart_events" ADD CONSTRAINT "pos_cart_events_merchant_id_shift_id_shifts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","shift_id") REFERENCES "public"."shifts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_reprints" ADD CONSTRAINT "receipt_reprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_reprints" ADD CONSTRAINT "receipt_reprints_merchant_id_sale_id_sales_merchant_id_id_fk" FOREIGN KEY ("merchant_id","sale_id") REFERENCES "public"."sales"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_cart_events_shift_idx" ON "pos_cart_events" USING btree ("merchant_id","shift_id");--> statement-breakpoint
CREATE INDEX "receipt_reprints_sale_idx" ON "receipt_reprints" USING btree ("merchant_id","sale_id");--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_refund_fee_policy_valid" CHECK ("payment_methods"."refund_fee_policy" in ('keep', 'reverse'));--> statement-breakpoint
ALTER TABLE "refund_payments" ADD CONSTRAINT "refund_payments_fee_reversed_valid" CHECK ("refund_payments"."fee_reversed_minor" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('suspended', 'completed', 'cancelled', 'expired'));--> statement-breakpoint
ALTER TABLE receipt_reprints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE receipt_reprints FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON receipt_reprints USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON receipt_reprints FROM app_runtime;
--> statement-breakpoint
ALTER TABLE pos_cart_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pos_cart_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON pos_cart_events USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON pos_cart_events FROM app_runtime;
--> statement-breakpoint
-- Expired held sales are final too (BR-182).
CREATE OR REPLACE FUNCTION orders_final_states() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'order % is %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION order_lines_only_while_suspended() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM orders WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  IF s IN ('completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'order lines of a % order are final', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
