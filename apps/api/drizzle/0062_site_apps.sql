CREATE TABLE "site_apps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"url" text NOT NULL,
	"icon" text DEFAULT 'other' NOT NULL,
	"open_in_new_tab" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_apps_status_valid" CHECK ("site_apps"."status" in ('active', 'hidden')),
	CONSTRAINT "site_apps_icon_valid" CHECK ("site_apps"."icon" in ('dashboard', 'till', 'store', 'links', 'computer', 'phone', 'other')),
	CONSTRAINT "site_apps_names_present" CHECK (length(trim("site_apps"."name_ar")) between 1 and 60 and length(trim("site_apps"."name_en")) between 1 and 60),
	CONSTRAINT "site_apps_url_valid" CHECK ("site_apps"."url" ~ '^(/[^[:space:]]*|https?://[^[:space:]]+)$')
);
--> statement-breakpoint
-- The public site's "Our apps" menu (ADR-0117). Global table (no merchant, no RLS): entries are
-- added, changed and deleted only in a platform operator's context. A menu entry is not a
-- financial record, so operators may delete it.
INSERT INTO site_apps (id, name_ar, name_en, description_ar, description_en, url, icon, open_in_new_tab, status, sort_order) VALUES
  (gen_random_uuid(), 'لوحة الإدارة', 'Management dashboard',
   'المنتجات والمخزون والموظفون والتقارير لكل فروعك.',
   'Products, stock, staff and reports for all your branches.',
   '/manager/', 'dashboard', false, 'active', 10),
  (gen_random_uuid(), 'الكاشير', 'Till',
   'نقطة البيع في المتصفح، على أي جهاز.',
   'Point of sale in the browser, on any device.',
   '/pos/', 'till', false, 'active', 20),
  (gen_random_uuid(), 'تطبيق الكاشير للكمبيوتر', 'Till app for the computer',
   'يبيع ويطبع بدون إنترنت ويزامن عند عودة الاتصال.',
   'Sells and prints offline and syncs when the connection returns.',
   '/pricing', 'computer', false, 'hidden', 30),
  (gen_random_uuid(), 'المتجر الإلكتروني', 'Online store',
   'متجر لمحلك يستقبل الطلبات على الإنترنت.',
   'A store for your shop that takes orders online.',
   '/store/', 'store', false, 'active', 40),
  (gen_random_uuid(), 'صفحة الروابط', 'Link page',
   'صفحة واحدة لكل روابط محلك.',
   'One page for all your shop''s links.',
   '/links/', 'links', false, 'active', 50);
--> statement-breakpoint
CREATE FUNCTION site_apps_operator_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_operator_id() IS NULL THEN
    RAISE EXCEPTION 'site apps are changed by platform operators only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER site_apps_operator_only BEFORE INSERT OR UPDATE OR DELETE ON site_apps
  FOR EACH ROW EXECUTE FUNCTION site_apps_operator_only();
