-- Platform administration and subscriptions (Prompt 17): RLS, operator-only changes,
-- seeded plans, backfill, and the narrow cross-merchant read functions of the platform.

-- Operator of the transaction, set only by DatabaseService.withPlatformContext().
CREATE FUNCTION app_current_operator_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.operator_id', true), '')::uuid $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions', 'subscription_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY merchant_isolation ON %I USING (merchant_id = app_current_merchant_id())
                    WITH CHECK (merchant_id = app_current_merchant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE DELETE ON plans, subscriptions FROM app_runtime;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON subscription_events FROM app_runtime;
--> statement-breakpoint
-- A subscription is created with the merchant (default plan); afterwards only a platform
-- operator may change it. Merchant code paths never carry an operator context.
CREATE FUNCTION subscriptions_operator_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_operator_id() IS NULL THEN
    RAISE EXCEPTION 'subscriptions are changed by platform operators only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscriptions_operator_only BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_operator_only();
--> statement-breakpoint
CREATE FUNCTION subscription_events_operator_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'created' AND app_current_operator_id() IS NULL THEN
    RAISE EXCEPTION 'subscription changes are recorded by platform operators only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER subscription_events_operator_only BEFORE INSERT ON subscription_events
  FOR EACH ROW EXECUTE FUNCTION subscription_events_operator_only();
--> statement-breakpoint
-- Merchant status (active / suspended / closed) is the platform's decision; closed is final.
CREATE FUNCTION merchants_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF app_current_operator_id() IS NULL THEN
      RAISE EXCEPTION 'merchant status is changed by platform operators only'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.status = 'closed' THEN
      RAISE EXCEPTION 'a closed merchant cannot be reopened' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER merchants_status_guard BEFORE UPDATE ON merchants
  FOR EACH ROW EXECUTE FUNCTION merchants_status_guard();
--> statement-breakpoint
-- Starting plans. Prices are not set: pricing is not confirmed and nothing is billed.
INSERT INTO plans (id, code, name_en, name_ar, description_en, description_ar, is_default, is_public,
                   max_branches, max_employees, max_products, max_registers, features, trial_days, sort_order)
VALUES
  (gen_random_uuid(), 'standard', 'Standard', 'القياسية',
   'All features without limits (starting plan while pricing is confirmed).',
   'جميع المزايا بدون حدود (الخطة المبدئية حتى اعتماد الأسعار).',
   true, true, NULL, NULL, NULL, NULL, ARRAY['restaurant', 'ecommerce'], 30, 10),
  (gen_random_uuid(), 'basic', 'Basic', 'الأساسية', 'One branch, a small team.', 'فرع واحد وفريق صغير.',
   false, true, 1, 3, 200, 1, ARRAY[]::text[], 0, 20),
  (gen_random_uuid(), 'professional', 'Professional', 'الاحترافية',
   'Several branches with restaurant and online store.', 'عدة فروع مع المطعم والمتجر الإلكتروني.',
   false, true, 5, 25, NULL, 10, ARRAY['restaurant', 'ecommerce'], 0, 30);
--> statement-breakpoint
-- Existing merchants start on the default plan.
INSERT INTO subscriptions (id, merchant_id, plan_id, status, starts_at)
SELECT gen_random_uuid(), m.id, p.id, 'active', m.created_at
FROM merchants m CROSS JOIN plans p WHERE p.is_default
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.merchant_id = m.id);
--> statement-breakpoint
INSERT INTO subscription_events (id, merchant_id, subscription_id, kind, to_plan_id, to_status, reason)
SELECT gen_random_uuid(), s.merchant_id, s.id, 'created', s.plan_id, s.status, 'Existing merchant'
FROM subscriptions s;
--> statement-breakpoint
-- Suspended or closed merchants have no public store.
CREATE OR REPLACE FUNCTION store_merchant(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.merchant_id FROM online_stores s JOIN merchants m ON m.id = s.merchant_id
  WHERE lower(s.slug) = lower(p_slug) AND s.status IN ('published', 'paused') AND m.status = 'active'
$$;
--> statement-breakpoint
-- ---------------------------------------------------------------- platform read functions
-- The platform reads across merchants only through these functions (ADR-0080). They return
-- summaries, never business documents, and are called only by the platform-admin module.
CREATE FUNCTION platform_merchants(p_q text, p_status text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, display_name_en text, display_name_ar text, status text, contact_email text,
  created_at timestamptz, owner_email text, owner_name text, branch_count int, employee_count int,
  plan_code text, plan_name_en text, plan_name_ar text, subscription_status text,
  trial_ends_at timestamptz, ends_at timestamptz, last_sale_at timestamptz, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.display_name_en, m.display_name_ar, m.status, m.contact_email, m.created_at,
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
  LIMIT p_limit OFFSET p_offset
$$;
--> statement-breakpoint
CREATE FUNCTION platform_overview()
RETURNS TABLE (
  merchants_total bigint, merchants_active bigint, merchants_suspended bigint, merchants_closed bigint,
  merchants_new_30d bigint, trials_ending_7d bigint, subscriptions_lapsed bigint,
  branches_active bigint, employees_active bigint, sales_24h bigint, online_orders_24h bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
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
    (SELECT count(*) FROM online_orders WHERE created_at > now() - interval '24 hours')
$$;
--> statement-breakpoint
-- Platform audit: operator actions and platform sign-ins (merchant events stay private).
CREATE FUNCTION platform_audit(p_merchant uuid, p_action text, p_limit int, p_offset int)
RETURNS TABLE (
  id uuid, merchant_id uuid, merchant_name_en text, merchant_name_ar text, actor_type text,
  actor_id uuid, actor_name text, action text, target_type text, target_id uuid, ip text,
  details jsonb, occurred_at timestamptz, total_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.merchant_id, m.display_name_en, m.display_name_ar, a.actor_type, a.actor_id,
         op.full_name, a.action, a.target_type, a.target_id, a.ip, a.details, a.occurred_at,
         count(*) OVER ()
  FROM audit_log a
  LEFT JOIN merchants m ON m.id = a.merchant_id
  LEFT JOIN platform_operators op ON a.actor_type = 'operator' AND op.id = a.actor_id
  WHERE (a.actor_type = 'operator' OR a.action LIKE 'platform.%')
    AND (p_merchant IS NULL OR a.merchant_id = p_merchant)
    AND (p_action IS NULL OR position(lower(p_action) IN lower(a.action)) > 0)
  ORDER BY a.occurred_at DESC, a.id DESC
  LIMIT p_limit OFFSET p_offset
$$;
--> statement-breakpoint
-- Number of merchants per plan (plan list, overview).
CREATE FUNCTION platform_plan_counts() RETURNS TABLE (plan_id uuid, merchants bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT plan_id, count(*) FROM subscriptions GROUP BY plan_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_merchants(text, text, int, int), platform_overview(),
  platform_audit(uuid, text, int, int), platform_plan_counts() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_merchants(text, text, int, int), platform_overview(),
  platform_audit(uuid, text, int, int), platform_plan_counts() TO app_runtime;
