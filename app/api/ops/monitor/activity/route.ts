import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

async function verifySession(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get("ops_session")?.value
  if (!token) return false
  return verifyToken(token) !== null
}

export async function GET(request: NextRequest) {
  if (!(await verifySession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sp = request.nextUrl.searchParams
  const limit = Math.min(Number(sp.get("limit") || "50"), 200)
  const offset = Number(sp.get("offset") || "0")

  try {
    const admin = createAdminClient()
    const { data, count, error } = await (admin as any)
      .from("system_page_views")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw new Error(error.message)

    const activeQuery = await (admin as any)
      .from("system_page_views")
      .select("user_id, user_email", { count: "exact" })
      .gte("created_at", new Date(Date.now() - 90 * 1000).toISOString())
      .not("user_id", "is", null)

    const uniqueActive = new Set((activeQuery.data ?? []).map((r: any) => r.user_id)).size

    const pvCountQuery = await (admin as any)
      .from("system_page_views")
      .select("id", { count: "exact" })
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

    return NextResponse.json({
      rows: data ?? [],
      total: count ?? 0,
      active_users_15m: uniqueActive,
      page_views_24h: pvCountQuery.count ?? 0,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
