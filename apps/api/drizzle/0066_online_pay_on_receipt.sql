CREATE TABLE "online_store_slug_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "online_store_slug_history_slug_valid" CHECK ("online_store_slug_history"."slug" ~ '^[a-z0-9][a-z0-9-]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_status_valid";--> statement-breakpoint
ALTER TABLE "online_orders" ALTER COLUMN "payment_method_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ALTER COLUMN "reserved_until" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "payment_mode" text DEFAULT 'gateway' NOT NULL;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "payment_reference" text;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "collected_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "online_orders" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "pay_on_receipt_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "online_store_slug_history" ADD CONSTRAINT "online_store_slug_history_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "online_store_slug_history_slug_idx" ON "online_store_slug_history" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "online_store_slug_history_merchant_idx" ON "online_store_slug_history" USING btree ("merchant_id","replaced_at");--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_payment_mode_valid" CHECK ("online_orders"."payment_mode" in ('gateway', 'on_receipt'));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_gateway_fields" CHECK ("online_orders"."payment_mode" <> 'gateway' or ("online_orders"."payment_method_id" is not null and "online_orders"."reserved_until" is not null));--> statement-breakpoint
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_status_valid" CHECK ("online_orders"."status" in ('pending_payment', 'placed', 'confirmed', 'paid', 'preparing', 'ready', 'out_for_delivery',
                          'completed', 'expired', 'payment_failed', 'cancelled', 'needs_attention'));--> statement-breakpoint
-- Online store Phase 1 (ADR-0118): orders placed without paying online ("pay when you
-- receive", no stock reservation), and a history of store addresses.
-- RLS enabled, not forced (ADR-0105): the SECURITY DEFINER lookups below run as the owner.
ALTER TABLE online_store_slug_history ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON online_store_slug_history USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- Former addresses are a permanent record.
REVOKE UPDATE, DELETE ON online_store_slug_history FROM app_runtime;
--> statement-breakpoint
-- A store also answers on a former address until it expires; the current address wins.
CREATE OR REPLACE FUNCTION store_merchant(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.merchant_id FROM online_stores s JOIN merchants m ON m.id = s.merchant_id
  WHERE s.status IN ('published', 'paused') AND m.status = 'active'
    AND (lower(s.slug) = lower(p_slug)
         OR EXISTS (SELECT 1 FROM online_store_slug_history h
                    WHERE h.merchant_id = s.merchant_id AND lower(h.slug) = lower(p_slug) AND h.expires_at > now()))
  ORDER BY (lower(s.slug) = lower(p_slug)) DESC, s.merchant_id
  LIMIT 1
$$;
--> statement-breakpoint
-- One address namespace for stores and link pages, including addresses a store gave up
-- recently (they still answer for that store).
CREATE OR REPLACE FUNCTION link_slug_available(p_slug text, p_merchant uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM link_pages WHERE lower(slug) = lower(p_slug) AND merchant_id <> p_merchant)
     AND NOT EXISTS (SELECT 1 FROM online_stores WHERE lower(slug) = lower(p_slug) AND merchant_id <> p_merchant)
     AND NOT EXISTS (SELECT 1 FROM online_store_slug_history
                     WHERE lower(slug) = lower(p_slug) AND merchant_id <> p_merchant AND expires_at > now())
$$;
