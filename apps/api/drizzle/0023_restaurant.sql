CREATE TABLE "dining_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_areas_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "dining_areas_name_present" CHECK (coalesce("dining_areas"."name_en", "dining_areas"."name_ar") is not null),
	CONSTRAINT "dining_areas_status_valid" CHECK ("dining_areas"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "dining_tables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"code" text NOT NULL,
	"seats" integer DEFAULT 4 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dining_tables_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "dining_tables_code_key" UNIQUE("merchant_id","branch_id","code"),
	CONSTRAINT "dining_tables_seats_valid" CHECK ("dining_tables"."seats" between 1 and 100),
	CONSTRAINT "dining_tables_status_valid" CHECK ("dining_tables"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "kitchen_station_categories" (
	"merchant_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "kitchen_station_categories_station_id_category_id_pk" PRIMARY KEY("station_id","category_id"),
	CONSTRAINT "kitchen_station_categories_branch_key" UNIQUE("merchant_id","branch_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "kitchen_stations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kitchen_stations_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "kitchen_stations_name_present" CHECK (coalesce("kitchen_stations"."name_en", "kitchen_stations"."name_ar") is not null),
	CONSTRAINT "kitchen_stations_status_valid" CHECK ("kitchen_stations"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "kitchen_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "kitchen_tickets_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "kitchen_tickets_status_valid" CHECK ("kitchen_tickets"."status" in ('new', 'preparing', 'ready', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modifier_groups_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "modifier_groups_name_present" CHECK (coalesce("modifier_groups"."name_en", "modifier_groups"."name_ar") is not null),
	CONSTRAINT "modifier_groups_select_valid" CHECK ("modifier_groups"."min_select" >= 0 and "modifier_groups"."max_select" >= 1 and "modifier_groups"."min_select" <= "modifier_groups"."max_select" and "modifier_groups"."max_select" <= 50),
	CONSTRAINT "modifier_groups_status_valid" CHECK ("modifier_groups"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "modifiers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"component_variant_id" uuid,
	"component_quantity" numeric(14, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "modifiers_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "modifiers_name_present" CHECK (coalesce("modifiers"."name_en", "modifiers"."name_ar") is not null),
	CONSTRAINT "modifiers_price_valid" CHECK ("modifiers"."price_minor" >= 0),
	CONSTRAINT "modifiers_status_valid" CHECK ("modifiers"."status" in ('active', 'inactive')),
	CONSTRAINT "modifiers_component_valid" CHECK (("modifiers"."component_variant_id" is null and "modifiers"."component_quantity" is null)
          or ("modifiers"."component_variant_id" is not null and "modifiers"."component_quantity" > 0))
);
--> statement-breakpoint
CREATE TABLE "product_modifier_groups" (
	"merchant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_modifier_groups_product_id_group_id_pk" PRIMARY KEY("product_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_components" (
	"merchant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"component_variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	CONSTRAINT "recipe_components_variant_id_component_variant_id_pk" PRIMARY KEY("variant_id","component_variant_id"),
	CONSTRAINT "recipe_components_quantity_positive" CHECK ("recipe_components"."quantity" > 0),
	CONSTRAINT "recipe_components_not_self" CHECK ("recipe_components"."variant_id" <> "recipe_components"."component_variant_id")
);
--> statement-breakpoint
CREATE TABLE "restaurant_order_item_modifiers" (
	"merchant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"modifier_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"price_minor" bigint NOT NULL,
	CONSTRAINT "restaurant_order_item_modifiers_item_id_modifier_id_pk" PRIMARY KEY("item_id","modifier_id")
);
--> statement-breakpoint
CREATE TABLE "restaurant_order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"note" text,
	"kitchen_status" text DEFAULT 'pending' NOT NULL,
	"station_id" uuid,
	"ticket_id" uuid,
	"sale_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"wasted" boolean,
	"cancelled_by_user_id" uuid,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "restaurant_order_items_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "restaurant_order_items_quantity_positive" CHECK ("restaurant_order_items"."quantity" > 0),
	CONSTRAINT "restaurant_order_items_status_valid" CHECK ("restaurant_order_items"."kitchen_status" in ('pending', 'queued', 'preparing', 'ready', 'served', 'cancelled')),
	CONSTRAINT "restaurant_order_items_paid_or_cancelled" CHECK (not ("restaurant_order_items"."sale_id" is not null and "restaurant_order_items"."kitchen_status" = 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "restaurant_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"number" text NOT NULL,
	"order_type" text NOT NULL,
	"table_id" uuid,
	"guests" integer,
	"label" text,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"merged_into_id" uuid,
	"opened_by_user_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "restaurant_orders_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "restaurant_orders_number_key" UNIQUE("merchant_id","number"),
	CONSTRAINT "restaurant_orders_type_valid" CHECK ("restaurant_orders"."order_type" in ('dine_in', 'takeaway', 'pickup')),
	CONSTRAINT "restaurant_orders_status_valid" CHECK ("restaurant_orders"."status" in ('open', 'closed', 'cancelled', 'merged')),
	CONSTRAINT "restaurant_orders_table_valid" CHECK ("restaurant_orders"."order_type" <> 'dine_in' or "restaurant_orders"."table_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "restaurant_settings" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_send_on_payment" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_line_modifiers" (
	"merchant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"modifier_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"price_minor" bigint NOT NULL,
	CONSTRAINT "sale_line_modifiers_sale_id_position_modifier_id_pk" PRIMARY KEY("sale_id","position","modifier_id")
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "restaurant_order_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "service_type" text;--> statement-breakpoint
ALTER TABLE "dining_areas" ADD CONSTRAINT "dining_areas_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_merchant_id_area_id_dining_areas_merchant_id_id_fk" FOREIGN KEY ("merchant_id","area_id") REFERENCES "public"."dining_areas"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_station_categories" ADD CONSTRAINT "kitchen_station_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_station_categories" ADD CONSTRAINT "kitchen_station_categories_merchant_id_station_id_kitchen_stations_merchant_id_id_fk" FOREIGN KEY ("merchant_id","station_id") REFERENCES "public"."kitchen_stations"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_stations" ADD CONSTRAINT "kitchen_stations_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_merchant_id_order_id_restaurant_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."restaurant_orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_merchant_id_station_id_kitchen_stations_merchant_id_id_fk" FOREIGN KEY ("merchant_id","station_id") REFERENCES "public"."kitchen_stations"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_component_variant_id_product_variants_id_fk" FOREIGN KEY ("component_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_merchant_id_group_id_modifier_groups_merchant_id_id_fk" FOREIGN KEY ("merchant_id","group_id") REFERENCES "public"."modifier_groups"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_merchant_id_group_id_modifier_groups_merchant_id_id_fk" FOREIGN KEY ("merchant_id","group_id") REFERENCES "public"."modifier_groups"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_component_variant_id_product_variants_id_fk" FOREIGN KEY ("component_variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_order_item_modifiers" ADD CONSTRAINT "restaurant_order_item_modifiers_merchant_id_item_id_restaurant_order_items_merchant_id_id_fk" FOREIGN KEY ("merchant_id","item_id") REFERENCES "public"."restaurant_order_items"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_order_items" ADD CONSTRAINT "restaurant_order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_order_items" ADD CONSTRAINT "restaurant_order_items_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_order_items" ADD CONSTRAINT "restaurant_order_items_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_order_items" ADD CONSTRAINT "restaurant_order_items_merchant_id_order_id_restaurant_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."restaurant_orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_merchant_id_table_id_dining_tables_merchant_id_id_fk" FOREIGN KEY ("merchant_id","table_id") REFERENCES "public"."dining_tables"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_settings" ADD CONSTRAINT "restaurant_settings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_modifiers" ADD CONSTRAINT "sale_line_modifiers_merchant_id_sale_id_sales_merchant_id_id_fk" FOREIGN KEY ("merchant_id","sale_id") REFERENCES "public"."sales"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kitchen_tickets_station_status_idx" ON "kitchen_tickets" USING btree ("merchant_id","station_id","status");--> statement-breakpoint
CREATE INDEX "restaurant_order_items_order_idx" ON "restaurant_order_items" USING btree ("merchant_id","order_id");--> statement-breakpoint
CREATE INDEX "restaurant_order_items_ticket_idx" ON "restaurant_order_items" USING btree ("merchant_id","ticket_id");--> statement-breakpoint
CREATE INDEX "restaurant_orders_branch_status_idx" ON "restaurant_orders" USING btree ("merchant_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "sales_restaurant_order_idx" ON "sales" USING btree ("merchant_id","restaurant_order_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_service_type_valid" CHECK ("sales"."service_type" is null or "sales"."service_type" in ('dine_in', 'takeaway', 'pickup'));