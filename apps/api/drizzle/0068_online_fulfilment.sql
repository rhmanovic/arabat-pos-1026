CREATE TABLE "online_delivery_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"minimum_order_minor" bigint DEFAULT 0 NOT NULL,
	"free_delivery_from_minor" bigint,
	"estimated_minutes" integer,
	"branch_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_delivery_areas_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "online_delivery_areas_name_present" CHECK (coalesce("online_delivery_areas"."name_en", "online_delivery_areas"."name_ar") is not null),
	CONSTRAINT "online_delivery_areas_money_valid" CHECK ("online_delivery_areas"."fee_minor" >= 0 and "online_delivery_areas"."minimum_order_minor" >= 0 and ("online_delivery_areas"."free_delivery_from_minor" is null or "online_delivery_areas"."free_delivery_from_minor" >= 0)),
	CONSTRAINT "online_delivery_areas_minutes_valid" CHECK ("online_delivery_areas"."estimated_minutes" is null or ("online_delivery_areas"."estimated_minutes" between 1 and 1440))
);
--> statement-breakpoint
CREATE TABLE "online_store_branches" (
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"pickup_enabled" boolean DEFAULT true NOT NULL,
	"delivery_enabled" boolean DEFAULT false NOT NULL,
	"preparation_minutes" integer DEFAULT 30 NOT NULL,
	"hours" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_store_branches_merchant_id_branch_id_pk" PRIMARY KEY("merchant_id","branch_id"),
	CONSTRAINT "online_store_branches_preparation_valid" CHECK ("online_store_branches"."preparation_minutes" between 0 and 1440),
	CONSTRAINT "online_store_branches_fulfilment" CHECK ("online_store_branches"."pickup_enabled" or "online_store_branches"."delivery_enabled")
);
--> statement-breakpoint
ALTER TABLE "print_jobs" DROP CONSTRAINT "print_jobs_kind_valid";--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_channel_valid";--> statement-breakpoint
ALTER TABLE "online_listings" DROP CONSTRAINT "online_listings_merchant_id_online_category_id_online_categories_merchant_id_id_fk";
--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "delivery_area_id" uuid;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "delivery_area_name" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "pos_idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "hours" jsonb;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "scheduling_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "slot_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "slot_capacity" integer;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "notify_email" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD COLUMN "online_order_id" uuid;--> statement-breakpoint
ALTER TABLE "online_delivery_areas" ADD CONSTRAINT "online_delivery_areas_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_delivery_areas" ADD CONSTRAINT "online_delivery_areas_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_store_branches" ADD CONSTRAINT "online_store_branches_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_store_branches" ADD CONSTRAINT "online_store_branches_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_delivery_areas_merchant_idx" ON "online_delivery_areas" USING btree ("merchant_id","position");--> statement-breakpoint
ALTER TABLE "online_listings" ADD CONSTRAINT "online_listings_online_category_id_online_categories_id_fk" FOREIGN KEY ("online_category_id") REFERENCES "public"."online_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_delivery_area_id_online_delivery_areas_id_fk" FOREIGN KEY ("delivery_area_id") REFERENCES "public"."online_delivery_areas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_orders_schedule_idx" ON "online_orders" USING btree ("merchant_id","branch_id","scheduled_for") WHERE "online_orders"."scheduled_for" is not null;--> statement-breakpoint
CREATE INDEX "print_jobs_online_order_idx" ON "print_jobs" USING btree ("merchant_id","online_order_id");--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_slot_valid" CHECK ("online_stores"."slot_minutes" between 15 and 240);--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_capacity_valid" CHECK ("online_stores"."slot_capacity" is null or "online_stores"."slot_capacity" >= 1);--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_kind_valid" CHECK ("print_jobs"."kind" in ('auto', 'reprint', 'online_order'));--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_channel_valid" CHECK (("sales"."channel" = 'pos' and "sales"."order_id" is not null and "sales"."register_id" is not null and "sales"."shift_id" is not null
           and "sales"."membership_id" is not null and "sales"."user_id" is not null and "sales"."online_order_id" is null)
          or ("sales"."channel" = 'online' and "sales"."online_order_id" is not null and "sales"."order_id" is null
              and (("sales"."shift_id" is null and "sales"."register_id" is null)
                   or ("sales"."shift_id" is not null and "sales"."register_id" is not null and "sales"."user_id" is not null))));--> statement-breakpoint
ALTER TABLE online_delivery_areas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_delivery_areas USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE online_store_branches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_store_branches USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
