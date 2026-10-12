CREATE TABLE "financial_account_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"description" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_account_entries_nonzero" CHECK ("financial_account_entries"."amount_minor" <> 0),
	CONSTRAINT "financial_account_entries_type_valid" CHECK ("financial_account_entries"."entry_type" in ('payment', 'fee', 'refund', 'cash_movement', 'transfer', 'adjustment'))
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"kind" text NOT NULL,
	"currency" char(3) DEFAULT 'KWD' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_accounts_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "financial_accounts_name_present" CHECK (coalesce("financial_accounts"."name_en", "financial_accounts"."name_ar") is not null),
	CONSTRAINT "financial_accounts_kind_valid" CHECK ("financial_accounts"."kind" in ('cash', 'bank', 'card_clearing', 'wallet', 'other')),
	CONSTRAINT "financial_accounts_status_valid" CHECK ("financial_accounts"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name_en" text,
	"name_ar" text,
	"status" text DEFAULT 'active' NOT NULL,
	"available_in_pos" boolean DEFAULT true NOT NULL,
	"available_online" boolean DEFAULT false NOT NULL,
	"fee_type" text DEFAULT 'none' NOT NULL,
	"fee_fixed_minor" bigint DEFAULT 0 NOT NULL,
	"fee_percent" numeric(6, 3) DEFAULT '0' NOT NULL,
	"financial_account_id" uuid,
	"gateway_provider" text,
	"gateway_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "payment_methods_name_present" CHECK (coalesce("payment_methods"."name_en", "payment_methods"."name_ar") is not null),
	CONSTRAINT "payment_methods_kind_valid" CHECK ("payment_methods"."kind" in ('cash', 'card', 'bank_transfer', 'custom')),
	CONSTRAINT "payment_methods_status_valid" CHECK ("payment_methods"."status" in ('active', 'inactive')),
	CONSTRAINT "payment_methods_fee_type_valid" CHECK ("payment_methods"."fee_type" in ('none', 'fixed', 'percentage', 'fixed_plus_percentage')),
	CONSTRAINT "payment_methods_fee_range" CHECK ("payment_methods"."fee_fixed_minor" >= 0 and "payment_methods"."fee_fixed_minor" <= 1000000000 and "payment_methods"."fee_percent" >= 0 and "payment_methods"."fee_percent" <= 100),
	CONSTRAINT "payment_methods_gateway_valid" CHECK ("payment_methods"."gateway_provider" is null or "payment_methods"."gateway_provider" in ('tap', 'upayments', 'hesabe', 'bookeey', 'mock'))
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"idempotency_key" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "cash_movements_kind_valid" CHECK ("cash_movements"."kind" in ('cash_in', 'cash_out')),
	CONSTRAINT "cash_movements_amount_positive" CHECK ("cash_movements"."amount_minor" > 0 and "cash_movements"."amount_minor" <= 1000000000)
);
--> statement-breakpoint
CREATE TABLE "register_members" (
	"merchant_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	CONSTRAINT "register_members_register_id_membership_id_pk" PRIMARY KEY("register_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "registers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text,
	"name_ar" text,
	"status" text DEFAULT 'active' NOT NULL,
	"access_mode" text DEFAULT 'branch' NOT NULL,
	"default_opening_float_minor" bigint DEFAULT 0 NOT NULL,
	"discrepancy_tolerance_minor" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registers_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "registers_name_present" CHECK (coalesce("registers"."name_en", "registers"."name_ar") is not null),
	CONSTRAINT "registers_status_valid" CHECK ("registers"."status" in ('active', 'inactive')),
	CONSTRAINT "registers_access_mode_valid" CHECK ("registers"."access_mode" in ('branch', 'restricted')),
	CONSTRAINT "registers_amounts_valid" CHECK ("registers"."default_opening_float_minor" >= 0 and "registers"."discrepancy_tolerance_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opening_float_minor" bigint NOT NULL,
	"opening_note" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"close_type" text,
	"expected_cash_minor" bigint,
	"counted_cash_minor" bigint,
	"discrepancy_minor" bigint,
	"counted_breakdown" jsonb,
	"closing_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "shifts_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "shifts_status_valid" CHECK ("shifts"."status" in ('open', 'closed')),
	CONSTRAINT "shifts_opening_float_valid" CHECK ("shifts"."opening_float_minor" >= 0),
	CONSTRAINT "shifts_closed_complete" CHECK (("shifts"."status" = 'open' and "shifts"."closed_at" is null) or ("shifts"."status" = 'closed' and "shifts"."closed_at" is not null
           and "shifts"."expected_cash_minor" is not null and "shifts"."counted_cash_minor" is not null
           and "shifts"."discrepancy_minor" = "shifts"."counted_cash_minor" - "shifts"."expected_cash_minor"
           and "shifts"."close_type" in ('normal', 'forced')))
);
--> statement-breakpoint
ALTER TABLE "financial_account_entries" ADD CONSTRAINT "financial_account_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_account_entries" ADD CONSTRAINT "financial_account_entries_merchant_id_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_merchant_id_financial_account_id_financial_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","financial_account_id") REFERENCES "public"."financial_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_merchant_id_shift_id_shifts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","shift_id") REFERENCES "public"."shifts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_members" ADD CONSTRAINT "register_members_merchant_id_register_id_registers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","register_id") REFERENCES "public"."registers"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_members" ADD CONSTRAINT "register_members_merchant_id_membership_id_memberships_merchant_id_id_fk" FOREIGN KEY ("merchant_id","membership_id") REFERENCES "public"."memberships"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registers" ADD CONSTRAINT "registers_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_merchant_id_register_id_registers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","register_id") REFERENCES "public"."registers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_merchant_id_membership_id_memberships_merchant_id_id_fk" FOREIGN KEY ("merchant_id","membership_id") REFERENCES "public"."memberships"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_account_entries_account_idx" ON "financial_account_entries" USING btree ("merchant_id","account_id","created_at");--> statement-breakpoint
CREATE INDEX "financial_account_entries_source_idx" ON "financial_account_entries" USING btree ("merchant_id","source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_one_cash" ON "payment_methods" USING btree ("merchant_id") WHERE "payment_methods"."kind" = 'cash';--> statement-breakpoint
CREATE INDEX "cash_movements_shift_idx" ON "cash_movements" USING btree ("merchant_id","shift_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registers_branch_code_key" ON "registers" USING btree ("merchant_id","branch_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_per_register" ON "shifts" USING btree ("register_id") WHERE "shifts"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_one_open_per_member" ON "shifts" USING btree ("membership_id") WHERE "shifts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "shifts_branch_opened_idx" ON "shifts" USING btree ("merchant_id","branch_id","opened_at");