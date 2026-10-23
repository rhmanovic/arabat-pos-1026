-- Permanent store codes (ADR-0137): 'st-' and six letters / digits without look-alikes.
CREATE FUNCTION new_store_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT 'st-' || string_agg(substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, 6)
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION new_store_code() TO app_runtime;
--> statement-breakpoint
CREATE TABLE "store_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"www_hostname_id" text,
	"root_hostname_id" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_domains_status_valid" CHECK ("store_domains"."status" in ('pending', 'verifying', 'active', 'failed', 'removed')),
	CONSTRAINT "store_domains_domain_valid" CHECK ("store_domains"."domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' and "store_domains"."domain" not like 'www.%'),
	CONSTRAINT "store_domains_removed_valid" CHECK (("store_domains"."status" = 'removed') = ("store_domains"."removed_at" is not null)),
	CONSTRAINT "store_domains_primary_valid" CHECK (not "store_domains"."is_primary" or "store_domains"."status" = 'active')
);
--> statement-breakpoint
ALTER TABLE "online_stores" ADD COLUMN "public_code" text DEFAULT new_store_code() NOT NULL;--> statement-breakpoint
ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_domains_domain_key" ON "store_domains" USING btree ("domain") WHERE "store_domains"."status" <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "store_domains_merchant_key" ON "store_domains" USING btree ("merchant_id") WHERE "store_domains"."status" <> 'removed';--> statement-breakpoint
CREATE INDEX "store_domains_status_idx" ON "store_domains" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "online_stores_public_code_key" ON "online_stores" USING btree ("public_code");--> statement-breakpoint
ALTER TABLE "online_stores" ADD CONSTRAINT "online_stores_public_code_valid" CHECK ("online_stores"."public_code" ~ '^st-[a-z0-9]{6}$');--> statement-breakpoint
-- The code is given once and never changes.
CREATE FUNCTION online_stores_code_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_code IS DISTINCT FROM OLD.public_code THEN
    RAISE EXCEPTION 'A store''s public code never changes.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER online_stores_code_fixed BEFORE UPDATE OF public_code ON online_stores
  FOR EACH ROW EXECUTE FUNCTION online_stores_code_fixed();
--> statement-breakpoint
ALTER TABLE store_domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON store_domains USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- A removed domain is kept as a record.
REVOKE DELETE ON store_domains FROM app_runtime;
--> statement-breakpoint
-- The store a host stands for (public pages): an active connected domain, `www.` or not.
CREATE FUNCTION store_domain_store(p_domain text)
  RETURNS TABLE (merchant_id uuid, slug text, is_primary boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.merchant_id, s.slug, d.is_primary
  FROM store_domains d
  JOIN online_stores s ON s.merchant_id = d.merchant_id
  JOIN merchants m ON m.id = s.merchant_id
  WHERE d.domain = lower(p_domain) AND d.status = 'active'
    AND s.status IN ('published', 'paused') AND m.status = 'active'
$$;
--> statement-breakpoint
-- A store's public addresses by any of its slugs (current or recent) or its permanent code.
CREATE FUNCTION store_public_address(p_key text)
  RETURNS TABLE (merchant_id uuid, slug text, public_code text, domain text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.merchant_id, s.slug, s.public_code,
    (SELECT d.domain FROM store_domains d
     WHERE d.merchant_id = s.merchant_id AND d.status = 'active' AND d.is_primary)
  FROM online_stores s JOIN merchants m ON m.id = s.merchant_id
  WHERE m.status = 'active' AND s.status IN ('published', 'paused')
    AND (s.merchant_id = (SELECT store_merchant(p_key)) OR s.public_code = lower(p_key))
  LIMIT 1
$$;
--> statement-breakpoint
-- Stores whose domain is waiting for its records or certificate, or due for its daily check.
CREATE FUNCTION store_domains_due_merchants() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT merchant_id FROM store_domains
  WHERE (status IN ('pending', 'verifying') AND (last_checked_at IS NULL OR last_checked_at < now() - interval '4 minutes'))
     OR (status IN ('active', 'failed') AND (last_checked_at IS NULL OR last_checked_at < now() - interval '1 day'))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION store_domain_store(text), store_public_address(text), store_domains_due_merchants() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION store_domain_store(text), store_public_address(text), store_domains_due_merchants() TO app_runtime;
