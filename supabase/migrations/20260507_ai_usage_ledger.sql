-- AI Usage Ledger Upgrade
-- =====================================================================
-- Enhances the ai_usage_log table to act as a granular transaction ledger
-- for all AI Credit activities across the platform.
-- =====================================================================

ALTER TABLE public.ai_usage_log
    ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'smart_ai_query',
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success',
    ADD COLUMN IF NOT EXISTS credits_deducted INTEGER NOT NULL DEFAULT 1;

-- Add indexes for filtering the ledger
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_event_type ON public.ai_usage_log(event_type);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_status ON public.ai_usage_log(status);

-- Update the increment RPC to accept metadata and handle logging atomically
CREATE OR REPLACE FUNCTION public.increment_ai_usage(
    p_user_id UUID, 
    p_credits INTEGER DEFAULT 1,
    p_event_type TEXT DEFAULT 'smart_ai_query',
    p_model TEXT DEFAULT NULL,
    p_thread_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_period_type TEXT;
BEGIN
    -- 1. Get period type for logging (fallback to monthly if no row yet)
    SELECT period_type INTO v_period_type
    FROM public.ai_credit_limits
    WHERE user_id = p_user_id;

    -- 2. Increment the counter
    UPDATE public.ai_credit_limits
    SET 
        used_this_period = used_this_period + p_credits,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- 3. Insert into the ledger (append-only)
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
