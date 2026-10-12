-- Hardening after the final audit (Prompt 18).

-- 1. A gateway success that arrives after an attempt was closed (order cancelled, or a
--    failure reported first) is recorded and flags the order instead of being ignored.
CREATE OR REPLACE FUNCTION online_orders_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 'expired' is not final: a payment confirmed late can still complete it (ADR-0079).
  -- payment_failed / cancelled may only move to needs_attention (money arrived late).
  IF OLD.status = 'completed'
     OR (OLD.status IN ('payment_failed', 'cancelled') AND NEW.status <> 'needs_attention') THEN
    RAISE EXCEPTION 'online order % is final', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION online_payments_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('initiated', 'expired') THEN RETURN NEW; END IF;
  -- A closed attempt may only record that the provider took the money after all.
  IF OLD.status IN ('failed', 'cancelled') AND NEW.status = 'succeeded' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'online payment % is settled', OLD.id USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
-- 2. Platform summaries answer only inside an operator context (defence in depth).
CREATE FUNCTION platform_assert_operator() RETURNS void LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF app_current_operator_id() IS NULL THEN
    RAISE EXCEPTION 'platform functions require an operator context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform_merchants(p_q text, p_status text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, display_name_en text, display_name_ar text, status text, contact_email text,
  created_at timestamptz, owner_email text, owner_name text, branch_count int, employee_count int,
  plan_code text, plan_name_en text, plan_name_ar text, subscription_status text,
  trial_ends_at timestamptz, ends_at timestamptz, last_sale_at timestamptz, total_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM platform_assert_operator();
  RETURN QUERY SELECT m.id, m.display_name_en, m.display_name_ar, m.status, m.contact_email, m.created_at,
         o.email, o.full_name,
         (SELECT count(*)::int FROM branches b WHERE b.merchant_id = m.id AND b.status = 'active'),
         (SELECT count(*)::int FROM memberships x WHERE x.merchant_id = m.id AND x.status = 'active' AND NOT x.is_owner),
         p.code, p.name_en, p.name_ar, s.status, s.trial_ends_at, s.ends_at,
         (SELECT max(sa.created_at) FROM sales sa WHERE sa.merchant_id = m.id),
         count(*) OVER ()
  FROM merchants m
  LEFT JOIN LATERAL (
    SELECT u.email, u.full_name FROM memberships ms JOIN users u ON u.id = ms.user_id
    WHERE ms.merchant_id = m.id AND ms.is_owner LIMIT 1
  ) o ON true
  LEFT JOIN subscriptions s ON s.merchant_id = m.id
  LEFT JOIN plans p ON p.id = s.plan_id
  WHERE (p_status IS NULL OR m.status = p_status)
    AND (p_q IS NULL OR position(lower(p_q) IN lower(
          concat_ws(' ', m.display_name_en, m.display_name_ar, m.legal_name, m.contact_email, o.email, m.id::text))) > 0)
  ORDER BY m.created_at DESC, m.id
  LIMIT p_limit OFFSET p_offset;
END $fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform_overview()
RETURNS TABLE (
  merchants_total bigint, merchants_active bigint, merchants_suspended bigint, merchants_closed bigint,
  merchants_new_30d bigint, trials_ending_7d bigint, subscriptions_lapsed bigint,
  branches_active bigint, employees_active bigint, sales_24h bigint, online_orders_24h bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM platform_assert_operator();
  RETURN QUERY SELECT
    (SELECT count(*) FROM merchants),
    (SELECT count(*) FROM merchants WHERE status = 'active'),
    (SELECT count(*) FROM merchants WHERE status = 'suspended'),
    (SELECT count(*) FROM merchants WHERE status = 'closed'),
    (SELECT count(*) FROM merchants WHERE created_at > now() - interval '30 days'),
    (SELECT count(*) FROM subscriptions WHERE status = 'trialing'
       AND trial_ends_at BETWEEN now() AND now() + interval '7 days'),
    (SELECT count(*) FROM subscriptions WHERE status IN ('past_due', 'expired', 'cancelled')
       OR (status = 'trialing' AND trial_ends_at < now()) OR (ends_at IS NOT NULL AND ends_at < now())),
    (SELECT count(*) FROM branches WHERE status = 'active'),
    (SELECT count(*) FROM memberships WHERE status = 'active'),
    (SELECT count(*) FROM sales WHERE created_at > now() - interval '24 hours'),
    (SELECT count(*) FROM online_orders WHERE created_at > now() - interval '24 hours');
END $fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform_audit(p_merchant uuid, p_action text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, merchant_id uuid, merchant_name_en text, merchant_name_ar text, actor_type text,
  actor_id uuid, actor_name text, action text, target_type text, target_id uuid, ip text,
  details jsonb, occurred_at timestamptz, total_count bigint
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM platform_assert_operator();
  RETURN QUERY SELECT a.id, a.merchant_id, m.display_name_en, m.display_name_ar, a.actor_type, a.actor_id,
         op.full_name, a.action, a.target_type, a.target_id, a.ip, a.details, a.occurred_at,
         count(*) OVER ()
  FROM audit_log a
  LEFT JOIN merchants m ON m.id = a.merchant_id
  LEFT JOIN platform_operators op ON a.actor_type = 'operator' AND op.id = a.actor_id
  WHERE (a.actor_type = 'operator' OR a.action LIKE 'platform.%')
    AND (p_merchant IS NULL OR a.merchant_id = p_merchant)
    AND (p_action IS NULL OR position(lower(p_action) IN lower(a.action)) > 0)
  ORDER BY a.occurred_at DESC, a.id DESC
  LIMIT p_limit OFFSET p_offset;
END $fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform_plan_counts() RETURNS TABLE (plan_id uuid, merchants bigint)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
#variable_conflict use_column
BEGIN
  PERFORM platform_assert_operator();
  RETURN QUERY SELECT s.plan_id, count(*) FROM subscriptions s GROUP BY s.plan_id;
END $fn$;
--> statement-breakpoint
-- 3. Operators are created only with the CLI (schema owner): the API role may only record
--    sign-in progress on existing operators.
REVOKE INSERT, DELETE, UPDATE ON platform_operators FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE (mfa_last_step, last_login_at) ON platform_operators TO app_runtime;
