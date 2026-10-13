ALTER TABLE "merchants" ADD COLUMN "timezone_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "unusual_refund_rate_percent" numeric(5, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "unusual_activity_days" integer DEFAULT 30 NOT NULL;