CREATE TABLE "online_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"image_key" text,
	"image_content_type" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_categories_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "online_categories_name_present" CHECK (coalesce("online_categories"."name_en", "online_categories"."name_ar") is not null),
	CONSTRAINT "online_categories_status_valid" CHECK ("online_categories"."status" in ('active', 'hidden')),
	CONSTRAINT "online_categories_image_pair" CHECK (("online_categories"."image_key" is null) = ("online_categories"."image_content_type" is null))
);
--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "title_ar" text;--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "description_en" text;--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "description_ar" text;--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "max_per_order" integer;--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "online_category_id" uuid;--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "logo_content_type" text;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "banner_key" text;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "banner_content_type" text;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "hide_out_of_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "online_categories" ADD CONSTRAINT "online_categories_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_categories_merchant_idx" ON "online_categories" USING btree ("merchant_id","position");--> statement-breakpoint
ALTER TABLE "online_listings" ADD CONSTRAINT "online_listings_merchant_id_online_category_id_online_categories_merchant_id_id_fk" FOREIGN KEY ("merchant_id","online_category_id") REFERENCES "public"."online_categories"("merchant_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_listings" ADD CONSTRAINT "online_listings_max_per_order_valid" CHECK ("online_listings"."max_per_order" is null or ("online_listings"."max_per_order" between 1 and 20));--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_logo_pair" CHECK (("online_stores"."logo_key" is null) = ("online_stores"."logo_content_type" is null));--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_banner_pair" CHECK (("online_stores"."banner_key" is null) = ("online_stores"."banner_content_type" is null));--> statement-breakpoint
-- Online store Phase 4 (ADR-0121): the store's own categories (RLS enabled, not forced, ADR-0105).
ALTER TABLE online_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_categories USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
