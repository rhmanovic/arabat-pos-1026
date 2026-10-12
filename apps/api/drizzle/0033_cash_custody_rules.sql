-- Cash custody (ADR-0090): RLS and append-only rules for transfers, ledger guards, and the
-- one-time cutover of every merchant to registers and branch treasuries.
ALTER TABLE cash_transfers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cash_transfers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON cash_transfers USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON cash_transfers FROM app_runtime;
--> statement-breakpoint
-- Ledger guard: archived accounts take no new entries; register entries carry the register's
-- open shift (and only then), so a shift's records always reconcile with the drawer.
CREATE FUNCTION financial_account_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  acc record;
  open_shift uuid;
BEGIN
  SELECT kind, status, register_id INTO acc FROM financial_accounts WHERE id = NEW.account_id;
  IF acc.status = 'archived' THEN
    RAISE EXCEPTION 'account % is archived', NEW.account_id USING ERRCODE = 'check_violation';
  END IF;
  IF acc.kind = 'register' THEN
    SELECT id INTO open_shift FROM shifts WHERE register_id = acc.register_id AND status = 'open';
    IF open_shift IS DISTINCT FROM NEW.shift_id THEN
      RAISE EXCEPTION 'register entry must carry the open shift %', open_shift
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.shift_id IS NOT NULL THEN
    RAISE EXCEPTION 'only register entries carry a shift' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER financial_account_entries_guard BEFORE INSERT ON financial_account_entries
  FOR EACH ROW EXECUTE FUNCTION financial_account_entries_guard();
--> statement-breakpoint
-- Allowed transfer directions (Phase A): a register and its branch treasury, both ways.
CREATE FUNCTION cash_transfers_direction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  f record;
  t record;
BEGIN
  SELECT kind, branch_id, status INTO f FROM financial_accounts WHERE id = NEW.from_account_id;
  SELECT kind, branch_id, status INTO t FROM financial_accounts WHERE id = NEW.to_account_id;
  IF f.status <> 'active' OR t.status <> 'active' THEN
    RAISE EXCEPTION 'cash transfer between inactive accounts' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((f.kind = 'register' AND t.kind = 'treasury' AND f.branch_id = t.branch_id)
       OR (f.kind = 'treasury' AND t.kind = 'register' AND f.branch_id = t.branch_id)) THEN
    RAISE EXCEPTION 'cash transfer % → % is not allowed', f.kind, t.kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_transfers_direction BEFORE INSERT ON cash_transfers
  FOR EACH ROW EXECUTE FUNCTION cash_transfers_direction();
--> statement-breakpoint
-- Every transfer is exactly its two ledger entries (− from, + to), checked at commit.
CREATE FUNCTION cash_transfers_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n int;
  out_ok int;
  in_ok int;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE account_id = NEW.from_account_id AND amount_minor = -NEW.amount_minor),
         count(*) FILTER (WHERE account_id = NEW.to_account_id AND amount_minor = NEW.amount_minor)
    INTO n, out_ok, in_ok
    FROM financial_account_entries
   WHERE source_type = 'cash_transfer' AND source_id = NEW.id;
  IF n <> 2 OR out_ok <> 1 OR in_ok <> 1 THEN
    RAISE EXCEPTION 'cash transfer % is not balanced', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cash_transfers_balanced AFTER INSERT ON cash_transfers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cash_transfers_balanced();
--> statement-breakpoint
-- One-time cutover of a merchant (guarded: a merchant with a treasury is already done).
-- History is never moved or reset: the old cash account is archived as it is, and new
-- treasuries and register drawers start at zero until their first physical count.
CREATE FUNCTION cash_custody_cutover(p_merchant uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM financial_accounts WHERE merchant_id = p_merchant AND kind = 'treasury') THEN
    RETURN false;
  END IF;
  UPDATE financial_accounts
     SET status = 'archived',
         name_ar = CASE WHEN name_ar IS NULL OR name_ar IN ('الخزينة', 'صندوق النقد')
                        THEN 'حساب النقد القديم' ELSE name_ar END,
         name_en = CASE WHEN name_en IS NULL OR name_en IN ('Cash on hand', 'Cash box')
                        THEN 'Old cash account' ELSE name_en END,
         version = version + 1, updated_at = now()
   WHERE merchant_id = p_merchant AND kind = 'cash' AND status <> 'archived';
  UPDATE payment_methods SET financial_account_id = NULL, version = version + 1, updated_at = now()
   WHERE merchant_id = p_merchant AND kind = 'cash' AND financial_account_id IS NOT NULL;
  INSERT INTO financial_accounts (id, merchant_id, kind, branch_id, name_ar, name_en)
  SELECT gen_random_uuid(), b.merchant_id, 'treasury', b.id,
         'خزينة ' || coalesce(b.name_ar, b.name_en), coalesce(b.name_en, b.name_ar) || ' treasury'
    FROM branches b WHERE b.merchant_id = p_merchant;
  INSERT INTO financial_accounts (id, merchant_id, kind, branch_id, register_id, name_ar, name_en)
  SELECT gen_random_uuid(), r.merchant_id, 'register', r.branch_id, r.id,
         coalesce(r.name_ar, r.name_en), coalesce(r.name_en, r.name_ar)
    FROM registers r WHERE r.merchant_id = p_merchant;
  UPDATE registers SET needs_count = true WHERE merchant_id = p_merchant;
  UPDATE shifts SET legacy_open = true WHERE merchant_id = p_merchant AND status = 'open';
  INSERT INTO audit_log (id, merchant_id, actor_type, action, target_type, details)
  VALUES (gen_random_uuid(), p_merchant, 'system', 'cash.cutover', 'merchant',
          jsonb_build_object('adr', 'ADR-0090'));
  RETURN true;
END $$;
--> statement-breakpoint
SELECT cash_custody_cutover(id) FROM merchants;
--> statement-breakpoint
-- Owner decision (ADR-0090): cashiers no longer record cash in/out by default; the owner
-- grants it to whom they choose. Supervisors keep it.
WITH removed AS (
  DELETE FROM role_permissions rp USING roles r
   WHERE r.id = rp.role_id AND r.template_key = 'cashier' AND rp.permission_key = 'cash.move'
  RETURNING rp.merchant_id, rp.role_id
)
INSERT INTO audit_log (id, merchant_id, actor_type, action, target_type, target_id, details)
SELECT gen_random_uuid(), merchant_id, 'system', 'role.permissions_changed', 'role', role_id,
       jsonb_build_object('removed', jsonb_build_array('cash.move'), 'adr', 'ADR-0090')
  FROM removed;
