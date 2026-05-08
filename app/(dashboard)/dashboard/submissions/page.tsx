import Link from "next/link"
import { Plus } from "lucide-react"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { listSubmissions } from "@/lib/data"
import { PageHeader } from "@/components/dashboard/page-header"
import { SubmissionsTable } from "@/components/dashboard/submissions-table"
import { SubmissionsFilter } from "@/components/dashboard/submissions-filter"
import { BulkExportDialog } from "@/components/dashboard/bulk-export-dialog"
import type { SubmissionStatus } from "@/lib/types"

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

const VALID: SubmissionStatus[] = [
  "queued",
  "parsing",
  "validating",
  "passed",
  "failed",
  "needs_review",
  "late_submitted",
  "missed",
]

export default async function SubmissionsPage({ searchParams }: PageProps) {
  const profile = await requireProfile()
  const canExport = profile.role === "main_admin" || profile.role === "manager"

  const supabase = await createClient()
  const { data: teams } = canExport
    ? await supabase.from("teams").select("id, name").order("name")
    : { data: [] }

  const params = await searchParams
  const status =
    params.status && (VALID as string[]).includes(params.status)
      ? (params.status as SubmissionStatus)
      : undefined

  const { rows } = await listSubmissions(profile, { status, limit: 100 })

  const canDelete = profile.role === "manager" || profile.role === "main_admin"

  return (
    <>
      <PageHeader
        title="Submissions"
        description={
          profile.role === "member"
            ? "Track the validation status of everything you've uploaded."
            : "Every submission across your team — sortable, filterable, exportable."
        }
        action={
          profile.role === "member" ? (
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

      <SubmissionsFilter />

      <SubmissionsTable
        rows={rows}
        showFooterLink={false}
        emptyHint={
          status
            ? `No submissions match the "${status.replace("_", " ")}" filter.`
            : profile.role === "member"
              ? "Upload your first document to start the validation pipeline."
              : "Your team hasn't uploaded anything yet."
        }
        canDelete={canDelete}
        fromStatus={status}
      />
    </>
  )
}
