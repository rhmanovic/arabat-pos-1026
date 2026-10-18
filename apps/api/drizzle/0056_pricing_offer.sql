CREATE TABLE "offer_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"price_minor" bigint NOT NULL,
	"icon" text DEFAULT 'other' NOT NULL,
	"image_key" text,
	"image_content_type" text,
	"max_quantity" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offer_items_kind_valid" CHECK ("offer_items"."kind" in ('system', 'device')),
	CONSTRAINT "offer_items_status_valid" CHECK ("offer_items"."status" in ('active', 'hidden')),
	CONSTRAINT "offer_items_system_active" CHECK ("offer_items"."kind" <> 'system' or "offer_items"."status" = 'active'),
	CONSTRAINT "offer_items_price_valid" CHECK ("offer_items"."price_minor" >= 0),
	CONSTRAINT "offer_items_quantity_valid" CHECK ("offer_items"."max_quantity" between 1 and 100),
	CONSTRAINT "offer_items_icon_valid" CHECK ("offer_items"."icon" in ('system', 'tablet', 'ipad', 'scanner', 'printer', 'drawer', 'other')),
	CONSTRAINT "offer_items_names_present" CHECK (length(trim("offer_items"."name_ar")) between 1 and 80 and length(trim("offer_items"."name_en")) between 1 and 80),
	CONSTRAINT "offer_items_image_pair" CHECK (("offer_items"."image_key" is null) = ("offer_items"."image_content_type" is null))
);
--> statement-breakpoint
CREATE TABLE "sales_request_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_minor" bigint NOT NULL,
	CONSTRAINT "sales_request_lines_kind_valid" CHECK ("sales_request_lines"."kind" in ('system', 'device')),
	CONSTRAINT "sales_request_lines_amounts_valid" CHECK ("sales_request_lines"."quantity" between 1 and 100 and "sales_request_lines"."unit_price_minor" >= 0 and "sales_request_lines"."line_total_minor" = "sales_request_lines"."unit_price_minor" * "sales_request_lines"."quantity")
);
--> statement-breakpoint
CREATE TABLE "sales_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "sales_requests_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"notes" text,
	"language" text NOT NULL,
	"system_minor" bigint NOT NULL,
	"devices_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"operator_note" text,
	"handled_by_operator_id" uuid,
	"ip" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_requests_status_valid" CHECK ("sales_requests"."status" in ('new', 'contacted', 'won', 'lost')),
	CONSTRAINT "sales_requests_language_valid" CHECK ("sales_requests"."language" in ('ar', 'en')),
	CONSTRAINT "sales_requests_totals_valid" CHECK ("sales_requests"."system_minor" >= 0 and "sales_requests"."devices_minor" >= 0 and "sales_requests"."total_minor" = "sales_requests"."system_minor" + "sales_requests"."devices_minor")
);
--> statement-breakpoint
ALTER TABLE "sales_request_lines" ADD CONSTRAINT "sales_request_lines_request_id_sales_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sales_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_request_lines" ADD CONSTRAINT "sales_request_lines_item_id_offer_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."offer_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_requests" ADD CONSTRAINT "sales_requests_handled_by_operator_id_platform_operators_id_fk" FOREIGN KEY ("handled_by_operator_id") REFERENCES "public"."platform_operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offer_items_one_system" ON "offer_items" USING btree ("kind") WHERE "offer_items"."kind" = 'system';--> statement-breakpoint
CREATE INDEX "sales_request_lines_request_idx" ON "sales_request_lines" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_requests_number_key" ON "sales_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "sales_requests_status_idx" ON "sales_requests" USING btree ("status","created_at");--> statement-breakpoint
-- Public pricing page and purchase requests (ADR-0114). Global tables (no merchant, no RLS):
-- items change only in a platform operator's context; a request is written once by the public
-- page and afterwards only its follow-up fields change, by an operator.
INSERT INTO offer_items (id, kind, name_ar, name_en, description_ar, description_en, price_minor, icon, max_quantity, status, sort_order) VALUES
  (gen_random_uuid(), 'system', 'نظام عربات POS', 'Arabat POS system',
   'الكاشير ولوحة الإدارة والمخزون والتقارير لكل فروعك وموظفيك.',
   'Till, management dashboard, stock and reports for all your branches and staff.',
   99000, 'system', 1, 'active', 0),
  (gen_random_uuid(), 'device', 'تابلت أندرويد', 'Android tablet', NULL, NULL, 0, 'tablet', 10, 'hidden', 10),
  (gen_random_uuid(), 'device', 'آيباد', 'iPad', NULL, NULL, 0, 'ipad', 10, 'hidden', 20),
  (gen_random_uuid(), 'device', 'قارئ باركود', 'Barcode scanner', NULL, NULL, 0, 'scanner', 10, 'hidden', 30),
  (gen_random_uuid(), 'device', 'طابعة فواتير', 'Receipt printer', NULL, NULL, 0, 'printer', 10, 'hidden', 40),
  (gen_random_uuid(), 'device', 'درج كاش', 'Cash drawer', NULL, NULL, 0, 'drawer', 10, 'hidden', 50);
--> statement-breakpoint
CREATE FUNCTION offer_items_operator_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_operator_id() IS NULL THEN
    RAISE EXCEPTION 'offer items are changed by platform operators only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER offer_items_operator_only BEFORE INSERT OR UPDATE ON offer_items
  FOR EACH ROW EXECUTE FUNCTION offer_items_operator_only();
--> statement-breakpoint
CREATE FUNCTION sales_requests_operator_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_operator_id() IS NULL THEN
    RAISE EXCEPTION 'sales requests are followed up by platform operators only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER sales_requests_operator_only BEFORE UPDATE ON sales_requests
  FOR EACH ROW EXECUTE FUNCTION sales_requests_operator_only();
--> statement-breakpoint
REVOKE DELETE ON offer_items FROM app_runtime;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON sales_requests, sales_request_lines FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, operator_note, handled_by_operator_id, version, updated_at) ON sales_requests TO app_runtime;
