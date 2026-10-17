ALTER TABLE "memberships" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "pin_set_at" timestamp with time zone;