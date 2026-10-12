CREATE TABLE "document_sequences" (
	"merchant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_number" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "document_sequences_merchant_id_kind_pk" PRIMARY KEY("merchant_id","kind")
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"merchant_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	CONSTRAINT "purchase_order_lines_purchase_order_id_position_pk" PRIMARY KEY("purchase_order_id","position"),
	CONSTRAINT "purchase_order_lines_valid" CHECK ("purchase_order_lines"."quantity" > 0 and "purchase_order_lines"."unit_cost_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_date" date,
	"note" text,
	"created_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"closed_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "purchase_orders_number_key" UNIQUE("merchant_id","number"),
	CONSTRAINT "purchase_orders_status_valid" CHECK ("purchase_orders"."status" in ('draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "purchase_receipt_lines" (
	"merchant_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"order_position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	CONSTRAINT "purchase_receipt_lines_receipt_id_order_position_pk" PRIMARY KEY("receipt_id","order_position"),
	CONSTRAINT "purchase_receipt_lines_positive" CHECK ("purchase_receipt_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"note" text,
	"supplier_reference" text,
	"idempotency_key" uuid,
	"request_hash" text,
	"received_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "purchase_receipts_number_key" UNIQUE("merchant_id","number"),
	CONSTRAINT "purchase_receipts_idempotency_key" UNIQUE("merchant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"code" text,
	"name_en" text,
	"name_ar" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"tax_number" text,
	"payment_terms" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "suppliers_name_present" CHECK (coalesce("suppliers"."name_en", "suppliers"."name_ar") is not null),
	CONSTRAINT "suppliers_status_valid" CHECK ("suppliers"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"merchant_id" uuid NOT NULL,
	"transfer_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"requested_quantity" numeric(14, 3) NOT NULL,
	"dispatched_quantity" numeric(14, 3),
	"received_quantity" numeric(14, 3),
	"unit_cost_minor" bigint,
	CONSTRAINT "stock_transfer_lines_transfer_id_position_pk" PRIMARY KEY("transfer_id","position"),
	CONSTRAINT "stock_transfer_lines_quantities" CHECK ("stock_transfer_lines"."requested_quantity" > 0 and ("stock_transfer_lines"."dispatched_quantity" is null or "stock_transfer_lines"."dispatched_quantity" >= 0)
          and ("stock_transfer_lines"."received_quantity" is null or ("stock_transfer_lines"."dispatched_quantity" is not null and "stock_transfer_lines"."received_quantity" >= 0
               and "stock_transfer_lines"."received_quantity" <= "stock_transfer_lines"."dispatched_quantity")))
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"destination_branch_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"note" text,
	"requested_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"dispatched_by_user_id" uuid,
	"dispatched_at" timestamp with time zone,
	"received_by_user_id" uuid,
	"received_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"discrepancy_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "stock_transfers_number_key" UNIQUE("merchant_id","number"),
	CONSTRAINT "stock_transfers_branches_differ" CHECK ("stock_transfers"."source_branch_id" <> "stock_transfers"."destination_branch_id"),
	CONSTRAINT "stock_transfers_status_valid" CHECK ("stock_transfers"."status" in ('requested', 'approved', 'in_transit', 'received', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_merchant_id_purchase_order_id_purchase_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","purchase_order_id") REFERENCES "public"."purchase_orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_merchant_id_variant_id_product_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variants"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_merchant_id_supplier_id_suppliers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","supplier_id") REFERENCES "public"."suppliers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_merchant_id_receipt_id_purchase_receipts_merchant_id_id_fk" FOREIGN KEY ("merchant_id","receipt_id") REFERENCES "public"."purchase_receipts"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_merchant_id_purchase_order_id_purchase_orders_merchant_id_id_fk" FOREIGN KEY ("merchant_id","purchase_order_id") REFERENCES "public"."purchase_orders"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_merchant_id_transfer_id_stock_transfers_merchant_id_id_fk" FOREIGN KEY ("merchant_id","transfer_id") REFERENCES "public"."stock_transfers"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_merchant_id_variant_id_product_variants_merchant_id_id_fk" FOREIGN KEY ("merchant_id","variant_id") REFERENCES "public"."product_variants"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_dispatched_by_user_id_users_id_fk" FOREIGN KEY ("dispatched_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_user_id_users_id_fk" FOREIGN KEY ("received_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_merchant_id_source_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","source_branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_merchant_id_destination_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","destination_branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("merchant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_branch_status_idx" ON "purchase_orders" USING btree ("merchant_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "purchase_receipts_order_idx" ON "purchase_receipts" USING btree ("merchant_id","purchase_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers" USING btree ("merchant_id",lower("code")) WHERE "suppliers"."code" is not null;--> statement-breakpoint
CREATE INDEX "stock_transfers_source_idx" ON "stock_transfers" USING btree ("merchant_id","source_branch_id","status");--> statement-breakpoint
CREATE INDEX "stock_transfers_destination_idx" ON "stock_transfers" USING btree ("merchant_id","destination_branch_id","status");