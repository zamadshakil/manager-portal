import { NextResponse } from "next/server"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const profile = await requireProfile()
    const supabase = await createClient()

    const { data } = await supabase
      .from("ai_credit_limits")
      .select("*")
      .eq("user_id", profile.id)
      .maybeSingle()

    if (!data) {
      // No row yet — treat as unlimited (admin hasn't configured a limit)
      return NextResponse.json({
        used: 0,
        limit: 100,
        remaining: 100,
        periodType: "monthly",
        periodEnd: null,
        isUnlimited: profile.role === "main_admin",
        hasLimit: false,
      })
    }

    const row = data as any
    const used = row.used_this_period ?? 0
    const limit = row.monthly_limit ?? 100
    const isUnlimited = row.is_unlimited ?? false

    return NextResponse.json({
      used,
      limit,
      remaining: isUnlimited ? Infinity : Math.max(0, limit - used),
      periodType: row.period_type,
      periodEnd: row.period_end,
      isUnlimited,
      hasLimit: true,
    })
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
}
