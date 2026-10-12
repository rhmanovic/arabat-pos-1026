CREATE TABLE "inventory_settings" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustment_lines" (
	"merchant_id" uuid NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"previous_on_hand" numeric(14, 3) NOT NULL,
	"delta" numeric(14, 3) NOT NULL,
	"unit_cost_minor" bigint,
	CONSTRAINT "stock_adjustment_lines_adjustment_id_variant_id_pk" PRIMARY KEY("adjustment_id","variant_id")
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"idempotency_key" uuid,
	"request_hash" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_adjustments_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "stock_adjustments_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "stock_adjustments_kind_valid" CHECK ("stock_adjustments"."kind" in ('opening', 'increase', 'decrease', 'count'))
);
--> statement-breakpoint
CREATE TABLE "stock_levels" (
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"on_hand" numeric(14, 3) DEFAULT '0' NOT NULL,
	"avg_cost_minor" bigint,
	"low_stock_threshold" numeric(14, 3),
	"last_movement_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_levels_merchant_id_branch_id_variant_id_pk" PRIMARY KEY("merchant_id","branch_id","variant_id"),
	CONSTRAINT "stock_levels_threshold_valid" CHECK ("stock_levels"."low_stock_threshold" is null or "stock_levels"."low_stock_threshold" >= 0),
	CONSTRAINT "stock_levels_avg_cost_valid" CHECK ("stock_levels"."avg_cost_minor" is null or "stock_levels"."avg_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"reason" text,
	"quantity" numeric(14, 3) NOT NULL,
	"balance_after" numeric(14, 3) NOT NULL,
	"unit_cost_minor" bigint,
	"value_minor" bigint,
	"avg_cost_after_minor" bigint,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"note" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("stock_movements"."quantity" <> 0),
	CONSTRAINT "stock_movements_type_valid" CHECK ("stock_movements"."movement_type" in ('opening', 'adjustment', 'count', 'sale', 'sale_void', 'refund', 'transfer_out', 'transfer_in', 'purchase_receipt'))
);
--> statement-breakpoint
ALTER TABLE "inventory_settings" ADD CONSTRAINT "inventory_settings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_merchant_id_adjustment_id_stock_adjustments_merchant_id_id_fk" FOREIGN KEY ("merchant_id","adjustment_id") REFERENCES "public"."stock_adjustments"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_merchant_id_variant_id_product_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variants"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_merchant_id_variant_id_product_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variants"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_merchant_id_variant_id_product_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variants"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_adjustments_branch_idx" ON "stock_adjustments" USING btree ("merchant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_levels_variant_idx" ON "stock_levels" USING btree ("merchant_id","variant_id");--> statement-breakpoint
CREATE INDEX "stock_movements_level_idx" ON "stock_movements" USING btree ("merchant_id","branch_id","variant_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_branch_time_idx" ON "stock_movements" USING btree ("merchant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_source_idx" ON "stock_movements" USING btree ("merchant_id","source_type","source_id");