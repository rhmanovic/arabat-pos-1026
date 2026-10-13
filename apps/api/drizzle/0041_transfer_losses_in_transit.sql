-- Remediation R2.3 / R2.4 (ADR-0098, BR-172, BR-173): transfer losses written off and approved, surplus, recall, in-transit valuation.
CREATE TABLE "stock_transfer_loss_lines" (
	"merchant_id" uuid NOT NULL,
	"loss_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost_minor" bigint,
	CONSTRAINT "stock_transfer_loss_lines_loss_id_position_pk" PRIMARY KEY("loss_id","position"),
	CONSTRAINT "stock_transfer_loss_lines_quantity_positive" CHECK ("stock_transfer_loss_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_losses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text NOT NULL,
	"value_minor" bigint NOT NULL,
	"explanation" text NOT NULL,
	"limit_exceeded" boolean DEFAULT false NOT NULL,
	"owner_override" boolean DEFAULT false NOT NULL,
	"claimed_by_user_id" uuid NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfer_losses_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "stock_transfer_losses_number_key" UNIQUE("merchant_id","number"),
	CONSTRAINT "stock_transfer_losses_status_valid" CHECK ("stock_transfer_losses"."status" in ('posted', 'pending', 'rejected')),
	CONSTRAINT "stock_transfer_losses_value_valid" CHECK ("stock_transfer_losses"."value_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" DROP CONSTRAINT "stock_transfer_lines_quantities";--> statement-breakpoint
ALTER TABLE "stock_transfers" DROP CONSTRAINT "stock_transfers_status_valid";--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD COLUMN "recalled_quantity" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "recalled_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "recalled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "recall_note" text;--> statement-breakpoint
ALTER TABLE "stock_transfer_loss_lines" ADD CONSTRAINT "stock_transfer_loss_lines_merchant_id_loss_id_stock_transfer_losses_merchant_id_id_fk" FOREIGN KEY ("merchant_id","loss_id") REFERENCES "public"."stock_transfer_losses"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_loss_lines" ADD CONSTRAINT "stock_transfer_loss_lines_merchant_id_variant_id_product_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variants"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_losses" ADD CONSTRAINT "stock_transfer_losses_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_losses" ADD CONSTRAINT "stock_transfer_losses_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_losses" ADD CONSTRAINT "stock_transfer_losses_merchant_id_transfer_id_stock_transfers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","transfer_id") REFERENCES "public"."stock_transfers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_transfer_losses_transfer_idx" ON "stock_transfer_losses" USING btree ("merchant_id","transfer_id");--> statement-breakpoint
CREATE INDEX "stock_transfer_losses_status_idx" ON "stock_transfer_losses" USING btree ("merchant_id","status");--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_recalled_by_user_id_users_id_fk" FOREIGN KEY ("recalled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_quantities" CHECK ("stock_transfer_lines"."requested_quantity" > 0 and ("stock_transfer_lines"."dispatched_quantity" is null or "stock_transfer_lines"."dispatched_quantity" >= 0)
          and ("stock_transfer_lines"."received_quantity" is null or ("stock_transfer_lines"."dispatched_quantity" is not null and "stock_transfer_lines"."received_quantity" >= 0))
          and ("stock_transfer_lines"."recalled_quantity" is null or ("stock_transfer_lines"."dispatched_quantity" is not null and "stock_transfer_lines"."recalled_quantity" >= 0)));--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_status_valid" CHECK ("stock_transfers"."status" in ('requested', 'approved', 'in_transit', 'received', 'cancelled', 'recalled'));--> statement-breakpoint
ALTER TABLE stock_transfer_losses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stock_transfer_losses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON stock_transfer_losses USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON stock_transfer_losses FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, decided_by_user_id, decided_at, decision_note) ON stock_transfer_losses TO app_runtime;
--> statement-breakpoint
ALTER TABLE stock_transfer_loss_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stock_transfer_loss_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON stock_transfer_loss_lines USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON stock_transfer_loss_lines FROM app_runtime;
--> statement-breakpoint
-- A pending loss is decided once, into posted or rejected; nothing else changes.
CREATE FUNCTION stock_transfer_losses_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'transfer loss % is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('posted', 'rejected') THEN
    RAISE EXCEPTION 'transfer loss % must be decided into a final state', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_transfer_losses_decision BEFORE UPDATE ON stock_transfer_losses
  FOR EACH ROW EXECUTE FUNCTION stock_transfer_losses_decision();
--> statement-breakpoint
-- Recalled transfers are final too (replaces 0019; purchase orders share the function).
CREATE OR REPLACE FUNCTION purchasing_final_states() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('received', 'cancelled', 'closed', 'recalled') THEN
    RAISE EXCEPTION '% is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- The recalled quantity is set once, like the dispatched and received quantities.
CREATE OR REPLACE FUNCTION stock_transfer_lines_set_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requested_quantity <> OLD.requested_quantity OR NEW.variant_id <> OLD.variant_id
     OR (OLD.dispatched_quantity IS NOT NULL AND NEW.dispatched_quantity IS DISTINCT FROM OLD.dispatched_quantity)
     OR (OLD.received_quantity IS NOT NULL AND NEW.received_quantity IS DISTINCT FROM OLD.received_quantity)
     OR (OLD.recalled_quantity IS NOT NULL AND NEW.recalled_quantity IS DISTINCT FROM OLD.recalled_quantity) THEN
    RAISE EXCEPTION 'transfer line % is final', OLD.position USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
