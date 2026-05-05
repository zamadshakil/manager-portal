-- AI Credit Quota & Usage System
-- =====================================================================
-- This migration creates the tables and RPCs needed to track AI usage
-- per user and enforce periodic limits.
-- =====================================================================

-- 1. AI Credit Limits Table -------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_credit_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    monthly_limit INTEGER NOT NULL DEFAULT 100,
    used_this_period INTEGER NOT NULL DEFAULT 0,
    period_type TEXT NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('daily', 'weekly', 'monthly')),
    period_start DATE NOT NULL DEFAULT CURRENT_DATE,
    period_end DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '1 month'),
    is_unlimited BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for lookup
CREATE INDEX IF NOT EXISTS idx_ai_credit_limits_user_id ON public.ai_credit_limits(user_id);

-- 2. AI Usage Log Table (Append-only) ---------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    thread_id UUID REFERENCES chat_threads(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    period_type TEXT NOT NULL DEFAULT 'monthly',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for trend reporting
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created ON public.ai_usage_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created ON public.ai_usage_log(created_at);

-- 3. Automatic Period Reset RPC ---------------------------------------
-- This function is called by the chat route before checking limits.
-- If the current date is past the period_end, it resets the counter.

CREATE OR REPLACE FUNCTION public.maybe_reset_period(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_period_type TEXT;
    v_period_end DATE;
    v_new_start DATE;
    v_new_end DATE;
BEGIN
    -- Fetch the current settings
    SELECT period_type, period_end 
    INTO v_period_type, v_period_end
    FROM public.ai_credit_limits
    WHERE user_id = p_user_id;

    -- If no row exists, we do nothing (the app will create the row)
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Check if period has expired
    IF CURRENT_DATE > v_period_end THEN
        -- Calculate new bounds
        IF v_period_type = 'daily' THEN
            v_new_start := CURRENT_DATE;
            v_new_end := CURRENT_DATE;
        ELSIF v_period_type = 'weekly' THEN
            -- Reset to Monday
            v_new_start := date_trunc('week', CURRENT_DATE)::date;
            v_new_end := (v_new_start + INTERVAL '6 days')::date;
        ELSE -- monthly
            v_new_start := date_trunc('month', CURRENT_DATE)::date;
            v_new_end := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date;
        END IF;

        -- Update the row
        UPDATE public.ai_credit_limits
        SET 
            used_this_period = 0,
            period_start = v_new_start,
            period_end = v_new_end,
            updated_at = NOW()
        WHERE user_id = p_user_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RLS Policies -----------------------------------------------------
ALTER TABLE public.ai_credit_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

-- ai_credit_limits: users can read their own, main_admin can read all
DROP POLICY IF EXISTS "Users can view own credit limits" ON public.ai_credit_limits;
CREATE POLICY "Users can view own credit limits" ON public.ai_credit_limits
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all credit limits" ON public.ai_credit_limits;
CREATE POLICY "Admins can view all credit limits" ON public.ai_credit_limits
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'main_admin'
        )
    );

-- Only admins can update/insert limits (managed via actions)
DROP POLICY IF EXISTS "Admins can manage credit limits" ON public.ai_credit_limits;
CREATE POLICY "Admins can manage credit limits" ON public.ai_credit_limits
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'main_admin'
        )
    );

-- ai_usage_log: users can read their own, main_admin can read all
DROP POLICY IF EXISTS "Users can view own usage logs" ON public.ai_usage_log;
CREATE POLICY "Users can view own usage logs" ON public.ai_usage_log
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all usage logs" ON public.ai_usage_log;
CREATE POLICY "Admins can view all usage logs" ON public.ai_usage_log
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = auth.uid() AND role = 'main_admin'
        )
    );
