CREATE TABLE "online_store_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_store_assets_bytes_valid" CHECK ("online_store_assets"."bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "online_store_designs" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"published_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "online_store_assets" ADD CONSTRAINT "online_store_assets_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_store_designs" ADD CONSTRAINT "online_store_designs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_store_assets_merchant_idx" ON "online_store_assets" USING btree ("merchant_id","created_at");--> statement-breakpoint
ALTER TABLE online_store_designs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_store_designs USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE online_store_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_store_assets USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- An uploaded picture is never rewritten; it is added or removed.
REVOKE UPDATE ON online_store_assets FROM app_runtime;
