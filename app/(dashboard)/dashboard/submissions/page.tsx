import Link from "next/link"
import { redirect } from "next/navigation"
import { Plus } from "lucide-react"
import { requireProfile } from "@/lib/auth"
import { CAPABILITIES, getAccessContext } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { listSubmissions } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { BulkExportDialog } from "@/components/dashboard/bulk-export-dialog"
import { SubmissionsClientView } from "@/components/dashboard/submissions-client-view"

export default async function SubmissionsPage() {
  const profile = await requireProfile()
  const ctx = await getAccessContext(profile)
  const canReadSubmissions = ctx.has(CAPABILITIES.SUBMISSIONS_READ)
  const canUpdateSubmissions = ctx.has(CAPABILITIES.SUBMISSIONS_UPDATE)
  const canDeleteSubmissions = ctx.has(CAPABILITIES.SUBMISSIONS_DELETE)
  const canViewAiInsights = profile.role === "main_admin" || profile.role === "manager"

  if (!canReadSubmissions && !canUpdateSubmissions && !canDeleteSubmissions) {
    redirect("/dashboard")
  }

  const canExport = profile.role === "main_admin" || profile.role === "manager"

  const supabase = await createClient()
  const { data: teams } = canExport
    ? await supabase.from("teams").select("id, name").order("name")
    : { data: [] }

  const { rows } = await listSubmissions(profile, { limit: 100 })

  const taskIds = [...new Set(rows.filter((r) => r.task_id).map((r) => r.task_id as string))]
  const uploaderIds = [...new Set(rows.map((r) => r.uploader_id))]

  const admin = createAdminClient()
  const [tasksRes, profilesRes] = await Promise.all([
    taskIds.length > 0
      ? admin.from("tasks").select("id, title").in("id", taskIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    uploaderIds.length > 0
      ? admin.from("profiles").select("id, full_name, email").in("id", uploaderIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ])

  const taskMap = Object.fromEntries(
    ((tasksRes.data ?? []) as { id: string; title: string }[]).map((t) => [t.id, t]),
  ) as Record<string, { id: string; title: string }>

  const userMap = Object.fromEntries(
    ((profilesRes.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p]),
  ) as Record<string, { id: string; full_name: string | null; email: string }>

  return (
    <>
      <PageHeader
        title="Submissions"
        description={
          !canUpdateSubmissions && !canDeleteSubmissions
            ? "Track the validation status of everything you've uploaded."
            : "Every submission across your team — sortable, filterable, exportable."
        }
        action={
          !canUpdateSubmissions && !canDeleteSubmissions ? (
            <Link
              href="/dashboard/tasks"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-10 text-[13px] font-semibold text-primary-foreground hover:bg-[#005bab] active:scale-[0.97] transition-all"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Open tasks
            </Link>
          ) : canExport ? (
            <BulkExportDialog
              type="submissions"
              teams={teams ?? []}
              role={profile.role as "main_admin" | "manager"}
              currentTeamId={profile.team_id}
            />
          ) : null
        }
      />

      <SubmissionsClientView
        rows={rows}
        canDelete={canDeleteSubmissions}
        canUpdateOrDelete={canUpdateSubmissions || canDeleteSubmissions}
        canViewAiInsights={canViewAiInsights}
        taskMap={taskMap}
        userMap={userMap}
      />
    </>
  )
}
