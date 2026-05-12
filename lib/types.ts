export type UserRole = "main_admin" | "manager" | "member"

export type SubmissionStatus =
  | "queued"
  | "parsing"
  | "validating"
  | "passed"
  | "failed"
  | "needs_review"
  | "late_submitted"
  | "missed"

export type TaskAssignmentStatus = "assigned" | "submitted" | "late_submitted" | "missed"

export type AnnouncementPriority = "low" | "normal" | "high" | "urgent"

export type ReportPeriod = "day" | "month" | "year"

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  team_id: string | null
  manager_id: string | null
  must_reset: boolean
  avatar_url: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  /** Admin-initiated email change pending the user's confirmation (sent to
   *  the new address). When non-null, the UI shows "Email under verification"
   *  and the auth email has NOT yet changed. */
  pending_email?: string | null
  email_change_token_expires_at?: string | null
  email_change_requested_at?: string | null
  email_change_requested_by?: string | null
}

export interface Team {
  id: string
  name: string
  description: string | null
  manager_id: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Submission {
  id: string
  uploader_id: string
  team_id: string
  title: string
  blob_url: string
  blob_pathname: string | null
  mime_type: string
  size_bytes: number | null
  status: SubmissionStatus
  score: number | null
  summary: string | null
  extracted_text: string | null
  flags: SubmissionFlag[]
  metadata: Record<string, unknown>
  task_id: string | null
  task_assignment_id: string | null
  late_reason: string | null
  is_late: boolean
  submitted_at: string | null
  /**
   * Number of times the AI pipeline has been invoked for this submission.
   * Incremented by `processSubmission` on entry; consulted by the cron
   * safety net to cap auto-retries.
   */
  attempts: number
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  team_id: string
  manager_id: string
  title: string
  description: string | null
  instructions: string | null
  due_at: string | null
  allow_late: boolean
  late_submission_deadline: string | null
  require_late_reason: boolean
  /** Explicit list of validation rule IDs to run for this task's submissions.
   *  null  → run all enabled team rules (default / backward-compatible)
   *  []    → skip all standing rules (only task instructions run, if any)
   *  [id…] → run only these specific rules
   */
  rule_ids: string[] | null
  created_at: string
  updated_at: string
}

export interface TaskAssignment {
  id: string
  task_id: string
  assignee_id: string
  status: TaskAssignmentStatus
  submission_id: string | null
  late_reason: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
}

export interface SubmissionFlag {
  rule_id?: string
  rule_name?: string
  severity: "info" | "warn" | "fail"
  message: string
}

export type ValidationRuleType = "scored" | "binary"

/**
 * Outcome of the AI validation independent of submission status (which can be
 * `late_submitted` or `missed` for orthogonal reasons). Stored under
 * `submissions.metadata.validation_outcome` so managers can see the AI verdict
 * even when the headline status reflects timeliness.
 */
export type ValidationOutcome = "passed" | "failed" | "needs_review" | null

/**
 * Reason a submission landed in `needs_review`. Stored under
 * `submissions.metadata.review_reason` so the UI can show specific copy
 * instead of the generic "needs review" badge.
 */
export type ReviewReason =
  | "no_text"
  | "no_rules"
  | "budget_exhausted"
  | "llm_quota"
  | "partial_validation"
  | "warnings_present"
  | "low_score"
  | "ocr_failed"
  | "safety_filter"

export interface ValidationRule {
  id: string
  team_id: string
  rule_name: string
  description: string | null
  prompt_template: string
  /**
   * Determines how the LLM evaluates the rule:
   *   - 'scored': 0-100 rubric (default, suits substantive quality rules)
   *   - 'binary': yes/no with evidence; score is 100 on pass, 0 on fail
   */
  rule_type: ValidationRuleType
  threshold: number
  weight: number
  enabled: boolean
  created_by: string | null
  creator_role?: UserRole | null
  created_at: string
  updated_at: string
}

export interface ValidationRun {
  id: string
  submission_id: string
  rule_id: string | null
  model: string
  prompt_version: string | null
  raw_output: Record<string, unknown>
  pass: boolean | null
  score: number | null
  reasons: string[]
  flags: SubmissionFlag[]
  latency_ms: number | null
  tokens_in: number | null
  tokens_out: number | null
  created_at: string
}

export interface Announcement {
  id: string
  author_id: string
  team_id: string | null
  title: string
  body: string
  priority: AnnouncementPriority
  expires_at: string | null
  created_at: string
  // Join metadata
  teams?: { name: string } | null
}

export interface Material {
  id: string
  author_id: string
  team_id: string | null
  title: string
  description: string | null
  blob_url: string
  blob_pathname: string | null
  file_type: string | null
  size_bytes: number | null
  tags: string[]
  expires_at: string | null
  created_at: string
  archive_status: "pending" | "processing" | "done" | "failed" | "na" | null
  // Join metadata
  teams?: { name: string } | null
}

export interface ActivityLogEntry {
  id: string
  actor_id: string | null
  team_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  metadata: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface ReportSnapshot {
  id: string
  team_id: string | null
  period: ReportPeriod
  period_start: string
  metrics: ReportMetrics
  created_at: string
}

export interface ReportMetrics {
  submissions_total: number
  submissions_passed: number
  submissions_failed: number
  submissions_needs_review: number
  avg_score: number
  avg_latency_ms: number
  unique_uploaders: number
}

export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/markdown",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
] as const

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB
export const MAX_ARCHIVE_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB
export const MAX_MATERIAL_UPLOAD_SIZE_BYTES = MAX_ARCHIVE_SIZE_BYTES

export const ARCHIVE_MIME_TYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
] as const

