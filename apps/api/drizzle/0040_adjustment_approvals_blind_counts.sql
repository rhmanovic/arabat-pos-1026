-- Remediation R2.1 / R2.2 (ADR-0097, BR-169, BR-170): stock adjustment approvals, document numbers, blind counts.
ALTER TABLE "stock_adjustments" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "status" text DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "value_minor" bigint;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "limit_exceeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "owner_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD COLUMN "movements_acknowledged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "adjustment_approval_limit_minor" bigint DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "blind_stock_count" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_adjustments_status_idx" ON "stock_adjustments" USING btree ("merchant_id","status");--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_number_key" UNIQUE("merchant_id","number");--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_status_valid" CHECK ("stock_adjustments"."status" in ('posted', 'pending', 'rejected', 'withdrawn'));--> statement-breakpoint
-- Human-readable numbers for the documents that predate the numbering, in posting order.
WITH numbered AS (
  SELECT id, merchant_id, row_number() OVER (PARTITION BY merchant_id ORDER BY created_at, id) AS n
    FROM stock_adjustments WHERE number IS NULL
)
UPDATE stock_adjustments a SET number = 'ADJ-' || lpad(numbered.n::text, 6, '0')
  FROM numbered WHERE a.id = numbered.id;
--> statement-breakpoint
INSERT INTO document_sequences (merchant_id, kind, last_number)
SELECT merchant_id, 'stock_adjustment', count(*) FROM stock_adjustments GROUP BY merchant_id
ON CONFLICT (merchant_id, kind) DO UPDATE SET last_number = greatest(document_sequences.last_number, excluded.last_number);
--> statement-breakpoint
-- A pending document is decided once, into a final state; what was asked never changes.
GRANT UPDATE (status, value_minor, decided_by_user_id, decided_at, decision_note) ON stock_adjustments TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (previous_on_hand, delta, unit_cost_minor) ON stock_adjustment_lines TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION stock_adjustments_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merchant_id <> OLD.merchant_id OR NEW.branch_id <> OLD.branch_id OR NEW.kind <> OLD.kind
     OR NEW.reason <> OLD.reason OR NEW.note IS DISTINCT FROM OLD.note OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'stock adjustment % is immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'pending' THEN
    IF NEW.status NOT IN ('posted', 'rejected', 'withdrawn', 'pending') THEN
      RAISE EXCEPTION 'stock adjustment % must be decided into a final state', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- Final documents only ever receive their posted value.
  IF NEW.status <> OLD.status OR NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN
    RAISE EXCEPTION 'stock adjustment % is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_adjustments_decision BEFORE UPDATE ON stock_adjustments
  FOR EACH ROW EXECUTE FUNCTION stock_adjustments_decision();
--> statement-breakpoint
-- Lines of a pending document take their applied figures once, when it is approved.
CREATE FUNCTION stock_adjustment_lines_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  IF NEW.quantity <> OLD.quantity OR NEW.variant_id <> OLD.variant_id OR NEW.adjustment_id <> OLD.adjustment_id THEN
    RAISE EXCEPTION 'stock adjustment line is immutable' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO st FROM stock_adjustments WHERE id = OLD.adjustment_id;
  IF st <> 'pending' THEN
    RAISE EXCEPTION 'lines of a final stock adjustment never change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_adjustment_lines_apply BEFORE UPDATE ON stock_adjustment_lines
  FOR EACH ROW EXECUTE FUNCTION stock_adjustment_lines_apply();
