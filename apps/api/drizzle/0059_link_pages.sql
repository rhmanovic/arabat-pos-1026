CREATE TABLE "link_page_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label_ar" text,
	"label_en" text,
	"url" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_page_items_kind_valid" CHECK ("link_page_items"."kind" in ('link', 'website', 'store', 'instagram', 'tiktok', 'snapchat', 'x', 'facebook', 'youtube', 'whatsapp', 'telegram', 'email', 'phone', 'location')),
	CONSTRAINT "link_page_items_status_valid" CHECK ("link_page_items"."status" in ('active', 'hidden')),
	CONSTRAINT "link_page_items_url_valid" CHECK (length("link_page_items"."url") <= 2000 and "link_page_items"."url" ~* '^(https?://|mailto:|tel:)'),
	CONSTRAINT "link_page_items_label_present" CHECK (coalesce(length(trim("link_page_items"."label_ar")), 0) + coalesce(length(trim("link_page_items"."label_en")), 0) > 0),
	CONSTRAINT "link_page_items_clicks_valid" CHECK ("link_page_items"."clicks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "link_pages" (
	"merchant_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title_ar" text,
	"title_en" text,
	"bio_ar" text,
	"bio_en" text,
	"theme_color" text DEFAULT '#1e3a8a' NOT NULL,
	"button_style" text DEFAULT 'rounded' NOT NULL,
	"background" text DEFAULT 'light' NOT NULL,
	"avatar_key" text,
	"avatar_content_type" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_pages_status_valid" CHECK ("link_pages"."status" in ('draft', 'published')),
	CONSTRAINT "link_pages_slug_valid" CHECK ("link_pages"."slug" ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
	CONSTRAINT "link_pages_color_valid" CHECK ("link_pages"."theme_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "link_pages_button_valid" CHECK ("link_pages"."button_style" in ('rounded', 'pill', 'square')),
	CONSTRAINT "link_pages_background_valid" CHECK ("link_pages"."background" in ('light', 'dark', 'brand')),
	CONSTRAINT "link_pages_avatar_pair" CHECK (("link_pages"."avatar_key" is null) = ("link_pages"."avatar_content_type" is null))
);
--> statement-breakpoint
ALTER TABLE "link_page_items" ADD CONSTRAINT "link_page_items_merchant_id_link_pages_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."link_pages"("merchant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_pages" ADD CONSTRAINT "link_pages_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_page_items_merchant_idx" ON "link_page_items" USING btree ("merchant_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "link_pages_slug_key" ON "link_pages" USING btree (lower("slug"));--> statement-breakpoint
-- Link pages (ADR-0116). RLS enabled, not forced (ADR-0105).
ALTER TABLE link_pages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON link_pages USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
ALTER TABLE link_page_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON link_page_items USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- A page is unpublished, never deleted (its address stays reserved for the merchant).
REVOKE DELETE ON link_pages FROM app_runtime;
--> statement-breakpoint
-- The public page knows only the slug. Returns the merchant of a published page of an active
-- merchant so the request continues inside that merchant's RLS context.
CREATE FUNCTION link_page_merchant(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.merchant_id FROM link_pages p JOIN merchants m ON m.id = p.merchant_id
  WHERE lower(p.slug) = lower(p_slug) AND p.status = 'published' AND m.status = 'active'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION link_page_merchant(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION link_page_merchant(text) TO app_runtime;
--> statement-breakpoint
-- A link-page address is free for a merchant when no other merchant uses it for a link page or
-- an online store (any status), so one shop cannot take another shop's name (BR-198).
CREATE FUNCTION link_slug_available(p_slug text, p_merchant uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM link_pages WHERE lower(slug) = lower(p_slug) AND merchant_id <> p_merchant)
     AND NOT EXISTS (SELECT 1 FROM online_stores WHERE lower(slug) = lower(p_slug) AND merchant_id <> p_merchant)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION link_slug_available(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION link_slug_available(text, uuid) TO app_runtime;
