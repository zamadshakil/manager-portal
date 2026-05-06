import { NextResponse } from "next/server"
import { pgQuery, isDirectPgConfigured } from "@/lib/smart-ai/pg-client"

export async function GET() {
  if (!isDirectPgConfigured()) {
    return NextResponse.json(
      { error: "Direct PostgreSQL connection is not configured on this environment." },
      { status: 500 }
    )
  }

  try {
    // 1. Add refresh_token_hmac_key
    await pgQuery(`
      ALTER TABLE auth.sessions 
      ADD COLUMN IF NOT EXISTS refresh_token_hmac_key text;
    `)

    // 2. Add oauth_client_id (frequently missing alongside the above)
    await pgQuery(`
      ALTER TABLE auth.sessions 
      ADD COLUMN IF NOT EXISTS oauth_client_id text;
    `)

    // 3. Add not_after (another column recently added to GoTrue)
    await pgQuery(`
      ALTER TABLE auth.sessions 
      ADD COLUMN IF NOT EXISTS not_after timestamptz;
    `)

    // 4. Add is_sso_user to auth.users (another recent addition)
    await pgQuery(`
      ALTER TABLE auth.users 
      ADD COLUMN IF NOT EXISTS is_sso_user boolean DEFAULT false;
    `)

    // 5. AI Usage Ledger: Add missing columns and indexes for granular audit trail
    await pgQuery(`
      ALTER TABLE public.ai_usage_log
      ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'smart_ai_query',
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success',
      ADD COLUMN IF NOT EXISTS credits_deducted INTEGER NOT NULL DEFAULT 1;

      CREATE INDEX IF NOT EXISTS idx_ai_usage_log_event_type ON public.ai_usage_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_log_status ON public.ai_usage_log(status);
    `)

    // 6. Upgrade increment_ai_usage RPC
    await pgQuery(`
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
    `)

    // 7. Enable Realtime for AI tables (PostgreSQL Publication)
    await pgQuery(`
      DO $$
      BEGIN
        -- Enable for usage logs
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'ai_usage_log'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE ai_usage_log;
        END IF;

        -- Enable for credit limits
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' AND tablename = 'ai_credit_limits'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE ai_credit_limits;
        END IF;
      END
      $$;
    `)

    // 8. Force PostgREST to reload its schema cache
    await pgQuery(`NOTIFY pgrst, 'reload schema';`)

    return NextResponse.json({
      success: true,
      message: "Database schema successfully updated to match the latest GoTrue and AI Economy requirements.",
    })
  } catch (err: any) {
    console.error("[fix-db] Error updating schema:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to update database schema." },
      { status: 500 }
    )
  }
}
