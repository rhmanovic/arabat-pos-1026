-- Remediation R1.1 (ADR-0094, BR-164): cash-out limits, pending movements, corrections, tolerance cap.
ALTER TABLE "cash_movements" ADD COLUMN "status" text DEFAULT 'posted' NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "corrects_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "limit_exceeded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "owner_override" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "decided_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "cash_out_other_limit_minor" bigint DEFAULT 20000 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "cash_out_other_shift_limit_minor" bigint DEFAULT 50000 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "max_register_tolerance_minor" bigint DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_status_valid" CHECK ("cash_movements"."status" in ('posted', 'pending', 'rejected', 'withdrawn'));--> statement-breakpoint
-- Cash-out controls (ADR-0094, BR-164): a pending movement may only be decided once, into a
-- final state, without touching anything else; a decision that posts needs the shift open.
GRANT UPDATE (status, decided_by_user_id, decided_at, decision_note) ON cash_movements TO app_runtime;
--> statement-breakpoint
CREATE FUNCTION cash_movements_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'cash movement % is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('posted', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'cash movement % must be decided into a final state', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind <> OLD.kind OR NEW.amount_minor <> OLD.amount_minor OR NEW.reason <> OLD.reason
     OR NEW.shift_id <> OLD.shift_id OR NEW.created_by_user_id <> OLD.created_by_user_id
     OR NEW.note IS DISTINCT FROM OLD.note OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'cash movement % cannot be edited', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'posted' AND NOT EXISTS (SELECT 1 FROM shifts s WHERE s.id = NEW.shift_id AND s.status = 'open') THEN
    RAISE EXCEPTION 'shift % is not open', NEW.shift_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_movements_decision BEFORE UPDATE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION cash_movements_decision();
