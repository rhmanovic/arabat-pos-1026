ALTER TABLE "sales_settings" ADD COLUMN "offline_limit_hours" integer DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_offline_limit_valid" CHECK ("offline_limit_hours" between 1 and 720);
