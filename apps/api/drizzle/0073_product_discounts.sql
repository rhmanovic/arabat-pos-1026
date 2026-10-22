CREATE TABLE "product_discounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"discount_type" text NOT NULL,
	"percent" numeric(5, 2),
	"amount_minor" bigint,
	"applies_to" text NOT NULL,
	"target_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pos_enabled" boolean DEFAULT true NOT NULL,
	"online_enabled" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_discounts_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_discounts_name_present" CHECK (coalesce("product_discounts"."name_en", "product_discounts"."name_ar") is not null),
	CONSTRAINT "product_discounts_type_valid" CHECK ("product_discounts"."discount_type" in ('percentage', 'amount')),
	CONSTRAINT "product_discounts_value_valid" CHECK (("product_discounts"."discount_type" = 'percentage' and "product_discounts"."percent" > 0 and "product_discounts"."percent" < 100 and "product_discounts"."amount_minor" is null)
          or ("product_discounts"."discount_type" = 'amount' and "product_discounts"."amount_minor" > 0 and "product_discounts"."percent" is null)),
	CONSTRAINT "product_discounts_applies_valid" CHECK ("product_discounts"."applies_to" in ('all', 'categories', 'collections', 'products')),
	CONSTRAINT "product_discounts_channel_present" CHECK ("product_discounts"."pos_enabled" or "product_discounts"."online_enabled"),
	CONSTRAINT "product_discounts_status_valid" CHECK ("product_discounts"."status" in ('active', 'paused', 'archived')),
	CONSTRAINT "product_discounts_dates_valid" CHECK ("product_discounts"."starts_at" is null or "product_discounts"."ends_at" is null or "product_discounts"."ends_at" > "product_discounts"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "online_order_lines" ADD COLUMN "regular_unit_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "online_order_lines" ADD COLUMN "product_discount_id" uuid;--> statement-breakpoint
ALTER TABLE "online_promotions" ADD COLUMN "stacks_with_discounts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "regular_unit_price_minor" bigint;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "product_discount_id" uuid;--> statement-breakpoint
ALTER TABLE "product_discounts" ADD CONSTRAINT "product_discounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_discounts_merchant_idx" ON "product_discounts" USING btree ("merchant_id","status");--> statement-breakpoint
ALTER TABLE "online_order_lines" ADD CONSTRAINT "online_order_lines_product_discount_id_product_discounts_id_fk" FOREIGN KEY ("product_discount_id") REFERENCES "public"."product_discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_discount_id_product_discounts_id_fk" FOREIGN KEY ("product_discount_id") REFERENCES "public"."product_discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_regular_price_valid" CHECK ("sale_lines"."regular_unit_price_minor" is null or ("sale_lines"."regular_unit_price_minor" > "sale_lines"."list_unit_price_minor" and "sale_lines"."product_discount_id" is not null));--> statement-breakpoint
ALTER TABLE product_discounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON product_discounts USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- A discount is named by sales: archived, never deleted.
REVOKE DELETE ON product_discounts FROM app_runtime;
