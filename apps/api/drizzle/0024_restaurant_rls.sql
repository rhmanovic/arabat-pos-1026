-- RLS and integrity for the restaurant module (Prompt 15).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['restaurant_settings', 'dining_areas', 'dining_tables', 'kitchen_stations',
                           'kitchen_station_categories', 'modifier_groups', 'modifiers',
                           'product_modifier_groups', 'recipe_components', 'restaurant_orders',
                           'restaurant_order_items', 'restaurant_order_item_modifiers', 'kitchen_tickets',
                           'sale_line_modifiers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Configuration is deactivated, not deleted (orders and sales refer to it); link tables
-- (station routing, item groups, recipes) are replaced and may be deleted.
REVOKE DELETE ON restaurant_settings, dining_areas, dining_tables, kitchen_stations, modifier_groups,
  modifiers, restaurant_orders, restaurant_order_items, kitchen_tickets FROM app_runtime;
--> statement-breakpoint
-- Snapshots of chosen modifiers never change.
REVOKE UPDATE, DELETE ON restaurant_order_item_modifiers, sale_line_modifiers FROM app_runtime;
--> statement-breakpoint
-- Items: paid items keep their bill, quantity and product; cancelled items are final; sent
-- items cannot change what was ordered (cancel and re-add instead).
CREATE FUNCTION restaurant_order_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kitchen_status = 'cancelled' THEN
    RAISE EXCEPTION 'cancelled items are final' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.sale_id IS NOT NULL AND (NEW.sale_id IS DISTINCT FROM OLD.sale_id OR NEW.quantity <> OLD.quantity
      OR NEW.variant_id <> OLD.variant_id OR NEW.kitchen_status = 'cancelled' OR NEW.order_id <> OLD.order_id) THEN
    RAISE EXCEPTION 'paid items cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.kitchen_status <> 'pending' AND (NEW.quantity <> OLD.quantity OR NEW.variant_id <> OLD.variant_id) THEN
    RAISE EXCEPTION 'items sent to the kitchen cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER restaurant_order_items_guard BEFORE UPDATE ON restaurant_order_items
  FOR EACH ROW EXECUTE FUNCTION restaurant_order_items_guard();
--> statement-breakpoint
CREATE FUNCTION restaurant_orders_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('closed', 'cancelled', 'merged') THEN
    RAISE EXCEPTION 'restaurant order % is final', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER restaurant_orders_final BEFORE UPDATE ON restaurant_orders
  FOR EACH ROW EXECUTE FUNCTION restaurant_orders_final();
--> statement-breakpoint
-- One open order per table.
CREATE UNIQUE INDEX restaurant_orders_open_table_key ON restaurant_orders (merchant_id, table_id)
  WHERE status = 'open' AND table_id IS NOT NULL;
--> statement-breakpoint
-- One default station per branch.
CREATE UNIQUE INDEX kitchen_stations_default_key ON kitchen_stations (merchant_id, branch_id)
  WHERE is_default AND status = 'active';
