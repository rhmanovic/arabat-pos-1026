-- Numbered 0049 after the Google Cloud migration 0048 (both branches had taken 0048). Staging
-- already created these objects as 0048 / 0049, so every statement here is idempotent.
CREATE TABLE IF NOT EXISTS "assistant_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merchant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"branch_id" uuid,
	"surface" text NOT NULL,
	"conversation_id" uuid,
	"language" text NOT NULL,
	"model" text NOT NULL,
	"question" text NOT NULL,
	"thread" text NOT NULL,
	"reply" text,
	"tools_used" text[] DEFAULT '{}'::text[] NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"stop_reason" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_requests_surface_valid" CHECK ("assistant_requests"."surface" in ('pos', 'manager')),
	CONSTRAINT "assistant_requests_outcome_valid" CHECK ("assistant_requests"."outcome" in ('answered', 'fallback', 'refused', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_requests_merchant_time_idx" ON "assistant_requests" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_requests_time_idx" ON "assistant_requests" USING btree ("created_at");--> statement-breakpoint
-- Platform-owned usage record (ADR-0107 amendment): merchant code inserts its own rows and
-- never reads them (no SELECT policy for the runtime role); the platform reads through the
-- SECURITY DEFINER functions below. Append-only. RLS is enabled, not forced (ADR-0105:
-- Cloud SQL has no BYPASSRLS, so a forced table would lock out its owner app_owner).
ALTER TABLE assistant_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS merchant_insert ON assistant_requests;
--> statement-breakpoint
CREATE POLICY merchant_insert ON assistant_requests FOR INSERT
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON assistant_requests FROM app_runtime;
--> statement-breakpoint
-- Every question with its company, user and branch names; super admin only (checked again by
-- the API). Filters: merchant, surface, inclusive UTC days, text in question / reply / user.
CREATE OR REPLACE FUNCTION platform_assistant_requests(
  p_merchant uuid, p_surface text, p_from date, p_to date, p_q text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, merchant_id uuid, merchant_name_en text, merchant_name_ar text,
  user_name text, user_email text, branch_name_en text, branch_name_ar text,
  surface text, conversation_id uuid, language text, model text, question text, thread text,
  reply text, tools_used text[], rounds int, input_tokens bigint, output_tokens bigint,
  cache_write_tokens bigint, cache_read_tokens bigint, cost_micro_usd bigint, duration_ms int,
  outcome text, stop_reason text, error text, created_at timestamptz, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.merchant_id, m.display_name_en, m.display_name_ar,
         u.full_name, u.email, b.name_en, b.name_ar,
         r.surface, r.conversation_id, r.language, r.model, r.question, r.thread,
         r.reply, r.tools_used, r.rounds, r.input_tokens, r.output_tokens,
         r.cache_write_tokens, r.cache_read_tokens, r.cost_micro_usd, r.duration_ms,
         r.outcome, r.stop_reason, r.error, r.created_at, count(*) OVER ()
  FROM assistant_requests r
  JOIN merchants m ON m.id = r.merchant_id
  JOIN users u ON u.id = r.user_id
  LEFT JOIN branches b ON b.id = r.branch_id
  WHERE app_current_operator_id() IS NOT NULL
    AND (p_merchant IS NULL OR r.merchant_id = p_merchant)
    AND (p_surface IS NULL OR r.surface = p_surface)
    AND (p_from IS NULL OR r.created_at >= p_from::timestamptz)
    AND (p_to IS NULL OR r.created_at < (p_to + 1)::timestamptz)
    AND (p_q IS NULL OR position(lower(p_q) IN lower(
          concat_ws(' ', r.question, r.reply, u.full_name, u.email))) > 0)
  ORDER BY r.created_at DESC, r.id DESC
  LIMIT p_limit OFFSET p_offset
$$;
--> statement-breakpoint
-- Totals per company over the same filter (the grand total is their sum).
CREATE OR REPLACE FUNCTION platform_assistant_usage(
  p_merchant uuid, p_surface text, p_from date, p_to date, p_q text)
RETURNS TABLE (
  merchant_id uuid, merchant_name_en text, merchant_name_ar text, requests bigint, users bigint,
  input_tokens bigint, output_tokens bigint, cache_write_tokens bigint, cache_read_tokens bigint,
  cost_micro_usd bigint, last_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.merchant_id, m.display_name_en, m.display_name_ar, count(*), count(DISTINCT r.user_id),
         coalesce(sum(r.input_tokens), 0), coalesce(sum(r.output_tokens), 0),
         coalesce(sum(r.cache_write_tokens), 0), coalesce(sum(r.cache_read_tokens), 0),
         coalesce(sum(r.cost_micro_usd), 0), max(r.created_at)
  FROM assistant_requests r
  JOIN merchants m ON m.id = r.merchant_id
  JOIN users u ON u.id = r.user_id
  WHERE app_current_operator_id() IS NOT NULL
    AND (p_merchant IS NULL OR r.merchant_id = p_merchant)
    AND (p_surface IS NULL OR r.surface = p_surface)
    AND (p_from IS NULL OR r.created_at >= p_from::timestamptz)
    AND (p_to IS NULL OR r.created_at < (p_to + 1)::timestamptz)
    AND (p_q IS NULL OR position(lower(p_q) IN lower(
          concat_ws(' ', r.question, r.reply, u.full_name, u.email))) > 0)
  GROUP BY r.merchant_id, m.display_name_en, m.display_name_ar
  ORDER BY sum(coalesce(r.cost_micro_usd, 0)) DESC, count(*) DESC
$$;
