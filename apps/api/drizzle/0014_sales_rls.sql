-- RLS and immutability for the checkout engine (Prompt 10).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_settings', 'receipt_sequences', 'orders', 'order_lines',
                           'sales', 'sale_lines', 'payments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Sales, their lines and payments are permanent; corrections are refunds (Prompt 11).
REVOKE UPDATE, DELETE ON sales, sale_lines, payments FROM app_runtime;
--> statement-breakpoint
REVOKE DELETE ON orders, receipt_sequences FROM app_runtime;
--> statement-breakpoint
-- Completed and cancelled orders are final.
CREATE FUNCTION orders_final_states() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'order % is %', OLD.id, OLD.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER orders_final_states BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_final_states();
--> statement-breakpoint
-- Lines of a suspended order may be replaced; lines of a final order never change.
CREATE FUNCTION order_lines_only_while_suspended() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM orders WHERE id = COALESCE(NEW.order_id, OLD.order_id);
  IF s IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'order lines of a % order are final', s USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER order_lines_only_while_suspended BEFORE UPDATE OR DELETE ON order_lines
  FOR EACH ROW EXECUTE FUNCTION order_lines_only_while_suspended();
