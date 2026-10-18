CREATE TABLE "device_trial_request_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "device_trial_request_lines_quantity_valid" CHECK ("device_trial_request_lines"."quantity" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "device_trial_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"lead_id" uuid,
	"status" text NOT NULL,
	"note" text,
	"delivered_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_trial_requests_status_valid" CHECK ("device_trial_requests"."status" in ('pending', 'waitlist', 'approved', 'delivered', 'returned', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "funnel_events" (
	"session_id" uuid NOT NULL,
	"step" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_events_session_id_step_pk" PRIMARY KEY("session_id","step"),
	CONSTRAINT "funnel_events_step_valid" CHECK ("funnel_events"."step" in ('business', 'demo', 'receipt', 'devices', 'account', 'verified'))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"company_name" text,
	"business_type" text,
	"language" text DEFAULT 'ar' NOT NULL,
	"stage" text NOT NULL,
	"merchant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_email_lowercase" CHECK ("leads"."email" = lower("leads"."email")),
	CONSTRAINT "leads_stage_valid" CHECK ("leads"."stage" in ('receipt', 'started', 'trial')),
	CONSTRAINT "leads_business_valid" CHECK ("leads"."business_type" is null or "leads"."business_type" in ('retail', 'restaurant', 'cafe', 'other')),
	CONSTRAINT "leads_language_valid" CHECK ("leads"."language" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "trial_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"trial_days_own" integer DEFAULT 14 NOT NULL,
	"trial_days_devices" integer DEFAULT 7 NOT NULL,
	"waitlist_enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_settings_single_row" CHECK ("trial_settings"."id" = 1),
	CONSTRAINT "trial_settings_days_valid" CHECK ("trial_settings"."trial_days_own" between 1 and 365 and "trial_settings"."trial_days_devices" between 1 and 365)
);
--> statement-breakpoint
CREATE TABLE "trial_signups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"company_name" text,
	"password_hash" text NOT NULL,
	"business_type" text NOT NULL,
	"language" text NOT NULL,
	"devices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"merchant_id" uuid,
	"session_id" uuid,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_signups_attempts_valid" CHECK ("trial_signups"."attempts" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "offer_items" ADD COLUMN "trial_stock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_trial_request_lines" ADD CONSTRAINT "device_trial_request_lines_request_id_device_trial_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."device_trial_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_trial_request_lines" ADD CONSTRAINT "device_trial_request_lines_item_id_offer_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."offer_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_trial_requests" ADD CONSTRAINT "device_trial_requests_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_trial_requests" ADD CONSTRAINT "device_trial_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_signups" ADD CONSTRAINT "trial_signups_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_trial_request_lines_request_idx" ON "device_trial_request_lines" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "device_trial_request_lines_item_idx" ON "device_trial_request_lines" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "device_trial_requests_status_idx" ON "device_trial_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "funnel_events_time_idx" ON "funnel_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_email_key" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("stage","updated_at");--> statement-breakpoint
CREATE INDEX "trial_signups_email_idx" ON "trial_signups" USING btree ("email");--> statement-breakpoint
ALTER TABLE "offer_items" ADD CONSTRAINT "offer_items_trial_stock_valid" CHECK ("offer_items"."trial_stock" >= 0);--> statement-breakpoint
-- Free trials and the sign-up funnel (ADR-0115). Global platform tables (no RLS): the settings
-- and device requests change only in an operator context; leads, sign-ups and funnel steps are
-- written by the public funnel API. Nothing here is deleted by the application.
INSERT INTO trial_settings (id) VALUES (1);
--> statement-breakpoint
CREATE FUNCTION trial_operator_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_operator_id() IS NULL THEN
    RAISE EXCEPTION 'trial settings and device trials are changed by platform operators only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER trial_settings_operator_only BEFORE UPDATE ON trial_settings
  FOR EACH ROW EXECUTE FUNCTION trial_operator_only();
--> statement-breakpoint
CREATE TRIGGER device_trial_requests_operator_only BEFORE UPDATE ON device_trial_requests
  FOR EACH ROW EXECUTE FUNCTION trial_operator_only();
--> statement-breakpoint
REVOKE INSERT, DELETE ON trial_settings FROM app_runtime;
--> statement-breakpoint
REVOKE DELETE ON leads, trial_signups, device_trial_requests, funnel_events FROM app_runtime;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON device_trial_request_lines FROM app_runtime;
--> statement-breakpoint
REVOKE UPDATE ON funnel_events FROM app_runtime;
--> statement-breakpoint
-- Trial activity for the platform leads list: last sign-in, sales, trial end per merchant.
CREATE FUNCTION platform_trial_activity(p_merchants uuid[])
RETURNS TABLE (merchant_id uuid, last_seen_at timestamptz, sales_count int, last_sale_at timestamptz,
               trial_ends_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM platform_assert_operator();
  RETURN QUERY SELECT m.id,
         (SELECT max(se.last_seen_at) FROM sessions se WHERE se.merchant_id = m.id),
         (SELECT count(*)::int FROM sales sa WHERE sa.merchant_id = m.id),
         (SELECT max(sa.created_at) FROM sales sa WHERE sa.merchant_id = m.id),
         s.trial_ends_at
  FROM merchants m LEFT JOIN subscriptions s ON s.merchant_id = m.id
  WHERE m.id = ANY(p_merchants);
END $fn$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_trial_activity(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_trial_activity(uuid[]) TO app_runtime;
