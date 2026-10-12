-- RLS and integrity for the online store (Prompt 16).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['online_stores', 'online_listings', 'online_orders', 'online_order_lines',
                           'stock_reservations', 'online_payments', 'payment_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE DELETE ON online_stores, online_orders, stock_reservations, online_payments FROM app_runtime;
--> statement-breakpoint
-- Order lines and gateway events are permanent records.
REVOKE UPDATE, DELETE ON online_order_lines, payment_events FROM app_runtime;
--> statement-breakpoint
-- Public pages know only the store slug; webhooks only the provider's reference. These
-- lookups return the merchant id so the request can continue inside that merchant's RLS
-- context — the client never supplies a merchant id.
CREATE FUNCTION store_merchant(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT merchant_id FROM online_stores
  WHERE lower(slug) = lower(p_slug) AND status IN ('published', 'paused')
$$;
--> statement-breakpoint
CREATE FUNCTION online_payment_merchant(p_provider text, p_reference text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT merchant_id FROM online_payments WHERE provider = p_provider AND provider_reference = p_reference
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION store_merchant(text), online_payment_merchant(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION store_merchant(text), online_payment_merchant(text, text) TO app_runtime;
--> statement-breakpoint
-- Final online orders never change.
CREATE FUNCTION online_orders_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 'expired' is not final: a payment confirmed late can still complete it (ADR-0079).
  IF OLD.status IN ('completed', 'payment_failed', 'cancelled') THEN
    RAISE EXCEPTION 'online order % is final', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER online_orders_final BEFORE UPDATE ON online_orders
  FOR EACH ROW EXECUTE FUNCTION online_orders_final();
--> statement-breakpoint
-- A settled gateway attempt never changes again (an expired one may still be confirmed).
CREATE FUNCTION online_payments_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('initiated', 'expired') THEN
    RAISE EXCEPTION 'online payment % is settled', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER online_payments_final BEFORE UPDATE ON online_payments
  FOR EACH ROW EXECUTE FUNCTION online_payments_final();
--> statement-breakpoint
-- Merchants with unpaid orders past their reservation (for the background reconciliation).
CREATE FUNCTION online_orders_due_merchants() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT merchant_id FROM online_orders WHERE status = 'pending_payment' AND reserved_until < now()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION online_orders_due_merchants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION online_orders_due_merchants() TO app_runtime;
