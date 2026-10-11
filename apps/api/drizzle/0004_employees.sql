CREATE TABLE "invitation_assignments" (
	"merchant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_id" uuid,
	CONSTRAINT "invitation_assignments_unique" UNIQUE NULLS NOT DISTINCT("invitation_id","role_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"job_title" text,
	"phone" text,
	"employee_code" text,
	"token_hash" "bytea" NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "invitations_email_lowercase" CHECK ("invitations"."email" = lower("invitations"."email")),
	CONSTRAINT "invitations_status_valid" CHECK ("invitations"."status" in ('pending', 'accepted', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "receipt_header" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "receipt_footer" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "employee_code" text;--> statement-breakpoint
ALTER TABLE "invitation_assignments" ADD CONSTRAINT "invitation_assignments_merchant_id_invitation_id_invitations_merchant_id_id_fk" FOREIGN KEY ("merchant_id","invitation_id") REFERENCES "public"."invitations"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_assignments" ADD CONSTRAINT "invitation_assignments_merchant_id_role_id_roles_merchant_id_id_fk" FOREIGN KEY ("merchant_id","role_id") REFERENCES "public"."roles"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_assignments" ADD CONSTRAINT "invitation_assignments_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_one_pending_per_email" ON "invitations" USING btree ("merchant_id","email") WHERE "invitations"."status" = 'pending';