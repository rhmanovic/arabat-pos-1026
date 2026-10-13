CREATE TABLE "period_closes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"period" char(7) NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"timezone" text NOT NULL,
	"closed_by_user_id" uuid NOT NULL,
	"note" text,
	"pack" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_closes_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "period_closes_period_key" UNIQUE("merchant_id","period")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "document_date" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "received_on" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill the business dates of existing documents from their posting time in the merchant's zone
-- (final orders are frozen by purchase_orders_final; the backfill is the one exception).
ALTER TABLE purchase_orders DISABLE TRIGGER purchase_orders_final;
--> statement-breakpoint
UPDATE purchase_orders o SET document_date = (o.created_at AT TIME ZONE m.timezone)::date
  FROM merchants m WHERE m.id = o.merchant_id;
--> statement-breakpoint
ALTER TABLE purchase_orders ENABLE TRIGGER purchase_orders_final;
--> statement-breakpoint
UPDATE purchase_receipts r SET received_on = (r.created_at AT TIME ZONE m.timezone)::date
  FROM merchants m WHERE m.id = r.merchant_id;
--> statement-breakpoint
ALTER TABLE period_closes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE period_closes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON period_closes USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- A closed month is closed once; there is no reopening (BR-189).
REVOKE UPDATE, DELETE ON period_closes FROM app_runtime;
