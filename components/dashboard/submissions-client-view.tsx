"use client"

import { useState, useMemo } from "react"
import { SubmissionsFilter } from "@/components/dashboard/submissions-filter"
import { SubmissionsTable } from "@/components/dashboard/submissions-table"
import type { Submission } from "@/lib/types"

type FilterValue = "all" | "passed" | "needs_review" | "failed"

interface SubmissionsClientViewProps {
  rows: Submission[]
  canDelete: boolean
  canUpdateOrDelete: boolean
  canViewAiInsights: boolean
  taskMap: Record<string, { id: string; title: string }>
  userMap: Record<string, { id: string; full_name: string | null; email: string }>
}

export function SubmissionsClientView({
  rows,
  canDelete,
  canUpdateOrDelete,
  canViewAiInsights,
  taskMap,
  userMap,
}: SubmissionsClientViewProps) {
  const [filter, setFilter] = useState<FilterValue>("all")

  const filtered = useMemo(() => {
    if (filter === "all") return rows
    return rows.filter((r) => r.status === filter)
  }, [rows, filter])

  const emptyHint =
    filter !== "all"
      ? `No submissions match the "${filter.replace("_", " ")}" filter.`
      : !canUpdateOrDelete
        ? "Upload your first document to get started."
        : "Your team hasn't uploaded anything yet."

  return (
    <>
      <SubmissionsFilter value={filter} onChange={(v) => setFilter(v as FilterValue)} />
      <SubmissionsTable
        rows={filtered}
        showFooterLink={false}
        emptyHint={emptyHint}
        canDelete={canDelete}
        canViewAiInsights={canViewAiInsights}
        fromStatus={filter !== "all" ? filter : undefined}
        grouped
        taskMap={taskMap}
        userMap={userMap}
      />
    </>
  )
}
