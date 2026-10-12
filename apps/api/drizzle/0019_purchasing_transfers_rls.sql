-- RLS and integrity for suppliers, purchasing and transfers (Prompt 12).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_sequences', 'suppliers', 'purchase_orders', 'purchase_order_lines',
                           'purchase_receipts', 'purchase_receipt_lines', 'stock_transfers',
                           'stock_transfer_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE DELETE ON document_sequences, suppliers, purchase_orders, purchase_receipts,
  purchase_receipt_lines, stock_transfers FROM app_runtime;
--> statement-breakpoint
-- Receipts are permanent records.
REVOKE UPDATE ON purchase_receipts, purchase_receipt_lines FROM app_runtime;
--> statement-breakpoint
-- Order lines change only while the order is a draft.
CREATE FUNCTION purchase_order_lines_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM purchase_orders WHERE id = COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  IF s <> 'draft' THEN
    RAISE EXCEPTION 'purchase order lines can only change while the order is a draft' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_order_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION purchase_order_lines_draft_only();
--> statement-breakpoint
-- Final purchase orders and transfers never change.
CREATE FUNCTION purchasing_final_states() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('received', 'cancelled', 'closed') THEN
    RAISE EXCEPTION '% is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_orders_final BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION purchasing_final_states();
--> statement-breakpoint
CREATE TRIGGER stock_transfers_final BEFORE UPDATE ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION purchasing_final_states();
--> statement-breakpoint
-- Transfer lines: requested quantities fixed after creation; dispatched/received set once.
CREATE FUNCTION stock_transfer_lines_set_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requested_quantity <> OLD.requested_quantity OR NEW.variant_id <> OLD.variant_id
     OR (OLD.dispatched_quantity IS NOT NULL AND NEW.dispatched_quantity IS DISTINCT FROM OLD.dispatched_quantity)
     OR (OLD.received_quantity IS NOT NULL AND NEW.received_quantity IS DISTINCT FROM OLD.received_quantity) THEN
    RAISE EXCEPTION 'transfer line % is final', OLD.position USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_transfer_lines_set_once BEFORE UPDATE ON stock_transfer_lines
  FOR EACH ROW EXECUTE FUNCTION stock_transfer_lines_set_once();
--> statement-breakpoint
REVOKE DELETE ON stock_transfer_lines FROM app_runtime;
