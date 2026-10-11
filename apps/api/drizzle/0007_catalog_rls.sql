-- RLS for the product catalog (Prompt 7) and search indexes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'products', 'product_variants', 'product_barcodes',
                           'product_branch_availability', 'product_images'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Products and variants are archived, never deleted (sale lines keep their own snapshots).
REVOKE DELETE ON products, product_variants FROM app_runtime;
--> statement-breakpoint
-- Fast "contains" search on names and SKUs for large catalogs (pg_trgm is a trusted extension).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX products_name_en_trgm ON products USING gin (lower(name_en) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX products_name_ar_trgm ON products USING gin (name_ar gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX product_variants_sku_trgm ON product_variants USING gin (lower(sku) gin_trgm_ops);
