-- RLS and integrity for customers (Prompt 13).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'customer_notes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Customers are deactivated, never deleted (their sales keep pointing at them).
REVOKE DELETE ON customers FROM app_runtime;
--> statement-breakpoint
-- Notes are an append-only record.
REVOKE UPDATE, DELETE ON customer_notes FROM app_runtime;
--> statement-breakpoint
CREATE INDEX customers_name_trgm_idx ON customers USING gin (lower(full_name) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX customers_phone_trgm_idx ON customers USING gin (phone gin_trgm_ops);
