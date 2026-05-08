-- Fix: increment_ai_usage RPC signature mismatch
-- =====================================================================
-- Production still has the old 1-param version from
-- 20260506_ai_usage_increment_rpc.sql.  The app calls it with 5 named
-- params (p_user_id, p_credits, p_event_type, p_model, p_thread_id)
-- which PostgREST cannot resolve → "Could not find the function …
-- in the schema cache".
--
-- This migration:
--   1. Ensures the ai_usage_log ledger columns exist (idempotent).
--   2. Drops the stale 1-param overload that shadows the new one.
--   3. Creates the correct 5-param version via CREATE OR REPLACE.
-- =====================================================================

-- 1. Add ledger columns if they were never added (idempotent)
ALTER TABLE public.ai_usage_log
    ADD COLUMN IF NOT EXISTS event_type       TEXT    NOT NULL DEFAULT 'smart_ai_query',
    ADD COLUMN IF NOT EXISTS status           TEXT    NOT NULL DEFAULT 'success',
    ADD COLUMN IF NOT EXISTS credits_deducted INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_event_type ON public.ai_usage_log(event_type);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_status     ON public.ai_usage_log(status);

-- 2. Drop the old 1-param overload so it cannot shadow the new one
DROP FUNCTION IF EXISTS public.increment_ai_usage(UUID);

-- 3. Create (or replace) the full 5-param version
CREATE OR REPLACE FUNCTION public.increment_ai_usage(
    p_user_id    UUID,
    p_credits    INTEGER DEFAULT 1,
    p_event_type TEXT    DEFAULT 'smart_ai_query',
    p_model      TEXT    DEFAULT NULL,
    p_thread_id  UUID    DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_period_type TEXT;
BEGIN
    -- Resolve the user's current period type for the ledger row
    SELECT period_type INTO v_period_type
    FROM public.ai_credit_limits
    WHERE user_id = p_user_id;

    -- Atomic counter increment (avoids stale-read race conditions)
    UPDATE public.ai_credit_limits
    SET
        used_this_period = used_this_period + p_credits,
        updated_at       = NOW()
    WHERE user_id = p_user_id;

    -- Append-only ledger entry
    INSERT INTO public.ai_usage_log (
        user_id,
        thread_id,
        model,
        period_type,
        event_type,
        credits_deducted,
        status
    ) VALUES (
        p_user_id,
        p_thread_id,
        COALESCE(p_model, 'unknown'),
        COALESCE(v_period_type, 'monthly'),
        p_event_type,
        p_credits,
        'success'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Reload PostgREST schema cache so the change is visible immediately
NOTIFY pgrst, 'reload schema';
