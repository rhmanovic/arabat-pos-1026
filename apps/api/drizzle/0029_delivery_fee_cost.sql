-- The delivery-fee service item has a known cost of 0 (audit finding, Prompt 18), so online
-- sales with delivery no longer hide the period's gross profit. Past sales stay as recorded.
UPDATE product_variants SET cost_minor = 0, updated_at = now()
WHERE sku = 'ONLINE-DELIVERY' AND cost_minor IS NULL;