const ACCEPTED_MIME_TYPE_SET = new Set<string>(ACCEPTED_MIME_TYPES as readonly string[])

export const MATERIAL_EXTENSION_TO_MIME = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  md: "text/markdown",
  zip: "application/zip",
  rar: "application/vnd.rar",
} as const

export function inferMaterialMimeTypeFromFileName(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.trim().toLowerCase() ?? ""
  return MATERIAL_EXTENSION_TO_MIME[ext as keyof typeof MATERIAL_EXTENSION_TO_MIME] ?? null
}

export function isAcceptedMaterialMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && ACCEPTED_MIME_TYPE_SET.has(mimeType)
}

export function normalizeMaterialMimeType(
  fileName: string,
  mimeType: string | null | undefined,
): string | null {
  const normalized = mimeType?.trim().toLowerCase() ?? ""
  if (isAcceptedMaterialMimeType(normalized)) return normalized

  const inferred = inferMaterialMimeTypeFromFileName(fileName)
  if (!inferred) return null

  if (!normalized || normalized === "application/octet-stream") {
    return inferred
  }

  return isAcceptedMaterialMimeType(inferred) ? inferred : null
}

// ---------------------------------------------------------------------------
// AI Credit System
// ---------------------------------------------------------------------------

export type AiCreditPeriod = "daily" | "weekly" | "monthly"

export interface AiCreditLimit {
  id: string
  user_id: string
  monthly_limit: number        // messages allowed per period (field named monthly_limit in DB)
  used_this_period: number
  period_type: AiCreditPeriod
  period_start: string         // ISO date string
  period_end: string           // ISO date string
  is_unlimited: boolean
  notes: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  // Joined from profiles (populated by listAiCreditLimits)
  user_email?: string
  user_full_name?: string | null
  user_role?: UserRole
  user_team_name?: string | null
  user_team_id?: string | null
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

export type ConversationType = "dm" | "group"
export type MessageType = "text" | "image" | "file" | "audio" | "video"
export type MemberRole = "admin" | "member"

export interface Conversation {
  id: string
  type: ConversationType
  name: string | null
  created_by: string
  avatar_url: string | null
  created_at: string
  updated_at: string
  // joined via conversation_members
  members?: ConversationMember[]
  removed_members?: ConversationMember[]
  unread_count?: number
  last_message?: Message | null
}

export interface ConversationMember {
  conversation_id: string
  user_id: string
  role: MemberRole
  joined_at: string
  last_read_at: string
  removed_at?: string | null
  removed_by?: string | null
  // joined from profiles
  profile?: {
    id: string
    full_name: string | null
    email: string
    avatar_url: string | null
    deleted_at?: string | null
  }
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  type: MessageType
  media_url: string | null
  media_metadata: Record<string, unknown> | null
  reply_to_id: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  // client-side only
  status?: "sending" | "sent" | "failed"
  // joined from profiles
  sender?: {
    id: string
    full_name: string | null
    email: string
    avatar_url: string | null
  }
  reactions?: MessageReaction[]
  reply_to?: Message | null
}

export interface MessageReaction {
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface TypingUser {
  userId: string
  name: string
}

export interface AiUsageLogEntry {
  id: string
  user_id: string
  thread_id: string | null
  model: string | null
  tokens_in: number | null
  tokens_out: number | null
  period_type: AiCreditPeriod | null
  event_type: string | null
  status: string | null
  credits_deducted: number | null
  created_at: string
  // Joined from profiles (populated by getUserUsageHistory)
  user_email?: string
  user_full_name?: string | null
}

