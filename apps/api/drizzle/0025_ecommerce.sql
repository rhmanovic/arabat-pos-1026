CREATE TABLE "online_listings" (
	"merchant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_listings_merchant_id_product_id_pk" PRIMARY KEY("merchant_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "online_order_lines" (
	"merchant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"variant_name_en" text,
	"variant_name_ar" text,
	"sku" text,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"line_total_minor" bigint NOT NULL,
	CONSTRAINT "online_order_lines_order_id_position_pk" PRIMARY KEY("order_id","position"),
	CONSTRAINT "online_order_lines_positive" CHECK ("online_order_lines"."quantity" > 0 and "online_order_lines"."unit_price_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "online_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"fulfillment" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_email" text,
	"delivery_address" text,
	"note" text,
	"customer_id" uuid,
	"currency" char(3) DEFAULT 'KWD' NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"delivery_fee_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"tracking_token" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"reserved_until" timestamp with time zone NOT NULL,
	"sale_id" uuid,
	"paid_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"status_note" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "online_orders_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "online_orders_number_key" UNIQUE("merchant_id","number"),
	CONSTRAINT "online_orders_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "online_orders_status_valid" CHECK ("online_orders"."status" in ('pending_payment', 'paid', 'preparing', 'ready', 'out_for_delivery', 'completed',
                          'expired', 'payment_failed', 'cancelled', 'needs_attention')),
	CONSTRAINT "online_orders_fulfillment_valid" CHECK ("online_orders"."fulfillment" in ('pickup', 'delivery')),
	CONSTRAINT "online_orders_delivery_address" CHECK ("online_orders"."fulfillment" <> 'delivery' or "online_orders"."delivery_address" is not null),
	CONSTRAINT "online_orders_totals" CHECK ("online_orders"."total_minor" = "online_orders"."subtotal_minor" + "online_orders"."delivery_fee_minor" and "online_orders"."total_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "online_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"online_order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'KWD' NOT NULL,
	"status" text DEFAULT 'initiated' NOT NULL,
	"redirect_url" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "online_payments_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "online_payments_status_valid" CHECK ("online_payments"."status" in ('initiated', 'succeeded', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "online_payments_amount_positive" CHECK ("online_payments"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "online_stores" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"name_en" text,
	"name_ar" text,
	"tagline_en" text,
	"tagline_ar" text,
	"announcement_en" text,
	"announcement_ar" text,
	"primary_color" text DEFAULT '#1e3a8a' NOT NULL,
	"contact_phone" text,
	"contact_email" text,
	"fulfillment_branch_id" uuid,
	"pickup_enabled" boolean DEFAULT true NOT NULL,
	"delivery_enabled" boolean DEFAULT false NOT NULL,
	"delivery_fee_minor" bigint DEFAULT 0 NOT NULL,
	"minimum_order_minor" bigint DEFAULT 0 NOT NULL,
	"reservation_minutes" integer DEFAULT 30 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "online_stores_status_valid" CHECK ("online_stores"."status" in ('draft', 'published', 'paused')),
	CONSTRAINT "online_stores_slug_valid" CHECK ("online_stores"."slug" ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
	CONSTRAINT "online_stores_color_valid" CHECK ("online_stores"."primary_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "online_stores_money_valid" CHECK ("online_stores"."delivery_fee_minor" >= 0 and "online_stores"."minimum_order_minor" >= 0),
	CONSTRAINT "online_stores_reservation_valid" CHECK ("online_stores"."reservation_minutes" between 5 and 1440)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"online_payment_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount_minor" bigint,
	"payload" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"online_order_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "stock_reservations_quantity_positive" CHECK ("stock_reservations"."quantity" > 0),
	CONSTRAINT "stock_reservations_status_valid" CHECK ("stock_reservations"."status" in ('active', 'consumed', 'released'))
);
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "created_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "register_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "shift_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "membership_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "channel" text DEFAULT 'pos' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "online_order_id" uuid;--> statement-breakpoint
ALTER TABLE "online_listings" ADD CONSTRAINT "online_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_order_lines" ADD CONSTRAINT "online_order_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_order_lines" ADD CONSTRAINT "online_order_lines_merchant_id_order_id_online_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."online_orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_payments" ADD CONSTRAINT "online_payments_merchant_id_online_order_id_online_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","online_order_id") REFERENCES "public"."online_orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_merchant_id_fulfillment_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","fulfillment_branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_merchant_id_online_order_id_online_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","online_order_id") REFERENCES "public"."online_orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "online_orders_tracking_key" ON "online_orders" USING btree ("tracking_token");--> statement-breakpoint
CREATE INDEX "online_orders_status_idx" ON "online_orders" USING btree ("merchant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "online_payments_provider_ref_key" ON "online_payments" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "online_stores_slug_key" ON "online_stores" USING btree (lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_key" ON "payment_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_active_idx" ON "stock_reservations" USING btree ("merchant_id","branch_id","variant_id") WHERE "stock_reservations"."status" = 'active';--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_online_order_key" UNIQUE("merchant_id","online_order_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_channel_valid" CHECK (("sales"."channel" = 'pos' and "sales"."order_id" is not null and "sales"."register_id" is not null and "sales"."shift_id" is not null
           and "sales"."membership_id" is not null and "sales"."user_id" is not null and "sales"."online_order_id" is null)
          or ("sales"."channel" = 'online' and "sales"."online_order_id" is not null and "sales"."shift_id" is null));