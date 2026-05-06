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

-- Update the increment RPC to accept a variable amount of credits
CREATE OR REPLACE FUNCTION public.increment_ai_usage(p_user_id UUID, p_credits INTEGER DEFAULT 1)
RETURNS VOID AS $$
BEGIN
    UPDATE public.ai_credit_limits
    SET 
        used_this_period = used_this_period + p_credits,
        updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
