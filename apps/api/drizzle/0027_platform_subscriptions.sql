CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"description_en" text,
	"description_ar" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"max_branches" integer,
	"max_employees" integer,
	"max_products" integer,
	"max_registers" integer,
	"features" text[] DEFAULT '{}'::text[] NOT NULL,
	"price_minor" bigint,
	"currency" char(3) DEFAULT 'KWD' NOT NULL,
	"billing_period" text,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_status_valid" CHECK ("plans"."status" in ('active', 'archived')),
	CONSTRAINT "plans_default_active" CHECK (not "plans"."is_default" or "plans"."status" = 'active'),
	CONSTRAINT "plans_limits_valid" CHECK (coalesce("plans"."max_branches", 1) >= 1 and coalesce("plans"."max_employees", 0) >= 0
          and coalesce("plans"."max_products", 0) >= 0 and coalesce("plans"."max_registers", 1) >= 1),
	CONSTRAINT "plans_features_valid" CHECK ("plans"."features" <@ array['restaurant', 'ecommerce']::text[]),
	CONSTRAINT "plans_price_valid" CHECK ("plans"."price_minor" is null or "plans"."price_minor" >= 0),
	CONSTRAINT "plans_period_valid" CHECK ("plans"."billing_period" is null or "plans"."billing_period" in ('month', 'year')),
	CONSTRAINT "plans_trial_valid" CHECK ("plans"."trial_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_plan_id" uuid,
	"to_plan_id" uuid,
	"from_status" text,
	"to_status" text,
	"operator_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_events_kind_valid" CHECK ("subscription_events"."kind" in ('created', 'changed'))
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_merchant_key" UNIQUE("merchant_id"),
	CONSTRAINT "subscriptions_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "subscriptions_status_valid" CHECK ("subscriptions"."status" in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
	CONSTRAINT "subscriptions_trial_valid" CHECK ("subscriptions"."status" <> 'trialing' or "subscriptions"."trial_ends_at" is not null),
	CONSTRAINT "subscriptions_dates_valid" CHECK ("subscriptions"."ends_at" is null or "subscriptions"."ends_at" > "subscriptions"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_from_plan_id_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_to_plan_id_plans_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_operator_id_platform_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."platform_operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_merchant_id_subscription_id_subscriptions_merchant_id_id_fk" FOREIGN KEY ("merchant_id","subscription_id") REFERENCES "public"."subscriptions"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_key" ON "plans" USING btree (lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "plans_default_key" ON "plans" USING btree ("is_default") WHERE "plans"."is_default";--> statement-breakpoint
CREATE INDEX "subscription_events_merchant_idx" ON "subscription_events" USING btree ("merchant_id","created_at");