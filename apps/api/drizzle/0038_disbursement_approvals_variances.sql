-- Remediation R1.2 / R1.4 (ADR-0095, BR-166, BR-167): disbursement approvals, payout requests, variance follow-ups.
CREATE TABLE "cash_payout_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text,
	"supplier_id" uuid,
	"purchase_order_id" uuid,
	"amount_minor" bigint NOT NULL,
	"description" text,
	"receipt_reference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"disbursement_id" uuid,
	"idempotency_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_payout_requests_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "cash_payout_requests_kind_valid" CHECK ("cash_payout_requests"."kind" in ('expense', 'supplier_payment')),
	CONSTRAINT "cash_payout_requests_status_valid" CHECK ("cash_payout_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "cash_payout_requests_amount_positive" CHECK ("cash_payout_requests"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "variance_followups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"resolved_by_user_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variance_followups_source_key" UNIQUE("merchant_id","source_type","source_id"),
	CONSTRAINT "variance_followups_source_valid" CHECK ("variance_followups"."source_type" in ('shift_close', 'shift_opening', 'account_count', 'branch_transfer')),
	CONSTRAINT "variance_followups_status_valid" CHECK ("variance_followups"."status" in ('explained', 'settled', 'written_off'))
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "expense_category" text;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "supplier_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "receipt_reference" text;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "expense_approval_limit_minor" bigint DEFAULT 20000 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "supplier_payment_approval_limit_minor" bigint DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_payout_requests" ADD CONSTRAINT "cash_payout_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_payout_requests" ADD CONSTRAINT "cash_payout_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_payout_requests" ADD CONSTRAINT "cash_payout_requests_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_payout_requests" ADD CONSTRAINT "cash_payout_requests_merchant_id_supplier_id_suppliers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","supplier_id") REFERENCES "public"."suppliers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_payout_requests" ADD CONSTRAINT "cash_payout_requests_merchant_id_disbursement_id_cash_disbursements_merchant_id_id_fk" FOREIGN KEY ("merchant_id","disbursement_id") REFERENCES "public"."cash_disbursements"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variance_followups" ADD CONSTRAINT "variance_followups_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_payout_requests_branch_idx" ON "cash_payout_requests" USING btree ("merchant_id","branch_id","status");--> statement-breakpoint
ALTER TABLE cash_payout_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE cash_payout_requests FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON cash_payout_requests USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON cash_payout_requests FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, decided_by_user_id, decided_at, decision_note, disbursement_id) ON cash_payout_requests TO app_runtime;
--> statement-breakpoint
-- A pending request is decided once, into a final state; nothing else may change.
CREATE FUNCTION cash_payout_requests_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'payout request % is final', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected', 'withdrawn') THEN
    RAISE EXCEPTION 'payout request % must be decided into a final state', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'approved' AND NEW.disbursement_id IS NULL THEN
    RAISE EXCEPTION 'approved payout request % needs its disbursement', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cash_payout_requests_decision BEFORE UPDATE ON cash_payout_requests
  FOR EACH ROW EXECUTE FUNCTION cash_payout_requests_decision();
--> statement-breakpoint
ALTER TABLE variance_followups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE variance_followups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON variance_followups USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- Follow-ups are management annotations: they may be revised (audited), never deleted.
REVOKE DELETE ON variance_followups FROM app_runtime;
