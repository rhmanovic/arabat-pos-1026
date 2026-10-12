-- Cash custody phase B (ADR-0091): RLS and append-only rules for disbursements and branch
-- transfers, the allowed transfer directions, and the company "in transit" account.
ALTER TABLE cash_disbursements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cash_disbursements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON cash_disbursements USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON cash_disbursements FROM app_runtime;
--> statement-breakpoint
ALTER TABLE cash_branch_transfers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cash_branch_transfers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON cash_branch_transfers USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE DELETE ON cash_branch_transfers FROM app_runtime;
--> statement-breakpoint
-- A branch transfer only moves forward (in_transit → received | cancelled) and never changes
-- what was sent, from where or to where.
CREATE FUNCTION cash_branch_transfers_forward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'in_transit' OR NEW.status NOT IN ('received', 'cancelled') THEN
    RAISE EXCEPTION 'branch transfer % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.merchant_id <> OLD.merchant_id OR NEW.number <> OLD.number
     OR NEW.from_branch_id <> OLD.from_branch_id OR NEW.to_branch_id <> OLD.to_branch_id
     OR NEW.from_account_id <> OLD.from_account_id OR NEW.to_account_id <> OLD.to_account_id
     OR NEW.amount_sent_minor <> OLD.amount_sent_minor OR NEW.sent_by_user_id <> OLD.sent_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'branch transfer % is immutable once sent', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_branch_transfers_forward BEFORE UPDATE ON cash_branch_transfers
  FOR EACH ROW EXECUTE FUNCTION cash_branch_transfers_forward();
--> statement-breakpoint
-- Allowed transfer directions: a register and its branch treasury (both ways); a register or
-- treasury into a bank (deposit); a treasury into or out of the company in-transit account
-- (branch transfers, which must name the branch transfer).
CREATE OR REPLACE FUNCTION cash_transfers_direction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  f record;
  t record;
BEGIN
  SELECT kind, branch_id, status INTO f FROM financial_accounts WHERE id = NEW.from_account_id;
  SELECT kind, branch_id, status INTO t FROM financial_accounts WHERE id = NEW.to_account_id;
  IF f.status <> 'active' OR t.status <> 'active' THEN
    RAISE EXCEPTION 'cash transfer between inactive accounts' USING ERRCODE = 'check_violation';
  END IF;
  IF (f.kind = 'register' AND t.kind = 'treasury' AND f.branch_id = t.branch_id)
     OR (f.kind = 'treasury' AND t.kind = 'register' AND f.branch_id = t.branch_id) THEN
    RETURN NEW;
  END IF;
  IF f.kind IN ('register', 'treasury') AND t.kind = 'bank'
     AND NEW.origin IN ('deposit', 'pos_movement') THEN
    RETURN NEW;
  END IF;
  IF ((f.kind = 'treasury' AND t.kind = 'in_transit') OR (f.kind = 'in_transit' AND t.kind = 'treasury'))
     AND NEW.origin = 'branch_transfer' AND NEW.branch_transfer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'cash transfer % → % is not allowed', f.kind, t.kind
    USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
-- A disbursement pays out of a register or treasury of its own branch; a reversal mirrors
-- exactly the record it cancels (which must not itself be a reversal).
CREATE FUNCTION cash_disbursements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  src record;
  orig record;
BEGIN
  SELECT kind, branch_id INTO src FROM financial_accounts WHERE id = NEW.source_account_id;
  IF src.kind NOT IN ('register', 'treasury') OR src.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'disbursements are paid from a register or treasury of their branch'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT * INTO orig FROM cash_disbursements WHERE id = NEW.reverses_id;
    IF orig.reverses_id IS NOT NULL OR orig.kind <> NEW.kind OR orig.amount_minor <> NEW.amount_minor
       OR orig.source_account_id <> NEW.source_account_id OR orig.branch_id <> NEW.branch_id
       OR orig.category IS DISTINCT FROM NEW.category OR orig.supplier_id IS DISTINCT FROM NEW.supplier_id
       OR orig.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id THEN
      RAISE EXCEPTION 'reversal does not match disbursement %', NEW.reverses_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_disbursements_guard BEFORE INSERT ON cash_disbursements
  FOR EACH ROW EXECUTE FUNCTION cash_disbursements_guard();
--> statement-breakpoint
-- Every disbursement is exactly one ledger entry on its source: − amount (+ for a reversal).
CREATE FUNCTION cash_disbursements_posted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n int;
  ok int;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE account_id = NEW.source_account_id
                            AND entry_type = NEW.kind
                            AND amount_minor = CASE WHEN NEW.reverses_id IS NULL
                                                    THEN -NEW.amount_minor ELSE NEW.amount_minor END)
    INTO n, ok
    FROM financial_account_entries
   WHERE source_type = 'cash_disbursement' AND source_id = NEW.id;
  IF n <> 1 OR ok <> 1 THEN
    RAISE EXCEPTION 'cash disbursement % is not posted', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cash_disbursements_posted AFTER INSERT ON cash_disbursements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cash_disbursements_posted();
--> statement-breakpoint
-- One company "in transit" account per merchant (cash between branches is still company cash).
INSERT INTO financial_accounts (id, merchant_id, kind, name_ar, name_en)
SELECT gen_random_uuid(), m.id, 'in_transit', 'نقد قيد النقل', 'Cash in transit'
  FROM merchants m
 WHERE NOT EXISTS (SELECT 1 FROM financial_accounts a WHERE a.merchant_id = m.id AND a.kind = 'in_transit');
