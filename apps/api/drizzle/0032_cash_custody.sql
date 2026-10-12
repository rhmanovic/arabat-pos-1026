CREATE TABLE "cash_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"origin" text NOT NULL,
	"cash_movement_id" uuid,
	"note" text,
	"idempotency_key" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_transfers_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "cash_transfers_amount_positive" CHECK ("cash_transfers"."amount_minor" > 0 and "cash_transfers"."amount_minor" <= 1000000000),
	CONSTRAINT "cash_transfers_distinct" CHECK ("cash_transfers"."from_account_id" <> "cash_transfers"."to_account_id"),
	CONSTRAINT "cash_transfers_origin_valid" CHECK ("cash_transfers"."origin" in ('pos_movement', 'manager'))
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" DROP CONSTRAINT "financial_accounts_kind_valid";--> statement-breakpoint
ALTER TABLE "financial_accounts" DROP CONSTRAINT "financial_accounts_status_valid";--> statement-breakpoint
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_closed_complete";--> statement-breakpoint
ALTER TABLE "registers" ADD CONSTRAINT "registers_merchant_id_id_branch_key" UNIQUE("merchant_id","id","branch_id");--> statement-breakpoint
ALTER TABLE "financial_account_entries" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "register_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "counted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registers" ADD COLUMN "needs_count" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "opening_expected_minor" bigint;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "opening_discrepancy_minor" bigint;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "opening_is_initial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "opening_follows_shift_id" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "opening_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "legacy_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_merchant_id_from_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","from_account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_merchant_id_to_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","to_account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_transfers_movement_key" ON "cash_transfers" USING btree ("cash_movement_id");--> statement-breakpoint
CREATE INDEX "cash_transfers_time_idx" ON "cash_transfers" USING btree ("merchant_id","created_at");--> statement-breakpoint
ALTER TABLE "financial_account_entries" ADD CONSTRAINT "financial_account_entries_merchant_id_shift_id_shifts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","shift_id") REFERENCES "public"."shifts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_merchant_id_register_id_branch_id_registers_merchant_id_id_branch_id_fk" FOREIGN KEY ("merchant_id","register_id","branch_id") REFERENCES "public"."registers"("merchant_id","id","branch_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_account_entries_shift_idx" ON "financial_account_entries" USING btree ("merchant_id","shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_one_per_register" ON "financial_accounts" USING btree ("register_id") WHERE "financial_accounts"."kind" = 'register';--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_one_treasury_per_branch" ON "financial_accounts" USING btree ("merchant_id","branch_id") WHERE "financial_accounts"."kind" = 'treasury' and "financial_accounts"."branch_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_one_company_treasury" ON "financial_accounts" USING btree ("merchant_id") WHERE "financial_accounts"."kind" = 'treasury' and "financial_accounts"."branch_id" is null;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_custody_shape" CHECK (("financial_accounts"."kind" = 'register' and "financial_accounts"."register_id" is not null and "financial_accounts"."branch_id" is not null)
       or ("financial_accounts"."kind" = 'treasury' and "financial_accounts"."register_id" is null)
       or ("financial_accounts"."kind" not in ('register', 'treasury') and "financial_accounts"."register_id" is null and "financial_accounts"."branch_id" is null));--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_kind_valid" CHECK ("financial_accounts"."kind" in ('cash', 'bank', 'card_clearing', 'wallet', 'other', 'register', 'treasury'));--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_status_valid" CHECK ("financial_accounts"."status" in ('active', 'inactive', 'archived'));--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opening_discrepancy_valid" CHECK ("shifts"."opening_discrepancy_minor" is null
          or "shifts"."opening_discrepancy_minor" = "shifts"."opening_float_minor" - "shifts"."opening_expected_minor");--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_complete" CHECK (("shifts"."status" = 'open' and "shifts"."closed_at" is null) or ("shifts"."status" = 'closed' and "shifts"."closed_at" is not null
           and "shifts"."expected_cash_minor" is not null and "shifts"."counted_cash_minor" is not null
           and "shifts"."discrepancy_minor" = "shifts"."counted_cash_minor" - "shifts"."expected_cash_minor"
           and "shifts"."close_type" in ('normal', 'forced'))
          or ("shifts"."status" = 'closed' and "shifts"."closed_at" is not null and "shifts"."close_type" = 'forced_uncounted'
           and "shifts"."counted_cash_minor" is null and "shifts"."discrepancy_minor" is null));