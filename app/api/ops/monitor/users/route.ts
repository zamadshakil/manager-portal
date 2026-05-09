import { NextResponse } from "next/server"
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

export async function GET() {
  if (!(await verifySession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()

  const [profilesRes, recentSessionsRes, errorCountsRes, activityRes] = await Promise.all([
    // All users
    (admin.from("profiles") as any)
      .select("id, email, full_name, role, avatar_url, created_at, deleted_at"),

    // Most recent session event per user (determines online status)
    (admin as any)
      .from("system_user_sessions")
      .select("user_id, user_email, event_type, created_at")
      .order("created_at", { ascending: false })
      .limit(500),

    // Error count per user (last 7 days)
    (admin.from("system_error_logs") as any)
      .select("user_id")
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .not("user_id", "is", null),

    // Latest page view per user
    (admin as any)
      .from("system_page_views")
      .select("user_id, pathname, created_at")
      .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1000),
  ])

  const profiles: any[] = profilesRes.data ?? []
  const sessions: any[] = recentSessionsRes.data ?? []
  const errorRows: any[] = errorCountsRes.data ?? []
  const activityRows: any[] = activityRes.data ?? []

  const now = Date.now()
  const ONLINE_THRESHOLD_MS = 30 * 1000   // heartbeat within 30s = online
  const RECENT_THRESHOLD_MS = 90 * 1000   // within 90s = recently active

  // Last session event per user
  const lastSessionByUser: Record<string, any> = {}
  for (const s of sessions) {
    if (!lastSessionByUser[s.user_id]) lastSessionByUser[s.user_id] = s
  }

  // Error counts per user
  const errorCountByUser: Record<string, number> = {}
  for (const r of errorRows) {
    errorCountByUser[r.user_id] = (errorCountByUser[r.user_id] || 0) + 1
  }

  // Last activity per user
  const lastActivityByUser: Record<string, any> = {}
  for (const r of activityRows) {
    if (!lastActivityByUser[r.user_id]) lastActivityByUser[r.user_id] = r
  }

  const users = profiles.map((p) => {
    const lastSession = lastSessionByUser[p.id]
    const lastActivity = lastActivityByUser[p.id]
    const lastSeenAt = lastSession?.created_at || lastActivity?.created_at || null

    let status: "online" | "recent" | "offline" = "offline"
    if (lastSeenAt) {
      const diff = now - new Date(lastSeenAt).getTime()
      if (diff < ONLINE_THRESHOLD_MS) status = "online"
      else if (diff < RECENT_THRESHOLD_MS) status = "recent"
    }

    return {
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      role: p.role,
      avatar_url: p.avatar_url,
      created_at: p.created_at,
      deleted_at: p.deleted_at,
      status,
      last_seen_at: lastSeenAt,
      last_pathname: lastSession?.event_type !== "logout" ? lastActivity?.pathname : null,
      errors_7d: errorCountByUser[p.id] || 0,
      last_session_event: lastSession?.event_type || null,
    }
  })

  // Sort: online first, then recent, then offline; within each group by last_seen desc
  users.sort((a, b) => {
    const order = { online: 0, recent: 1, offline: 2 }
    const od = order[a.status] - order[b.status]
    if (od !== 0) return od
    if (a.last_seen_at && b.last_seen_at) {
      return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
    }
    return 0
  })

  return NextResponse.json({ users })
}
