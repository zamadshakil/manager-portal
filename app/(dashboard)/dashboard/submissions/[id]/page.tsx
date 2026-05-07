import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react"
import { requireProfile } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { SubmissionActions } from "@/components/dashboard/submission-actions"
import { fileIconLabel, formatBytes, formatRelative } from "@/lib/format"
import type { Submission, ValidationRun } from "@/lib/types"
import { cn } from "@/lib/utils"

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fromStatus?: string }>
}

export default async function SubmissionDetail({ params, searchParams }: PageProps) {
  const profile = await requireProfile()
  const { id } = await params
  const { fromStatus } = await searchParams
  const supabase = await createClient()

  const { data: submission } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", id)
    .single<Submission>()
  if (!submission) notFound()

  const { data: runs } = await supabase
    .from("validation_runs")
    .select("*")
    .eq("submission_id", id)
    .order("created_at", { ascending: false })
  const runRows = (runs ?? []) as ValidationRun[]

  // Resolve uploader display name (RLS allows reading profiles in same team / admins).
  const { data: uploader } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", submission.uploader_id)
    .maybeSingle()

  const isSystemFailure =
    (submission.status === "failed" || submission.status === "needs_review") &&
    !((submission.metadata as any)?.rules_evaluated > 0)

  const canRetry =
    profile.role === "main_admin" ||
    (profile.role === "manager" && profile.team_id === submission.team_id) ||
    (profile.id === submission.uploader_id && isSystemFailure)
  const canDelete =
    profile.role === "main_admin" ||
    (profile.role === "manager" && profile.team_id === submission.team_id)

  const flags = submission.flags ?? []

  return (
    <>
      <Link
        href={
          fromStatus
            ? `/dashboard/submissions?status=${encodeURIComponent(fromStatus)}`
            : "/dashboard/submissions"
        }
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to submissions
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-warm-white text-[11px] font-semibold tracking-wide">
            {fileIconLabel(submission.mime_type)}
          </span>
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-tight text-pretty">
              {submission.title}
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {uploader?.full_name ?? uploader?.email ?? "Member"} ·{" "}
              {formatBytes(submission.size_bytes)} · uploaded{" "}
              {formatRelative(submission.created_at)}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge status={submission.status} />
              {submission.score !== null ? (
                <span className="text-[12px] font-semibold text-muted-foreground">
                  Score {Number(submission.score).toFixed(0)}/100
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <SubmissionActions id={submission.id} canRetry={canRetry} canDelete={canDelete} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-4 lg:space-y-6 min-w-0">
          <section
            aria-labelledby="ai-summary"
            className="rounded-xl border border-border bg-card p-5 shadow-card"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-[#097fe8]">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <h2 id="ai-summary" className="text-[15px] font-semibold tracking-tight">
                AI summary
              </h2>
            </div>
            {submission.summary ? (
              <p className="mt-3 text-[13.5px] leading-relaxed whitespace-pre-line">
                {submission.summary}
              </p>
            ) : (
              <p className="mt-3 text-[13px] text-muted-foreground">
                {submission.status === "queued" || submission.status === "parsing"
                  ? "The pipeline is parsing this submission. Check back in a moment."
                  : submission.status === "validating"
                    ? "Validation rules are running. Refresh for the latest result."
                    : "No AI summary is available for this submission."}
              </p>
            )}
            {flags.length > 0 ? (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  Flags
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {flags.map((f, idx) => (
                    <li
                      key={idx}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-[12px] font-medium leading-snug",
                        f.severity === "fail" && "border-[#f6cdb1] bg-[#fff1e6] text-[#a4400a]",
                        f.severity === "warn" && "border-[#f4dfa2] bg-[#fff8e1] text-[#7a5b00]",
                        f.severity === "info" && "border-border bg-warm-white text-muted-foreground",
                      )}
                    >
                      {f.rule_name ? (
                        <span className="font-semibold">{f.rule_name}: </span>
                      ) : null}
                      {f.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section
            aria-labelledby="rule-results"
            className="rounded-xl border border-border bg-card shadow-card"
          >
            <header className="border-b border-border px-5 py-3.5">
              <h2 id="rule-results" className="text-[15px] font-semibold tracking-tight">
                Validation rule results
              </h2>
              <p className="text-[12px] text-muted-foreground">
                AI-powered checks applied to this submission.
              </p>
            </header>
            {runRows.length === 0 ? (
              <div className="px-5 py-10 text-center text-[13px] text-muted-foreground">
                No validation runs yet — the pipeline will populate this section.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {runRows.map((r) => {
                  const ruleName =
                    (r.raw_output as { rule_name?: string } | null)?.rule_name ??
                    "Validation rule"
                  return (
                    <li key={r.id} className="px-5 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-semibold">{ruleName}</p>
                          {r.reasons.length > 0 ? (
                            <ul className="mt-1 space-y-0.5">
                              {r.reasons.slice(0, 4).map((reason, idx) => (
                                <li
                                  key={idx}
                                  className="text-[12.5px] leading-relaxed text-muted-foreground"
                                >
                                  • {reason}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1 text-[12.5px] italic text-muted-foreground">
                              No specific reasons were provided.
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              r.pass === true && "bg-[#e8f8eb] text-[#157a2a]",
                              r.pass === false && "bg-[#fff1e6] text-[#a4400a]",
                              r.pass === null && "bg-muted text-muted-foreground",
                            )}
                          >
                            {r.pass === true ? "Passed" : r.pass === false ? "Failed" : "—"}
                          </span>
                          {r.score !== null ? (
                            <p className="mt-1 text-[11px] font-mono text-muted-foreground">
                              {Number(r.score).toFixed(0)}/100
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:space-y-6 min-w-0">
          <section className="rounded-xl border border-border bg-card p-5 shadow-card">
            <h2 className="text-[15px] font-semibold tracking-tight">File</h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-medium">{fileIconLabel(submission.mime_type)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Size</dt>
                <dd className="font-medium">{formatBytes(submission.size_bytes)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Uploaded</dt>
                <dd className="font-medium">{formatRelative(submission.created_at)}</dd>
              </div>
            </dl>
            <a
              href={`/api/download/${submission.id}?type=submission`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9 text-[13px] font-semibold hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open original
            </a>
          </section>

          {submission.task_id ? (
            <section className="rounded-xl border border-border bg-card p-5 shadow-card">
              <h2 className="text-[15px] font-semibold tracking-tight">Task</h2>
              <p className="mt-2 text-[13px] text-muted-foreground">
                Submitted in response to a task brief.
              </p>
              <Link
                href={`/dashboard/tasks/${submission.task_id}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9 text-[13px] font-semibold hover:bg-muted"
              >
                Open task
              </Link>
              {submission.is_late ? (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-[12px] font-semibold text-amber-900">Submitted late</p>
                  {submission.late_reason ? (
                    <p className="mt-1 text-[12px] text-amber-900/90">
                      {submission.late_reason}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
      </div>
    </>
  )
}
