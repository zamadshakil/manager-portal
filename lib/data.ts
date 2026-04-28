import { createClient } from "@/lib/supabase/server"
import type {
  ActivityLogEntry,
  Announcement,
  Material,
  Profile,
  Submission,
  Team,
  ValidationRule,
} from "@/lib/types"

export interface DashboardSummary {
  total: number
  passed: number
  failed: number
  needsReview: number
  passRate: number
  avgScore: number
  recent: Submission[]
}

interface RecentRow {
  id: string
  uploader_id: string
  team_id: string
  title: string
  blob_url: string
  blob_pathname: string | null
  mime_type: string
  size_bytes: number | null
  status: Submission["status"]
  score: number | null
  summary: string | null
  flags: Submission["flags"]
  created_at: string
  updated_at: string
}

export async function getDashboardSummary(profile: Profile): Promise<DashboardSummary> {
  const supabase = await createClient()

  // Scope by role.
  let countQuery = supabase
    .from("submissions")
    .select("status", { count: "exact", head: false })
  if (profile.role === "manager" && profile.team_id) {
    countQuery = countQuery.eq("team_id", profile.team_id)
  } else if (profile.role === "member") {
    countQuery = countQuery.eq("uploader_id", profile.id)
  }
  const { data: countData } = await countQuery

  const total = countData?.length ?? 0
  const passed = countData?.filter((r) => r.status === "passed").length ?? 0
  const failed = countData?.filter((r) => r.status === "failed").length ?? 0
  const needsReview = countData?.filter((r) => r.status === "needs_review").length ?? 0
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0

  // Avg score across passed/failed/needs_review (i.e. completed runs).
  let scoreQuery = supabase
    .from("submissions")
    .select("score")
    .not("score", "is", null)
  if (profile.role === "manager" && profile.team_id) {
    scoreQuery = scoreQuery.eq("team_id", profile.team_id)
  } else if (profile.role === "member") {
    scoreQuery = scoreQuery.eq("uploader_id", profile.id)
  }
  const { data: scoreRows } = await scoreQuery.limit(500)
  const avgScore =
    scoreRows && scoreRows.length > 0
      ? Math.round(
          scoreRows.reduce((acc, r) => acc + Number((r as { score: number }).score), 0) /
            scoreRows.length,
        )
      : 0

  // Most recent 6 submissions.
  let recentQuery = supabase
    .from("submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(6)
  if (profile.role === "manager" && profile.team_id) {
    recentQuery = recentQuery.eq("team_id", profile.team_id)
  } else if (profile.role === "member") {
    recentQuery = recentQuery.eq("uploader_id", profile.id)
  }
  const { data: recent } = await recentQuery

  return {
    total,
    passed,
    failed,
    needsReview,
    passRate,
    avgScore,
    recent: ((recent as RecentRow[] | null) ?? []) as Submission[],
  }
}

export async function listSubmissions(
  profile: Profile,
  opts: { status?: Submission["status"]; limit?: number; cursor?: string } = {},
): Promise<{ rows: Submission[]; nextCursor?: string }> {
  const supabase = await createClient()
  const limit = Math.min(opts.limit ?? 50, 100)

  let q = supabase
    .from("submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit + 1)

  if (profile.role === "manager" && profile.team_id) q = q.eq("team_id", profile.team_id)
  if (profile.role === "member") q = q.eq("uploader_id", profile.id)
  if (opts.status) q = q.eq("status", opts.status)
  if (opts.cursor) q = q.lt("created_at", opts.cursor)

  const { data } = await q
  const rows = (data ?? []) as Submission[]
  const next = rows.length > limit ? rows[limit].created_at : undefined
  return { rows: rows.slice(0, limit), nextCursor: next }
}

export async function getSubmissionById(profile: Profile, id: string): Promise<Submission | null> {
  const supabase = await createClient()
  const { data } = await supabase.from("submissions").select("*").eq("id", id).single()
  return (data as Submission | null) ?? null
}

export async function listAnnouncements(profile: Profile, limit = 50): Promise<Announcement[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data ?? []) as Announcement[]
}

export async function listMaterials(profile: Profile, limit = 100): Promise<Material[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("materials")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  return (data ?? []) as Material[]
}

export async function listActivity(
  profile: Profile,
  limit = 100,
): Promise<(ActivityLogEntry & { actor_name?: string | null; actor_email?: string | null })[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("activity_log")
    .select("*, actor:profiles!activity_log_actor_id_fkey(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (!data) return []
  return (data as Array<ActivityLogEntry & { actor: { full_name: string | null; email: string } | null }>).map(
    (row) => ({
      ...row,
      actor_name: row.actor?.full_name ?? null,
      actor_email: row.actor?.email ?? null,
    }),
  )
}

export interface DailyMetricRow {
  day: string
  submissions: number
  passed: number
  failed: number
  needs_review: number
  avg_score: number
}

export async function getDailyMetrics(
  profile: Profile,
  days = 30,
): Promise<DailyMetricRow[]> {
  const supabase = await createClient()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  let q = supabase
    .from("submissions")
    .select("created_at, status, score")
    .gte("created_at", since)
    .order("created_at", { ascending: true })

  if (profile.role === "manager" && profile.team_id) q = q.eq("team_id", profile.team_id)
  if (profile.role === "member") q = q.eq("uploader_id", profile.id)

  const { data } = await q
  if (!data) return []

  const buckets = new Map<string, DailyMetricRow>()
  for (const row of data as Array<{ created_at: string; status: string; score: number | null }>) {
    const day = row.created_at.slice(0, 10)
    const existing =
      buckets.get(day) ??
      ({ day, submissions: 0, passed: 0, failed: 0, needs_review: 0, avg_score: 0 } as DailyMetricRow)
    existing.submissions += 1
    if (row.status === "passed") existing.passed += 1
    if (row.status === "failed") existing.failed += 1
    if (row.status === "needs_review") existing.needs_review += 1
    if (row.score !== null) {
      // running mean
      const n = existing.submissions
      existing.avg_score = ((existing.avg_score * (n - 1)) + Number(row.score)) / n
    }
    buckets.set(day, existing)
  }

  // fill missing days for stable chart axis
  const out: DailyMetricRow[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    out.push(
      buckets.get(key) ?? {
        day: key,
        submissions: 0,
        passed: 0,
        failed: 0,
        needs_review: 0,
        avg_score: 0,
      },
    )
  }
  return out
}

export async function listRules(profile: Profile): Promise<ValidationRule[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("validation_rules")
    .select("*")
    .order("created_at", { ascending: false })
  return (data ?? []) as ValidationRule[]
}

export async function listTeamMembers(profile: Profile): Promise<Profile[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true })
  return (data ?? []) as Profile[]
}

export async function listTeams(): Promise<Team[]> {
  const supabase = await createClient()
  const { data } = await supabase.from("teams").select("*").order("name", { ascending: true })
  return (data ?? []) as Team[]
}
