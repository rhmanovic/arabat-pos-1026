CREATE TABLE "online_collection_products" (
	"merchant_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_collection_products_merchant_id_collection_id_product_id_pk" PRIMARY KEY("merchant_id","collection_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "online_collections" (
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
	CONSTRAINT "online_collections_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "online_collections_name_present" CHECK (coalesce("online_collections"."name_en", "online_collections"."name_ar") is not null),
	CONSTRAINT "online_collections_status_valid" CHECK ("online_collections"."status" in ('active', 'hidden')),
	CONSTRAINT "online_collections_image_pair" CHECK (("online_collections"."image_key" is null) = ("online_collections"."image_content_type" is null))
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "online_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "online_position" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "online_name_en" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "online_name_ar" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "online_image_key" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "online_image_content_type" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "pos_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "online_listings" ADD COLUMN "visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "online_collection_products" ADD CONSTRAINT "online_collection_products_merchant_id_collection_id_online_collections_merchant_id_id_fk" FOREIGN KEY ("merchant_id","collection_id") REFERENCES "public"."online_collections"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_collection_products" ADD CONSTRAINT "online_collection_products_merchant_id_product_id_products_merchant_id_id_fk" FOREIGN KEY ("merchant_id","product_id") REFERENCES "public"."products"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_collections" ADD CONSTRAINT "online_collections_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_collection_products_product_idx" ON "online_collection_products" USING btree ("merchant_id","product_id");--> statement-breakpoint
CREATE INDEX "online_collections_merchant_idx" ON "online_collections" USING btree ("merchant_id","position");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_online_image_pair" CHECK (("categories"."online_image_key" is null) = ("categories"."online_image_content_type" is null));--> statement-breakpoint
ALTER TABLE online_collections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_collections USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE online_collection_products ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_collection_products USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- ADR-0130: the store categories of ADR-0121 become collections with the same ids, so links,
-- page designs and promotions that named them keep working.
INSERT INTO online_collections (id, merchant_id, name_en, name_ar, position, status, image_key,
  image_content_type, version, created_at, updated_at)
SELECT id, merchant_id, name_en, name_ar, position, status, image_key, image_content_type, version,
  created_at, updated_at
FROM online_categories;
--> statement-breakpoint
INSERT INTO online_collection_products (merchant_id, collection_id, product_id, position)
SELECT merchant_id, online_category_id, product_id, position
FROM online_listings
WHERE online_category_id IS NOT NULL;
--> statement-breakpoint
-- Every product has a listing. Products that were not listed stay off the website.
INSERT INTO online_listings (merchant_id, product_id, position, visible)
SELECT p.merchant_id, p.id,
  coalesce((SELECT max(l.position) FROM online_listings l WHERE l.merchant_id = p.merchant_id), -1)
    + row_number() OVER (PARTITION BY p.merchant_id ORDER BY p.created_at, p.id),
  false
FROM products p
WHERE NOT EXISTS (
  SELECT 1 FROM online_listings l WHERE l.merchant_id = p.merchant_id AND l.product_id = p.id
);
--> statement-breakpoint
-- A product added anywhere (manager, store console, import, seed) is in the store at once,
-- shown on the website; the store console hides it when it should not be (owner, 2026-10-21).
CREATE FUNCTION products_online_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO online_listings (merchant_id, product_id, position, visible)
  VALUES (
    NEW.merchant_id,
    NEW.id,
    coalesce((SELECT max(position) FROM online_listings WHERE merchant_id = NEW.merchant_id), -1) + 1,
    true
  )
  ON CONFLICT (merchant_id, product_id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER products_online_listing AFTER INSERT ON products
  FOR EACH ROW EXECUTE FUNCTION products_online_listing();
