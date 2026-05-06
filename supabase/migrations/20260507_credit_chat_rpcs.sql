-- =============================================================================
-- Credit Intelligence RPCs for Smart AI Chat
-- =============================================================================
-- Provides two SECURITY DEFINER functions used exclusively by the Smart AI
-- chat route's new credit-awareness tools:
--
--   1. get_user_credit_summary(p_user_id)
--      Returns a single user's credit quota row. Callable by the user
--      themselves (via service-role in the chat route) or by a main_admin.
--
--   2. get_department_credit_summary()
--      Admin-only aggregate: ranks teams by total credits consumed this period.
--      Joins ai_usage_log → profiles → teams in one round-trip.
--
--   3. get_top_credit_consumers(p_limit)
--      Admin-only: returns top N users by used_this_period, with their name,
--      email, team, role, and usage stats.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. get_user_credit_summary
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_credit_summary(p_user_id UUID)
RETURNS TABLE (
    user_id           UUID,
    monthly_limit     INTEGER,
    used_this_period  INTEGER,
    remaining         INTEGER,
    period_type       TEXT,
    period_start      DATE,
    period_end        DATE,
    is_unlimited      BOOLEAN,
    usage_pct         NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        acl.user_id,
        acl.monthly_limit,
        acl.used_this_period,
        CASE
            WHEN acl.is_unlimited THEN NULL::INTEGER
            ELSE GREATEST(0, acl.monthly_limit - acl.used_this_period)
        END AS remaining,
        acl.period_type,
        acl.period_start,
        acl.period_end,
        acl.is_unlimited,
        CASE
            WHEN acl.is_unlimited OR acl.monthly_limit = 0 THEN 0::NUMERIC
            ELSE ROUND((acl.used_this_period::NUMERIC / acl.monthly_limit) * 100, 1)
        END AS usage_pct
    FROM public.ai_credit_limits acl
    WHERE acl.user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_credit_summary(UUID) TO service_role;


-- -----------------------------------------------------------------------------
-- 2. get_department_credit_summary
-- -----------------------------------------------------------------------------
-- Aggregates credit consumption by team (department) for the current active
-- period. Uses a JOIN on profiles to resolve user → team mapping.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_department_credit_summary()
RETURNS TABLE (
    team_id              UUID,
    team_name            TEXT,
    total_credits_used   BIGINT,
    active_users         BIGINT,
    avg_credits_per_user NUMERIC,
    near_limit_users     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id                                          AS team_id,
        t.name                                        AS team_name,
        COALESCE(SUM(acl.used_this_period), 0)        AS total_credits_used,
        COUNT(acl.user_id)                            AS active_users,
        CASE
            WHEN COUNT(acl.user_id) = 0 THEN 0::NUMERIC
            ELSE ROUND(SUM(acl.used_this_period)::NUMERIC / COUNT(acl.user_id), 1)
        END                                           AS avg_credits_per_user,
        COUNT(CASE
            WHEN NOT acl.is_unlimited
              AND acl.monthly_limit > 0
              AND (acl.used_this_period::NUMERIC / acl.monthly_limit) >= 0.9
            THEN 1
        END)                                          AS near_limit_users
    FROM public.teams t
    LEFT JOIN public.profiles p   ON p.team_id = t.id
    LEFT JOIN public.ai_credit_limits acl ON acl.user_id = p.id
    GROUP BY t.id, t.name
    ORDER BY total_credits_used DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_department_credit_summary() TO service_role;


-- -----------------------------------------------------------------------------
-- 3. get_top_credit_consumers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_top_credit_consumers(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    user_id           UUID,
    full_name         TEXT,
    email             TEXT,
    role              TEXT,
    team_name         TEXT,
    used_this_period  INTEGER,
    monthly_limit     INTEGER,
    is_unlimited      BOOLEAN,
    usage_pct         NUMERIC,
    period_type       TEXT,
    period_end        DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        acl.user_id,
        pr.full_name,
        pr.email,
        pr.role::TEXT,
        t.name                                        AS team_name,
        acl.used_this_period,
        acl.monthly_limit,
        acl.is_unlimited,
        CASE
            WHEN acl.is_unlimited OR acl.monthly_limit = 0 THEN 0::NUMERIC
            ELSE ROUND((acl.used_this_period::NUMERIC / acl.monthly_limit) * 100, 1)
        END                                           AS usage_pct,
        acl.period_type,
        acl.period_end
    FROM public.ai_credit_limits acl
    JOIN public.profiles pr ON pr.id = acl.user_id
    LEFT JOIN public.teams t ON t.id = pr.team_id
    ORDER BY acl.used_this_period DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_top_credit_consumers(INTEGER) TO service_role;
