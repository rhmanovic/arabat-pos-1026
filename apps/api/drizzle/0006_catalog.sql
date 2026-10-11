CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name_en" text,
	"name_ar" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "categories_name_present" CHECK (coalesce("categories"."name_en", "categories"."name_ar") is not null),
	CONSTRAINT "categories_status_valid" CHECK ("categories"."status" in ('active', 'archived')),
	CONSTRAINT "categories_not_own_parent" CHECK ("categories"."parent_id" is null or "categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE TABLE "product_barcodes" (
	"merchant_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"variant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_barcodes_merchant_id_barcode_pk" PRIMARY KEY("merchant_id","barcode"),
	CONSTRAINT "product_barcodes_format" CHECK ("product_barcodes"."barcode" ~ '^[A-Za-z0-9._-]{3,64}$')
);
--> statement-breakpoint
CREATE TABLE "product_branch_availability" (
	"merchant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	CONSTRAINT "product_branch_availability_product_id_branch_id_pk" PRIMARY KEY("product_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_images_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_images_type_valid" CHECK ("product_images"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "product_images_size_valid" CHECK ("product_images"."size_bytes" > 0 and "product_images"."size_bytes" <= 5242880)
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"sku" text,
	"price_minor" bigint NOT NULL,
	"cost_minor" bigint,
	"currency" char(3) DEFAULT 'KWD' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "product_variants_price_range" CHECK ("product_variants"."price_minor" >= 0 and "product_variants"."price_minor" <= 1000000000000),
	CONSTRAINT "product_variants_cost_range" CHECK ("product_variants"."cost_minor" is null or ("product_variants"."cost_minor" >= 0 and "product_variants"."cost_minor" <= 1000000000000)),
	CONSTRAINT "product_variants_status_valid" CHECK ("product_variants"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"category_id" uuid,
	"name_en" text,
	"name_ar" text,
	"description_en" text,
	"description_ar" text,
	"type" text DEFAULT 'standard' NOT NULL,
	"has_variants" boolean DEFAULT false NOT NULL,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"available_in_all_branches" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "products_name_present" CHECK (coalesce("products"."name_en", "products"."name_ar") is not null),
	CONSTRAINT "products_type_valid" CHECK ("products"."type" in ('standard', 'service')),
	CONSTRAINT "products_status_valid" CHECK ("products"."status" in ('active', 'archived')),
	CONSTRAINT "products_service_not_tracked" CHECK ("products"."type" = 'standard' or not "products"."track_inventory")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_merchant_id_parent_id_categories_merchant_id_id_fk" FOREIGN KEY ("merchant_id","parent_id") REFERENCES "public"."categories"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_merchant_id_variant_id_product_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variants"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_branch_availability" ADD CONSTRAINT "product_branch_availability_merchant_id_product_id_products_merchant_id_id_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."products"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_branch_availability" ADD CONSTRAINT "product_branch_availability_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_merchant_id_product_id_products_merchant_id_id_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."products"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_merchant_id_product_id_products_merchant_id_id_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."products"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_category_id_categories_merchant_id_id_fk" FOREIGN KEY ("merchant_id","category_id") REFERENCES "public"."categories"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_barcodes_variant_idx" ON "product_barcodes" USING btree ("merchant_id","variant_id");--> statement-breakpoint
CREATE INDEX "product_branch_availability_branch_idx" ON "product_branch_availability" USING btree ("merchant_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_merchant_sku_key" ON "product_variants" USING btree ("merchant_id",lower("sku")) WHERE "product_variants"."sku" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_one_default" ON "product_variants" USING btree ("product_id") WHERE "product_variants"."is_default";--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("merchant_id","product_id");--> statement-breakpoint
CREATE INDEX "products_merchant_status_idx" ON "products" USING btree ("merchant_id","status");--> statement-breakpoint
CREATE INDEX "products_merchant_category_idx" ON "products" USING btree ("merchant_id","category_id");