CREATE TABLE "print_agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "print_agents_merchant_id_id_key" UNIQUE("merchant_id","id"),
	CONSTRAINT "print_agents_name_present" CHECK (length(trim("print_agents"."name")) between 1 and 80)
);
--> statement-breakpoint
CREATE TABLE "print_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"branch_id" uuid,
	"agent_id" uuid,
	"sale_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"html" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"printed_at" timestamp with time zone,
	CONSTRAINT "print_jobs_kind_valid" CHECK ("print_jobs"."kind" in ('auto', 'reprint')),
	CONSTRAINT "print_jobs_status_valid" CHECK ("print_jobs"."status" in ('pending', 'printing', 'printed', 'failed')),
	CONSTRAINT "print_jobs_attempts_valid" CHECK ("print_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales_settings" ADD COLUMN "auto_print_receipts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "print_agents" ADD CONSTRAINT "print_agents_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_agents" ADD CONSTRAINT "print_agents_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_agents" ADD CONSTRAINT "print_agents_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_agent_id_print_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."print_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_merchant_id_branch_id_branches_merchant_id_id_fk" FOREIGN KEY ("merchant_id","branch_id") REFERENCES "public"."branches"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_merchant_id_sale_id_sales_merchant_id_id_fk" FOREIGN KEY ("merchant_id","sale_id") REFERENCES "public"."sales"("merchant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "print_agents_token_hash_key" ON "print_agents" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "print_jobs_queue_idx" ON "print_jobs" USING btree ("merchant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "print_jobs_sale_idx" ON "print_jobs" USING btree ("merchant_id","sale_id");--> statement-breakpoint
-- Print agents and jobs (ADR-0111). RLS enabled, not forced (ADR-0105).
ALTER TABLE print_agents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON print_agents USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- Agents are configuration: a manager may delete one. Only the name, the branch and the
-- last-seen time change.
REVOKE UPDATE ON print_agents FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (last_seen_at) ON print_agents TO app_runtime;
--> statement-breakpoint
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON print_jobs USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- A job's content never changes; only its progress does. Jobs are never deleted.
REVOKE UPDATE, DELETE ON print_jobs FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, agent_id, attempts, error, claimed_at, printed_at) ON print_jobs TO app_runtime;
--> statement-breakpoint
-- The agent's bearer token is checked before any merchant context exists: this returns the
-- agent with that token hash (if any) and stamps its last-seen time. SECURITY DEFINER runs as
-- the table owner, which RLS does not filter.
CREATE FUNCTION print_agent_authenticate(p_token_hash bytea)
RETURNS TABLE (id uuid, merchant_id uuid, branch_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE print_agents a SET last_seen_at = now()
  WHERE a.token_hash = p_token_hash
  RETURNING a.id, a.merchant_id, a.branch_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION print_agent_authenticate(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION print_agent_authenticate(bytea) TO app_runtime;
