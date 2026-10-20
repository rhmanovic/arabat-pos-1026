CREATE TABLE "customer_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_accounts_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "customer_accounts_customer_key" UNIQUE("merchant_id","customer_id"),
	CONSTRAINT "customer_accounts_status_valid" CHECK ("customer_accounts"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"label" text,
	"delivery_area_id" uuid,
	"address" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_addresses_address_present" CHECK (length(trim("customer_addresses"."address")) > 0)
);
--> statement-breakpoint
CREATE TABLE "customer_password_resets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "online_promotion_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"promotion_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid,
	"customer_phone" text NOT NULL,
	"discount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_promotion_uses_order_key" UNIQUE("merchant_id","order_id"),
	CONSTRAINT "online_promotion_uses_amount_valid" CHECK ("online_promotion_uses"."discount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "online_promotions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"kind" text DEFAULT 'code' NOT NULL,
	"code" text,
	"discount_type" text NOT NULL,
	"percent" numeric(5, 2),
	"amount_minor" bigint,
	"minimum_order_minor" bigint DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"uses_count" integer DEFAULT 0 NOT NULL,
	"max_uses_per_customer" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"applies_to" text DEFAULT 'order' NOT NULL,
	"target_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_promotions_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "online_promotions_name_present" CHECK (coalesce("online_promotions"."name_en", "online_promotions"."name_ar") is not null),
	CONSTRAINT "online_promotions_kind_valid" CHECK ("online_promotions"."kind" in ('code', 'automatic')),
	CONSTRAINT "online_promotions_code_valid" CHECK (("online_promotions"."kind" = 'code') = ("online_promotions"."code" is not null) and ("online_promotions"."code" is null or "online_promotions"."code" ~ '^[A-Z0-9]{3,20}$')),
	CONSTRAINT "online_promotions_type_valid" CHECK ("online_promotions"."discount_type" in ('percentage', 'fixed', 'free_delivery')),
	CONSTRAINT "online_promotions_value_valid" CHECK (("online_promotions"."discount_type" = 'percentage' and "online_promotions"."percent" > 0 and "online_promotions"."percent" <= 100 and "online_promotions"."amount_minor" is null)
          or ("online_promotions"."discount_type" = 'fixed' and "online_promotions"."amount_minor" > 0 and "online_promotions"."percent" is null)
          or ("online_promotions"."discount_type" = 'free_delivery' and "online_promotions"."amount_minor" is null and "online_promotions"."percent" is null)),
	CONSTRAINT "online_promotions_status_valid" CHECK ("online_promotions"."status" in ('active', 'paused')),
	CONSTRAINT "online_promotions_applies_valid" CHECK ("online_promotions"."applies_to" in ('order', 'category', 'product')),
	CONSTRAINT "online_promotions_limits_valid" CHECK ("online_promotions"."minimum_order_minor" >= 0 and ("online_promotions"."max_uses" is null or "online_promotions"."max_uses" >= 1)
          and ("online_promotions"."max_uses_per_customer" is null or "online_promotions"."max_uses_per_customer" >= 1) and "online_promotions"."uses_count" >= 0),
	CONSTRAINT "online_promotions_dates_valid" CHECK ("online_promotions"."starts_at" is null or "online_promotions"."ends_at" is null or "online_promotions"."ends_at" > "online_promotions"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_totals";--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "promotion_id" uuid;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "promotion_code" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "promotion_name" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "discount_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "accounts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_merchant_id_customer_id_customers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","customer_id") REFERENCES "public"."customers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_delivery_area_id_online_delivery_areas_id_fk" FOREIGN KEY ("delivery_area_id") REFERENCES "public"."online_delivery_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_merchant_id_customer_id_customers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","customer_id") REFERENCES "public"."customers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_password_resets" ADD CONSTRAINT "customer_password_resets_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_password_resets" ADD CONSTRAINT "customer_password_resets_merchant_id_account_id_customer_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","account_id") REFERENCES "public"."customer_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_merchant_id_account_id_customer_accounts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","account_id") REFERENCES "public"."customer_accounts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_promotion_uses" ADD CONSTRAINT "online_promotion_uses_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_promotion_uses" ADD CONSTRAINT "online_promotion_uses_merchant_id_promotion_id_online_promotions_merchant_id_id_fk" FOREIGN KEY ("merchant_id","promotion_id") REFERENCES "public"."online_promotions"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_promotions" ADD CONSTRAINT "online_promotions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_email_key" ON "customer_accounts" USING btree ("merchant_id",lower("email"));--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_idx" ON "customer_addresses" USING btree ("merchant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_password_resets_token_key" ON "customer_password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_sessions_token_key" ON "customer_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_sessions_account_idx" ON "customer_sessions" USING btree ("merchant_id","account_id");--> statement-breakpoint
CREATE INDEX "online_promotion_uses_promotion_idx" ON "online_promotion_uses" USING btree ("merchant_id","promotion_id","customer_phone");--> statement-breakpoint
CREATE UNIQUE INDEX "online_promotions_code_key" ON "online_promotions" USING btree ("merchant_id","code") WHERE "online_promotions"."code" is not null;--> statement-breakpoint
CREATE INDEX "online_promotions_merchant_idx" ON "online_promotions" USING btree ("merchant_id","position");--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_promotion_id_online_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."online_promotions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_totals" CHECK ("online_orders"."total_minor" = "online_orders"."subtotal_minor" - "online_orders"."discount_minor" + "online_orders"."delivery_fee_minor"
          and "online_orders"."discount_minor" >= 0 and "online_orders"."discount_minor" <= "online_orders"."subtotal_minor" and "online_orders"."total_minor" > 0);--> statement-breakpoint
ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON customer_accounts USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE customer_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON customer_sessions USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE customer_password_resets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON customer_password_resets USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE customer_addresses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON customer_addresses USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE online_promotions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_promotions USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE online_promotion_uses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_promotion_uses USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- A promotion use is a fact: never edited or deleted.
REVOKE UPDATE, DELETE ON online_promotion_uses FROM app_runtime;
--> statement-breakpoint
-- A shopper's session is resolved before any merchant context exists (bearer token, ADR-0124):
-- SECURITY DEFINER runs as the table owner, which RLS does not filter.
CREATE OR REPLACE FUNCTION customer_session_lookup(p_token_hash bytea)
RETURNS TABLE (merchant_id uuid, account_id uuid, customer_id uuid, session_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  select s.merchant_id, s.account_id, a.customer_id, s.id
  from customer_sessions s join customer_accounts a on a.id = s.account_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
    and a.status = 'active'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION customer_session_lookup(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION customer_session_lookup(bytea) TO app_runtime;
