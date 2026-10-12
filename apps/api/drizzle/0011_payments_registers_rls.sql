-- RLS, append-only rules and closed-shift immutability (Prompt 9).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_accounts', 'financial_account_entries', 'payment_methods',
                           'registers', 'register_members', 'shifts', 'cash_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Financial records are append-only; configuration is deactivated, never deleted.
REVOKE UPDATE, DELETE ON financial_account_entries, cash_movements FROM app_runtime;
--> statement-breakpoint
REVOKE DELETE ON financial_accounts, payment_methods, registers, shifts FROM app_runtime;
--> statement-breakpoint
-- A closed shift is a permanent record: it can never be reopened or changed.
CREATE FUNCTION shifts_closed_is_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'closed shift % is immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER shifts_closed_is_final BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION shifts_closed_is_final();
--> statement-breakpoint
-- Cash movements only on an open shift (checked under the shift row lock in the service,
-- and here as the last line of defence).
CREATE FUNCTION cash_movements_shift_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shifts s WHERE s.id = NEW.shift_id AND s.status = 'open') THEN
    RAISE EXCEPTION 'shift % is not open', NEW.shift_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_movements_shift_open BEFORE INSERT ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION cash_movements_shift_open();
