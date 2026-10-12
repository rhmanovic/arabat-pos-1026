-- RLS and append-only rules for inventory (Prompt 8).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_settings', 'stock_levels', 'stock_adjustments',
                           'stock_adjustment_lines', 'stock_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- The ledger and its documents are append-only: corrections are new movements.
REVOKE UPDATE, DELETE ON stock_movements, stock_adjustments, stock_adjustment_lines FROM app_runtime;
--> statement-breakpoint
-- Balances are maintained by the inventory service, never deleted.
REVOKE DELETE ON stock_levels FROM app_runtime;
