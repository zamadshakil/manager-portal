import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifyToken } from "@/lib/ops/auth"
import { createAdminClient } from "@/lib/supabase/admin"
import { listErrorLogs, listRequestLogs } from "@/lib/system"

export const dynamic = "force-dynamic"

async function verifySession(): Promise<boolean> {
  const jar = await cookies()
  const token = jar.get("ops_session")?.value
  if (!token) return false
  return verifyToken(token) !== null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  if (!(await verifySession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { userId } = await params
  const admin = createAdminClient()

  const [profileRes, sessionsRes, errorsRes, requestsRes, activityRes] = await Promise.all([
    // Profile
    (admin.from("profiles") as any)
      .select("id, email, full_name, role, avatar_url, created_at")
      .eq("id", userId)
      .single(),

    // Session history
    (admin as any)
      .from("system_user_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),

    // Error logs
    (admin.from("system_error_logs") as any)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),

    // Network error logs (client fetch failures)
    (admin.from("system_request_logs") as any)
      .select("*")
      .eq("user_id", userId)
      .gte("status_code", 400)
      .order("created_at", { ascending: false })
      .limit(50),

    // Page views
    (admin as any)
      .from("system_page_views")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ])

  if (profileRes.error) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  // Build a unified timeline
  type TimelineEntry = {
    kind: "session" | "error" | "network" | "page_view"
    at: string
    data: Record<string, unknown>
  }

  const timeline: TimelineEntry[] = []

  for (const s of sessionsRes.data ?? []) {
    timeline.push({ kind: "session", at: s.created_at, data: s })
  }
  for (const e of errorsRes.data ?? []) {
    timeline.push({ kind: "error", at: e.created_at, data: e })
  }
  for (const r of requestsRes.data ?? []) {
    timeline.push({ kind: "network", at: r.created_at, data: r })
  }
  for (const p of activityRes.data ?? []) {
    timeline.push({ kind: "page_view", at: p.created_at, data: p })
  }

  timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  return NextResponse.json({
    profile: profileRes.data,
    sessions: sessionsRes.data ?? [],
    errors: errorsRes.data ?? [],
    network_errors: requestsRes.data ?? [],
    page_views: activityRes.data ?? [],
    timeline: timeline.slice(0, 200),
  })
}
