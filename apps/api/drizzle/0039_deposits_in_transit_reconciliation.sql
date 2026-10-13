-- Remediation R1.3 (ADR-0096, BR-168): bank deposits in transit confirmed by a second person, and manual bank reconciliation.
CREATE TABLE "bank_reconciliation_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	CONSTRAINT "bank_reconciliation_items_entry_key" UNIQUE("merchant_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "bank_reconciliations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" text NOT NULL,
	"statement_balance_minor" bigint NOT NULL,
	"book_balance_minor" bigint NOT NULL,
	"cleared_balance_minor" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_reconciliations_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "bank_reconciliations_difference_explained" CHECK ("bank_reconciliations"."difference_minor" = 0 or "bank_reconciliations"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "cash_transfers" DROP CONSTRAINT "cash_transfers_origin_valid";--> statement-breakpoint
ALTER TABLE "financial_accounts" DROP CONSTRAINT "financial_accounts_kind_valid";--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD COLUMN "target_account_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD COLUMN "confirms_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_reconciliation_items" ADD CONSTRAINT "bank_reconciliation_items_merchant_id_reconciliation_id_bank_reconciliations_merchant_id_id_fk" FOREIGN KEY ("merchant_id","reconciliation_id") REFERENCES "public"."bank_reconciliations"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_account_entries" ADD CONSTRAINT "financial_account_entries_merchant_id_id_key" UNIQUE("merchant_id","id");--> statement-breakpoint
ALTER TABLE "bank_reconciliation_items" ADD CONSTRAINT "bank_reconciliation_items_merchant_id_entry_id_financial_account_entries_merchant_id_id_fk" FOREIGN KEY ("merchant_id","entry_id") REFERENCES "public"."financial_account_entries"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_merchant_id_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_reconciliations_account_idx" ON "bank_reconciliations" USING btree ("merchant_id","account_id","created_at");--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_merchant_id_target_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","target_account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_confirms_transfer_id_cash_transfers_id_fk" FOREIGN KEY ("confirms_transfer_id") REFERENCES "public"."cash_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_transfers_confirms_key" ON "cash_transfers" USING btree ("confirms_transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_one_deposit_transit" ON "financial_accounts" USING btree ("merchant_id") WHERE "financial_accounts"."kind" = 'deposit_transit';--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_origin_valid" CHECK ("cash_transfers"."origin" in ('pos_movement', 'manager', 'deposit', 'branch_transfer', 'deposit_confirmation', 'deposit_return'));--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_kind_valid" CHECK ("financial_accounts"."kind" in ('cash', 'bank', 'card_clearing', 'wallet', 'other', 'register', 'treasury', 'in_transit', 'deposit_transit'));--> statement-breakpoint
ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bank_reconciliations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON bank_reconciliations USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON bank_reconciliations FROM app_runtime;
--> statement-breakpoint
ALTER TABLE bank_reconciliation_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE bank_reconciliation_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON bank_reconciliation_items USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON bank_reconciliation_items FROM app_runtime;
--> statement-breakpoint
-- A reconciliation only ticks entries of its own bank account.
CREATE FUNCTION bank_reconciliation_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec_account uuid;
  entry_account uuid;
BEGIN
  SELECT account_id INTO rec_account FROM bank_reconciliations WHERE id = NEW.reconciliation_id;
  SELECT account_id INTO entry_account FROM financial_account_entries WHERE id = NEW.entry_id;
  IF rec_account IS NULL OR rec_account <> entry_account THEN
    RAISE EXCEPTION 'entry % does not belong to the reconciled account', NEW.entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER bank_reconciliation_items_guard BEFORE INSERT ON bank_reconciliation_items
  FOR EACH ROW EXECUTE FUNCTION bank_reconciliation_items_guard();
--> statement-breakpoint
-- Allowed transfer directions (replaces 0035): a register and its branch treasury (both ways);
-- a register or treasury into the deposit-in-transit account (a deposit, which must name its
-- bank); the deposit-in-transit account into that bank (a confirmation) or back into a treasury
-- (a return), each naming the deposit it settles; a treasury into or out of the company
-- in-transit account (branch transfers, which must name the branch transfer).
CREATE OR REPLACE FUNCTION cash_transfers_direction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  f record;
  t record;
  g record;
  d record;
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
  IF f.kind IN ('register', 'treasury') AND t.kind = 'deposit_transit'
     AND NEW.origin IN ('deposit', 'pos_movement') AND NEW.target_account_id IS NOT NULL THEN
    SELECT kind, status INTO g FROM financial_accounts WHERE id = NEW.target_account_id;
    IF g.kind <> 'bank' OR g.status <> 'active' THEN
      RAISE EXCEPTION 'a deposit must name an active bank account' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF f.kind = 'deposit_transit' AND NEW.origin IN ('deposit_confirmation', 'deposit_return')
     AND NEW.confirms_transfer_id IS NOT NULL THEN
    SELECT * INTO d FROM cash_transfers WHERE id = NEW.confirms_transfer_id;
    IF d.to_account_id <> NEW.from_account_id OR d.amount_minor <> NEW.amount_minor
       OR d.origin NOT IN ('deposit', 'pos_movement') THEN
      RAISE EXCEPTION 'confirmation does not match deposit %', NEW.confirms_transfer_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.origin = 'deposit_confirmation' AND t.kind = 'bank' AND NEW.to_account_id = d.target_account_id THEN
      RETURN NEW;
    END IF;
    IF NEW.origin = 'deposit_return' AND t.kind = 'treasury' THEN
      RETURN NEW;
    END IF;
  END IF;
  IF ((f.kind = 'treasury' AND t.kind = 'in_transit') OR (f.kind = 'in_transit' AND t.kind = 'treasury'))
     AND NEW.origin = 'branch_transfer' AND NEW.branch_transfer_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'cash transfer % → % is not allowed', f.kind, t.kind
    USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
-- One company "deposits in transit" account per merchant.
INSERT INTO financial_accounts (id, merchant_id, kind, name_ar, name_en)
SELECT gen_random_uuid(), m.id, 'deposit_transit', 'إيداعات في الطريق', 'Deposits in transit'
  FROM merchants m
 WHERE NOT EXISTS (SELECT 1 FROM financial_accounts a WHERE a.merchant_id = m.id AND a.kind = 'deposit_transit');
