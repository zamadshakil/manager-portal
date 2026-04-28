/**
 * Permissive Database type for the Supabase typed client. We don't generate
 * full DB types in this project — instead we let inserts/updates accept any
 * shape and rely on Zod (in Server Actions) and the SQL schema (in migrations)
 * for validation. We then cast SELECTs to our domain types from `lib/types.ts`.
 *
 * Row is intentionally `any` so `as Submission` etc. work without contortions.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Tbl = {
  Row: any
  Insert: any
  Update: any
  Relationships: []
}

export interface Database {
  public: {
    Tables: {
      profiles: Tbl
      teams: Tbl
      submissions: Tbl
      validation_rules: Tbl
      validation_runs: Tbl
      announcements: Tbl
      materials: Tbl
      activity_log: Tbl
      report_snapshots: Tbl
      [k: string]: Tbl
    }
    Views: Record<string, never>
    Functions: {
      assign_task_to_team: {
        Args: {
          p_task_id: string
          p_team_id: string
        }
        Returns: number
      }
    }
    Enums: {
      user_role: "main_admin" | "manager" | "member"
      submission_status:
        | "queued"
        | "parsing"
        | "validating"
        | "passed"
        | "failed"
        | "needs_review"
      announcement_priority: "low" | "normal" | "high" | "urgent"
      report_period: "day" | "month" | "year"
    }
    CompositeTypes: Record<string, never>
  }
}
