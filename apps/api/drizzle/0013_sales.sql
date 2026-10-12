CREATE TABLE "order_lines" (
	"merchant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"price_override_minor" bigint,
	"discount_type" text,
	"discount_value" text,
	CONSTRAINT "order_lines_order_id_position_pk" PRIMARY KEY("order_id","position"),
	CONSTRAINT "order_lines_quantity_positive" CHECK ("order_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"label" text,
	"order_discount_type" text,
	"order_discount_value" text,
	"idempotency_key" uuid,
	"request_hash" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "orders_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "orders_status_valid" CHECK ("orders"."status" in ('suspended', 'completed', 'cancelled')),
	CONSTRAINT "orders_discount_valid" CHECK ("orders"."order_discount_type" is null or "orders"."order_discount_type" in ('percent', 'amount'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"sale_id" uuid,
	"branch_id" uuid NOT NULL,
	"shift_id" uuid,
	"payment_method_id" uuid NOT NULL,
	"method_kind" text NOT NULL,
	"method_name_en" text,
	"method_name_ar" text,
	"amount_minor" bigint NOT NULL,
	"tendered_minor" bigint,
	"change_minor" bigint DEFAULT 0 NOT NULL,
	"fee_minor" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"verification" text NOT NULL,
	"reference" text,
	"financial_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_valid" CHECK ("payments"."status" in ('succeeded', 'pending', 'failed')),
	CONSTRAINT "payments_verification_valid" CHECK ("payments"."verification" in ('manual', 'gateway')),
	CONSTRAINT "payments_amounts_valid" CHECK ("payments"."amount_minor" > 0 and "payments"."fee_minor" >= 0 and "payments"."fee_minor" <= "payments"."amount_minor" and "payments"."change_minor" >= 0
          and ("payments"."tendered_minor" is null or "payments"."tendered_minor" = "payments"."amount_minor" + "payments"."change_minor"))
);
--> statement-breakpoint
CREATE TABLE "receipt_sequences" (
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"last_number" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "receipt_sequences_merchant_id_branch_id_pk" PRIMARY KEY("merchant_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"merchant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"variant_name_en" text,
	"variant_name_ar" text,
	"sku" text,
	"quantity" numeric(14, 3) NOT NULL,
	"list_unit_price_minor" bigint NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"price_overridden" boolean DEFAULT false NOT NULL,
	"gross_minor" bigint NOT NULL,
	"discount_type" text,
	"discount_value" text,
	"line_discount_minor" bigint NOT NULL,
	"order_discount_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"track_inventory" boolean NOT NULL,
	"unit_cost_minor" bigint,
	CONSTRAINT "sale_lines_sale_id_position_pk" PRIMARY KEY("sale_id","position"),
	CONSTRAINT "sale_lines_amounts_consistent" CHECK ("sale_lines"."net_minor" = "sale_lines"."gross_minor" - "sale_lines"."line_discount_minor" - "sale_lines"."order_discount_minor" and "sale_lines"."net_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"currency" char(3) DEFAULT 'KWD' NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"line_discounts_minor" bigint NOT NULL,
	"order_discount_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"paid_minor" bigint NOT NULL,
	"change_minor" bigint NOT NULL,
	"fees_minor" bigint NOT NULL,
	"cost_minor" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "sales_order_key" UNIQUE("order_id"),
	CONSTRAINT "sales_receipt_number_key" UNIQUE("merchant_id","receipt_number"),
	CONSTRAINT "sales_totals_consistent" CHECK ("sales"."total_minor" = "sales"."subtotal_minor" - "sales"."line_discounts_minor" - "sales"."order_discount_minor"
          and "sales"."total_minor" >= 0 and "sales"."paid_minor" = "sales"."total_minor" and "sales"."change_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_settings" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"max_discount_percent" numeric(5, 2) DEFAULT '10' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_merchant_id_order_id_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_shift_id_shifts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","shift_id") REFERENCES "public"."shifts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_register_id_registers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","register_id") REFERENCES "public"."registers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_sale_id_sales_merchant_id_id_fk" FOREIGN KEY ("merchant_id","sale_id") REFERENCES "public"."sales"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_sequences" ADD CONSTRAINT "receipt_sequences_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_merchant_id_sale_id_sales_merchant_id_id_fk" FOREIGN KEY ("merchant_id","sale_id") REFERENCES "public"."sales"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_merchant_id_order_id_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","order_id") REFERENCES "public"."orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_merchant_id_shift_id_shifts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","shift_id") REFERENCES "public"."shifts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_branch_status_idx" ON "orders" USING btree ("merchant_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "payments_sale_idx" ON "payments" USING btree ("merchant_id","sale_id");--> statement-breakpoint
CREATE INDEX "payments_shift_idx" ON "payments" USING btree ("merchant_id","shift_id");--> statement-breakpoint
CREATE INDEX "sale_lines_variant_idx" ON "sale_lines" USING btree ("merchant_id","variant_id");--> statement-breakpoint
CREATE INDEX "sales_branch_time_idx" ON "sales" USING btree ("merchant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_shift_idx" ON "sales" USING btree ("merchant_id","shift_id");