CREATE TABLE "refund_lines" (
	"merchant_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"sale_position" integer NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"restock" boolean NOT NULL,
	"unit_cost_minor" bigint,
	CONSTRAINT "refund_lines_refund_id_sale_position_pk" PRIMARY KEY("refund_id","sale_position"),
	CONSTRAINT "refund_lines_positive" CHECK ("refund_lines"."quantity" > 0 and "refund_lines"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refund_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"refund_id" uuid NOT NULL,
	"original_payment_id" uuid,
	"payment_method_id" uuid,
	"method_kind" text NOT NULL,
	"method_name_en" text,
	"method_name_ar" text,
	"amount_minor" bigint NOT NULL,
	"shift_id" uuid,
	"status" text NOT NULL,
	"verification" text NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_payments_amount_positive" CHECK ("refund_payments"."amount_minor" > 0),
	CONSTRAINT "refund_payments_status_valid" CHECK ("refund_payments"."status" in ('succeeded', 'pending', 'failed')),
	CONSTRAINT "refund_payments_verification_valid" CHECK ("refund_payments"."verification" in ('manual', 'gateway', 'internal'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"register_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"refund_number" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"total_minor" bigint NOT NULL,
	"exchange_credit_minor" bigint DEFAULT 0 NOT NULL,
	"exchange_sale_id" uuid,
	"approval_reasons" text[],
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"completed_at" timestamp with time zone,
	"idempotency_key" uuid,
	"request_hash" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "refunds_number_key" UNIQUE("merchant_id","refund_number"),
	CONSTRAINT "refunds_idempotency_key" UNIQUE("merchant_id","idempotency_key"),
	CONSTRAINT "refunds_kind_valid" CHECK ("refunds"."kind" in ('refund', 'void', 'exchange')),
	CONSTRAINT "refunds_status_valid" CHECK ("refunds"."status" in ('pending_approval', 'processing', 'completed', 'rejected', 'cancelled')),
	CONSTRAINT "refunds_amounts_valid" CHECK ("refunds"."total_minor" > 0 and "refunds"."exchange_credit_minor" >= 0 and "refunds"."exchange_credit_minor" <= "refunds"."total_minor")
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_verification_valid";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "payment_method_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "refund_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "refund_window_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "refund_approval_limit_minor" bigint DEFAULT 20000 NOT NULL;--> statement-breakpoint
ALTER TABLE "refund_lines" ADD CONSTRAINT "refund_lines_merchant_id_refund_id_refunds_merchant_id_id_fk" FOREIGN KEY ("merchant_id","refund_id") REFERENCES "public"."refunds"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_payments" ADD CONSTRAINT "refund_payments_merchant_id_refund_id_refunds_merchant_id_id_fk" FOREIGN KEY ("merchant_id","refund_id") REFERENCES "public"."refunds"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_merchant_id_sale_id_sales_merchant_id_id_fk" FOREIGN KEY ("merchant_id","sale_id") REFERENCES "public"."sales"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refund_payments_refund_idx" ON "refund_payments" USING btree ("merchant_id","refund_id");--> statement-breakpoint
CREATE INDEX "refund_payments_original_idx" ON "refund_payments" USING btree ("merchant_id","original_payment_id");--> statement-breakpoint
CREATE INDEX "refund_payments_shift_idx" ON "refund_payments" USING btree ("merchant_id","shift_id");--> statement-breakpoint
CREATE INDEX "refunds_sale_idx" ON "refunds" USING btree ("merchant_id","sale_id");--> statement-breakpoint
CREATE INDEX "refunds_branch_time_idx" ON "refunds" USING btree ("merchant_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("merchant_id","status");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_exchange_valid" CHECK (("payments"."method_kind" = 'exchange') = ("payments"."refund_id" is not null) and ("payments"."method_kind" = 'exchange' or "payments"."payment_method_id" is not null));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verification_valid" CHECK ("payments"."verification" in ('manual', 'gateway', 'internal'));