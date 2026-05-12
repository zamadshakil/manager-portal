export interface TaskDeadlineInput {
  dueAt: string | null | undefined
  allowLate: boolean
  lateSubmissionDeadline: string | null | undefined
}

export type TaskDeadlinePhase = "open" | "late_window" | "closed"
export type TaskDeadlineClosureReason = "due_at" | "late_submission_deadline" | null

export interface TaskDeadlineWindow {
  phase: TaskDeadlinePhase
  dueAtMs: number | null
  lateSubmissionDeadlineMs: number | null
  hasDeadline: boolean
  isOverdue: boolean
  isLateWindowOpen: boolean
  isClosed: boolean
  acceptsSubmissions: boolean
  nextTransitionAt: number | null
  closureReason: TaskDeadlineClosureReason
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export function getTaskDeadlineTransitionTimestamps(input: TaskDeadlineInput): number[] {
  const dueAtMs = toTimestamp(input.dueAt)
  const lateSubmissionDeadlineMs = input.allowLate ? toTimestamp(input.lateSubmissionDeadline) : null

  return [dueAtMs, lateSubmissionDeadlineMs].filter((value): value is number => value !== null)
}

export function getTaskDeadlineWindow(
  input: TaskDeadlineInput,
  now: number = Date.now(),
): TaskDeadlineWindow {
  const dueAtMs = toTimestamp(input.dueAt)
  const lateSubmissionDeadlineMs = toTimestamp(input.lateSubmissionDeadline)

  if (dueAtMs === null) {
    return {
      phase: "open",
      dueAtMs,
      lateSubmissionDeadlineMs,
      hasDeadline: false,
      isOverdue: false,
      isLateWindowOpen: false,
      isClosed: false,
      acceptsSubmissions: true,
      nextTransitionAt: null,
      closureReason: null,
    }
  }

  if (now < dueAtMs) {
    return {
      phase: "open",
      dueAtMs,
      lateSubmissionDeadlineMs,
      hasDeadline: true,
      isOverdue: false,
      isLateWindowOpen: false,
      isClosed: false,
      acceptsSubmissions: true,
      nextTransitionAt: dueAtMs,
      closureReason: null,
    }
  }

  if (!input.allowLate || lateSubmissionDeadlineMs === null || now >= lateSubmissionDeadlineMs) {
    return {
      phase: "closed",
      dueAtMs,
      lateSubmissionDeadlineMs,
      hasDeadline: true,
      isOverdue: true,
      isLateWindowOpen: false,
      isClosed: true,
      acceptsSubmissions: false,
      nextTransitionAt: null,
      closureReason: input.allowLate && lateSubmissionDeadlineMs !== null ? "late_submission_deadline" : "due_at",
    }
  }

  return {
    phase: "late_window",
    dueAtMs,
    lateSubmissionDeadlineMs,
    hasDeadline: true,
    isOverdue: true,
    isLateWindowOpen: true,
    isClosed: false,
    acceptsSubmissions: true,
    nextTransitionAt: lateSubmissionDeadlineMs,
    closureReason: null,
  }
}

export function toIsoDateTimeLocal(value: string): string | null {
  if (!value) return null
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return null
  return timestamp.toISOString()
}
