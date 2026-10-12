CREATE TABLE "cash_branch_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount_sent_minor" bigint NOT NULL,
	"amount_received_minor" bigint,
	"status" text DEFAULT 'in_transit' NOT NULL,
	"send_note" text,
	"receive_note" text,
	"cancel_note" text,
	"idempotency_key" uuid,
	"sent_by_user_id" uuid NOT NULL,
	"received_by_user_id" uuid,
	"received_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_branch_transfers_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "cash_branch_transfers_number_key" UNIQUE("merchant_id","number"),
	CONSTRAINT "cash_branch_transfers_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "cash_branch_transfers_distinct" CHECK ("cash_branch_transfers"."from_branch_id" <> "cash_branch_transfers"."to_branch_id"),
	CONSTRAINT "cash_branch_transfers_amounts" CHECK ("cash_branch_transfers"."amount_sent_minor" > 0 and "cash_branch_transfers"."amount_sent_minor" <= 1000000000
       and ("cash_branch_transfers"."amount_received_minor" is null or ("cash_branch_transfers"."amount_received_minor" >= 0 and "cash_branch_transfers"."amount_received_minor" <= 1000000000))),
	CONSTRAINT "cash_branch_transfers_status_shape" CHECK (("cash_branch_transfers"."status" = 'in_transit' and "cash_branch_transfers"."amount_received_minor" is null and "cash_branch_transfers"."received_at" is null and "cash_branch_transfers"."cancelled_at" is null)
       or ("cash_branch_transfers"."status" = 'received' and "cash_branch_transfers"."amount_received_minor" is not null and "cash_branch_transfers"."received_by_user_id" is not null and "cash_branch_transfers"."received_at" is not null)
       or ("cash_branch_transfers"."status" = 'cancelled' and "cash_branch_transfers"."cancelled_by_user_id" is not null and "cash_branch_transfers"."cancelled_at" is not null and "cash_branch_transfers"."amount_received_minor" is null))
);
--> statement-breakpoint
CREATE TABLE "cash_disbursements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"source_account_id" uuid NOT NULL,
	"shift_id" uuid,
	"cash_movement_id" uuid,
	"kind" text NOT NULL,
	"category" text,
	"supplier_id" uuid,
	"purchase_order_id" uuid,
	"amount_minor" bigint NOT NULL,
	"description" text,
	"receipt_reference" text,
	"reverses_id" uuid,
	"idempotency_key" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_disbursements_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "cash_disbursements_number_key" UNIQUE("merchant_id","number"),
	CONSTRAINT "cash_disbursements_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "cash_disbursements_amount_positive" CHECK ("cash_disbursements"."amount_minor" > 0 and "cash_disbursements"."amount_minor" <= 1000000000),
	CONSTRAINT "cash_disbursements_shape" CHECK (("cash_disbursements"."kind" = 'expense' and "cash_disbursements"."category" is not null and "cash_disbursements"."supplier_id" is null and "cash_disbursements"."purchase_order_id" is null)
       or ("cash_disbursements"."kind" = 'supplier_payment' and "cash_disbursements"."supplier_id" is not null and "cash_disbursements"."category" is null)),
	CONSTRAINT "cash_disbursements_category_valid" CHECK ("cash_disbursements"."category" is null or "cash_disbursements"."category" in ('supplies', 'maintenance', 'transport', 'hospitality', 'utilities', 'cleaning', 'other')),
	CONSTRAINT "cash_disbursements_other_described" CHECK ("cash_disbursements"."category" is distinct from 'other' or "cash_disbursements"."description" is not null)
);
--> statement-breakpoint
ALTER TABLE "cash_transfers" DROP CONSTRAINT "cash_transfers_origin_valid";--> statement-breakpoint
ALTER TABLE "financial_account_entries" DROP CONSTRAINT "financial_account_entries_type_valid";--> statement-breakpoint
ALTER TABLE "financial_accounts" DROP CONSTRAINT "financial_accounts_kind_valid";--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD COLUMN "branch_transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "bank_account_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_branch_transfers" ADD CONSTRAINT "cash_branch_transfers_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_branch_transfers" ADD CONSTRAINT "cash_branch_transfers_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_branch_transfers" ADD CONSTRAINT "cash_branch_transfers_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_branch_transfers" ADD CONSTRAINT "cash_branch_transfers_merchant_id_from_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","from_branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_branch_transfers" ADD CONSTRAINT "cash_branch_transfers_merchant_id_to_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","to_branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_branch_transfers" ADD CONSTRAINT "cash_branch_transfers_merchant_id_from_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","from_account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_branch_transfers" ADD CONSTRAINT "cash_branch_transfers_merchant_id_to_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","to_account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_merchant_id_id_supplier_key" UNIQUE("merchant_id","id","supplier_id");--> statement-breakpoint
ALTER TABLE "cash_disbursements" ADD CONSTRAINT "cash_disbursements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_disbursements" ADD CONSTRAINT "cash_disbursements_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_disbursements" ADD CONSTRAINT "cash_disbursements_merchant_id_source_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","source_account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_disbursements" ADD CONSTRAINT "cash_disbursements_merchant_id_shift_id_shifts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","shift_id") REFERENCES "public"."shifts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_disbursements" ADD CONSTRAINT "cash_disbursements_merchant_id_supplier_id_suppliers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","supplier_id") REFERENCES "public"."suppliers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_disbursements" ADD CONSTRAINT "cash_disbursements_merchant_id_purchase_order_id_supplier_id_purchase_orders_merchant_id_id_supplier_id_fk" FOREIGN KEY ("merchant_id","purchase_order_id","supplier_id") REFERENCES "public"."purchase_orders"("merchant_id","id","supplier_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_disbursements" ADD CONSTRAINT "cash_disbursements_merchant_id_reverses_id_cash_disbursements_merchant_id_id_fk" FOREIGN KEY ("merchant_id","reverses_id") REFERENCES "public"."cash_disbursements"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_branch_transfers_status_idx" ON "cash_branch_transfers" USING btree ("merchant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_disbursements_one_reversal" ON "cash_disbursements" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "cash_disbursements_time_idx" ON "cash_disbursements" USING btree ("merchant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "cash_disbursements_supplier_idx" ON "cash_disbursements" USING btree ("merchant_id","supplier_id","created_at");--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_merchant_id_branch_transfer_id_cash_branch_transfers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_transfer_id") REFERENCES "public"."cash_branch_transfers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_one_in_transit" ON "financial_accounts" USING btree ("merchant_id") WHERE "financial_accounts"."kind" = 'in_transit';--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_origin_valid" CHECK ("cash_transfers"."origin" in ('pos_movement', 'manager', 'deposit', 'branch_transfer'));--> statement-breakpoint
ALTER TABLE "financial_account_entries" ADD CONSTRAINT "financial_account_entries_type_valid" CHECK ("financial_account_entries"."entry_type" in ('payment', 'fee', 'refund', 'cash_movement', 'transfer', 'adjustment', 'expense', 'supplier_payment'));--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_kind_valid" CHECK ("financial_accounts"."kind" in ('cash', 'bank', 'card_clearing', 'wallet', 'other', 'register', 'treasury', 'in_transit'));