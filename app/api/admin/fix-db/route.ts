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

    // 5. Force PostgREST to reload its schema cache
    await pgQuery(`NOTIFY pgrst, 'reload schema';`)

    return NextResponse.json({
      success: true,
      message: "Database schema successfully updated to match the latest GoTrue requirements.",
    })
  } catch (err: any) {
    console.error("[fix-db] Error updating schema:", err)
    return NextResponse.json(
      { error: err?.message || "Failed to update database schema." },
      { status: 500 }
    )
  }
}
