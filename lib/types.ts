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
  created_at: string
  updated_at: string
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
  require_late_reason: boolean
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

export interface ValidationRule {
  id: string
  team_id: string
  rule_name: string
  description: string | null
  prompt_template: string
  threshold: number
  weight: number
  enabled: boolean
  created_by: string | null
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
  created_at: string
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
  "image/png",
  "image/jpeg",
] as const

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB
