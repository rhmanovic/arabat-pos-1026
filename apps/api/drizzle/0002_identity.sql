CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"ip" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tickets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"purpose" text NOT NULL,
	"interface" text NOT NULL,
	"user_id" uuid,
	"operator_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tickets_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_tickets_purpose_valid" CHECK ("auth_tickets"."purpose" in ('merchant_selection', 'mfa'))
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"requested_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"realm" text NOT NULL,
	"interface" text NOT NULL,
	"user_id" uuid,
	"operator_id" uuid,
	"merchant_id" uuid,
	"membership_id" uuid,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"ip" text,
	"user_agent" text,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_realm_shape" CHECK (("sessions"."realm" = 'merchant' and "sessions"."interface" in ('manager', 'pos') and "sessions"."user_id" is not null
            and "sessions"."merchant_id" is not null and "sessions"."membership_id" is not null and "sessions"."operator_id" is null)
       or ("sessions"."realm" = 'platform' and "sessions"."interface" = 'platform' and "sessions"."operator_id" is not null
            and "sessions"."user_id" is null and "sessions"."merchant_id" is null)),
	CONSTRAINT "sessions_pos_branch" CHECK ("sessions"."interface" <> 'pos' or "sessions"."branch_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text,
	"name_ar" text,
	"is_main" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'Asia/Kuwait' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "branches_merchant_code_key" UNIQUE("merchant_id","code"),
	CONSTRAINT "branches_name_present" CHECK (coalesce("branches"."name_en", "branches"."name_ar") is not null),
	CONSTRAINT "branches_status_valid" CHECK ("branches"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "memberships_merchant_user_key" UNIQUE("merchant_id","user_id"),
	CONSTRAINT "memberships_status_valid" CHECK ("memberships"."status" in ('invited', 'active', 'inactive')),
	CONSTRAINT "memberships_owner_active" CHECK (not "memberships"."is_owner" or "memberships"."status" = 'active')
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_unique" UNIQUE NULLS NOT DISTINCT("membership_id","role_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"merchant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"name_en" text,
	"name_ar" text,
	"template_key" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "roles_name_present" CHECK (coalesce("roles"."name_en", "roles"."name_ar") is not null)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"preferred_language" text,
	"status" text DEFAULT 'active' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_status_valid" CHECK ("users"."status" in ('active', 'disabled')),
	CONSTRAINT "users_language_valid" CHECK ("users"."preferred_language" is null or "users"."preferred_language" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name_en" text,
	"display_name_ar" text,
	"legal_name" text,
	"commercial_registration_no" text,
	"contact_email" text,
	"contact_phone" text,
	"country_code" char(2) DEFAULT 'KW' NOT NULL,
	"default_currency" char(3) DEFAULT 'KWD' NOT NULL,
	"default_language" text DEFAULT 'ar' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kuwait' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_name_present" CHECK (coalesce("merchants"."display_name_en", "merchants"."display_name_ar") is not null),
	CONSTRAINT "merchants_status_valid" CHECK ("merchants"."status" in ('active', 'suspended', 'closed')),
	CONSTRAINT "merchants_language_valid" CHECK ("merchants"."default_language" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "platform_operators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"platform_role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"mfa_secret_enc" text NOT NULL,
	"mfa_last_step" bigint DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_operators_email_lowercase" CHECK ("platform_operators"."email" = lower("platform_operators"."email")),
	CONSTRAINT "platform_operators_status_valid" CHECK ("platform_operators"."status" in ('active', 'disabled')),
	CONSTRAINT "platform_operators_role_valid" CHECK ("platform_operators"."platform_role" in ('platform.super_admin', 'platform.support', 'platform.billing'))
);
--> statement-breakpoint
ALTER TABLE "auth_tickets" ADD CONSTRAINT "auth_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tickets" ADD CONSTRAINT "auth_tickets_operator_id_platform_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."platform_operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_operator_id_platform_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."platform_operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_merchant_id_membership_id_memberships_merchant_id_id_fk" FOREIGN KEY ("merchant_id","membership_id") REFERENCES "public"."memberships"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_merchant_id_role_id_roles_merchant_id_id_fk" FOREIGN KEY ("merchant_id","role_id") REFERENCES "public"."roles"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_merchant_id_role_id_roles_merchant_id_id_fk" FOREIGN KEY ("merchant_id","role_id") REFERENCES "public"."roles"("merchant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_default_currency_currencies_code_fk" FOREIGN KEY ("default_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_merchant_time_idx" ON "audit_log" USING btree ("merchant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_operator_idx" ON "sessions" USING btree ("operator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_one_main_per_merchant" ON "branches" USING btree ("merchant_id") WHERE "branches"."is_main";--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_owner_per_merchant" ON "memberships" USING btree ("merchant_id") WHERE "memberships"."is_owner";--> statement-breakpoint
CREATE UNIQUE INDEX "roles_merchant_template_key" ON "roles" USING btree ("merchant_id","template_key") WHERE "roles"."template_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_operators_email_key" ON "platform_operators" USING btree ("email");