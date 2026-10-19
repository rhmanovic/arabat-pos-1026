CREATE TABLE "pin_reset_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pin_reset_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "pin_reset_tokens" ADD CONSTRAINT "pin_reset_tokens_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pin_reset_tokens_membership_idx" ON "pin_reset_tokens" USING btree ("membership_id");--> statement-breakpoint
-- Global like password_reset_tokens: the link carries no company; only token hashes are stored.
-- The app runtime claims a link once (used_at) and never deletes rows.
REVOKE DELETE ON pin_reset_tokens FROM app_runtime;
