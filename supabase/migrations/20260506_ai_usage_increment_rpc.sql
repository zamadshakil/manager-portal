-- Atomic AI Usage Increment RPC
-- =====================================================================
-- This function atomically increments used_this_period by 1 for a given
-- user. It avoids the race condition where multiple concurrent onFinish
-- callbacks read the same stale value from a JS closure and all write
-- the same incremented value (effectively losing N-1 increments).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.increment_ai_usage(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.ai_credit_limits
    SET 
        used_this_period = used_this_period + 1,
        updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
