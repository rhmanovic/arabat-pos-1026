-- RLS and integrity rules for refunds (Prompt 11).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['refunds', 'refund_lines', 'refund_payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE DELETE ON refunds, refund_payments FROM app_runtime;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON refund_lines FROM app_runtime;
--> statement-breakpoint
-- A refund in a final state is a permanent record.
CREATE FUNCTION refunds_final_states() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('completed', 'rejected', 'cancelled') THEN
    RAISE EXCEPTION 'refund % is %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.total_minor <> OLD.total_minor OR NEW.sale_id <> OLD.sale_id THEN
    RAISE EXCEPTION 'refund amounts are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refunds_final_states BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_final_states();
--> statement-breakpoint
-- Only a pending (gateway) refund payment may change, and only its status/reference.
CREATE FUNCTION refund_payments_pending_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.amount_minor <> OLD.amount_minor
     OR NEW.original_payment_id IS DISTINCT FROM OLD.original_payment_id THEN
    RAISE EXCEPTION 'refund payment % is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_payments_pending_only BEFORE UPDATE ON refund_payments
  FOR EACH ROW EXECUTE FUNCTION refund_payments_pending_only();
