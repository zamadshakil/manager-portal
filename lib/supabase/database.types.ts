export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          role: "main_admin" | "manager" | "member"
          team_id: string | null
          manager_id: string | null
          must_reset: boolean
          avatar_url: string | null
          deleted_at: string | null
          pending_email: string | null
          email_change_token_hash: string | null
          email_change_token_expires_at: string | null
          email_change_requested_at: string | null
          email_change_requested_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          role?: "main_admin" | "manager" | "member"
          team_id?: string | null
          manager_id?: string | null
          must_reset?: boolean
          avatar_url?: string | null
          deleted_at?: string | null
          pending_email?: string | null
          email_change_token_hash?: string | null
          email_change_token_expires_at?: string | null
          email_change_requested_at?: string | null
          email_change_requested_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          role?: "main_admin" | "manager" | "member"
          team_id?: string | null
          manager_id?: string | null
          must_reset?: boolean
          avatar_url?: string | null
          deleted_at?: string | null
          pending_email?: string | null
          email_change_token_hash?: string | null
          email_change_token_expires_at?: string | null
          email_change_requested_at?: string | null
          email_change_requested_by?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "profiles_team_id_fkey"; columns: ["team_id"]; referencedRelation: "teams"; referencedColumns: ["id"] }
        ]
      }
      teams: {
        Row: {
          id: string
          name: string
          description: string | null
          manager_id: string | null
          settings: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          manager_id?: string | null
          settings?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          manager_id?: string | null
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      submissions: {
        Row: {
          id: string
          uploader_id: string
          team_id: string
          title: string
          blob_url: string
          blob_pathname: string | null
          mime_type: string
          size_bytes: number | null
          status: "queued" | "parsing" | "validating" | "passed" | "failed" | "needs_review" | "late_submitted" | "missed"
          score: number | null
          summary: string | null
          extracted_text: string | null
          flags: Json
          metadata: Json
          task_id: string | null
          task_assignment_id: string | null
          late_reason: string | null
          is_late: boolean
          submitted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          uploader_id: string
          team_id: string
          title: string
          blob_url: string
          blob_pathname?: string | null
          mime_type: string
          size_bytes?: number | null
          status?: "queued" | "parsing" | "validating" | "passed" | "failed" | "needs_review" | "late_submitted" | "missed"
          score?: number | null
          summary?: string | null
          extracted_text?: string | null
          flags?: Json
          metadata?: Json
          task_id?: string | null
          task_assignment_id?: string | null
          late_reason?: string | null
          is_late?: boolean
          submitted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: "queued" | "parsing" | "validating" | "passed" | "failed" | "needs_review" | "late_submitted" | "missed"
          score?: number | null
          summary?: string | null
          extracted_text?: string | null
          flags?: Json
          metadata?: Json
          late_reason?: string | null
          is_late?: boolean
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "submissions_uploader_id_fkey"; columns: ["uploader_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "submissions_team_id_fkey"; columns: ["team_id"]; referencedRelation: "teams"; referencedColumns: ["id"] },
          { foreignKeyName: "submissions_task_id_fkey"; columns: ["task_id"]; referencedRelation: "tasks"; referencedColumns: ["id"] }
        ]
      }
      tasks: {
        Row: {
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
          rule_ids: string[] | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          team_id: string
          manager_id: string
          title: string
          description?: string | null
          instructions?: string | null
          due_at?: string | null
          allow_late?: boolean
          late_submission_deadline?: string | null
          require_late_reason?: boolean
          rule_ids?: string[] | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          instructions?: string | null
          due_at?: string | null
          allow_late?: boolean
          late_submission_deadline?: string | null
          require_late_reason?: boolean
          rule_ids?: string[] | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "tasks_team_id_fkey"; columns: ["team_id"]; referencedRelation: "teams"; referencedColumns: ["id"] }
        ]
      }
      task_assignments: {
        Row: {
          id: string
          task_id: string
          assignee_id: string
          status: "assigned" | "submitted" | "late_submitted" | "missed"
          submission_id: string | null
          late_reason: string | null
          submitted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          task_id: string
          assignee_id: string
          status?: "assigned" | "submitted" | "late_submitted" | "missed"
          submission_id?: string | null
          late_reason?: string | null
          submitted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          status?: "assigned" | "submitted" | "late_submitted" | "missed"
          submission_id?: string | null
          late_reason?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "task_assignments_task_id_fkey"; columns: ["task_id"]; referencedRelation: "tasks"; referencedColumns: ["id"] },
          { foreignKeyName: "task_assignments_assignee_id_fkey"; columns: ["assignee_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      validation_rules: {
        Row: {
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
        Insert: {
          id?: string
          team_id: string
          rule_name: string
          description?: string | null
          prompt_template: string
          threshold?: number
          weight?: number
          enabled?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          rule_name?: string
          description?: string | null
          prompt_template?: string
          threshold?: number
          weight?: number
          enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "validation_rules_team_id_fkey"; columns: ["team_id"]; referencedRelation: "teams"; referencedColumns: ["id"] }
        ]
      }
      validation_runs: {
        Row: {
          id: string
          submission_id: string
          rule_id: string | null
          model: string
          prompt_version: string | null
          raw_output: Json
          pass: boolean | null
          score: number | null
          reasons: string[]
          flags: Json
          latency_ms: number | null
          tokens_in: number | null
          tokens_out: number | null
          created_at: string
        }
        Insert: {
          id?: string
          submission_id: string
          rule_id?: string | null
          model: string
          prompt_version?: string | null
          raw_output?: Json
          pass?: boolean | null
          score?: number | null
          reasons?: string[]
          flags?: Json
          latency_ms?: number | null
          tokens_in?: number | null
          tokens_out?: number | null
          created_at?: string
        }
        Update: { [_ in never]: never }
        Relationships: [
          { foreignKeyName: "validation_runs_submission_id_fkey"; columns: ["submission_id"]; referencedRelation: "submissions"; referencedColumns: ["id"] }
        ]
      }
      announcements: {
        Row: {
          id: string
          author_id: string
          team_id: string | null
          title: string
          body: string
          priority: "low" | "normal" | "high" | "urgent"
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          author_id: string
          team_id?: string | null
          title: string
          body: string
          priority?: "low" | "normal" | "high" | "urgent"
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          body?: string
          priority?: "low" | "normal" | "high" | "urgent"
          expires_at?: string | null
        }
        Relationships: [
          { foreignKeyName: "announcements_author_id_fkey"; columns: ["author_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "announcements_team_id_fkey"; columns: ["team_id"]; referencedRelation: "teams"; referencedColumns: ["id"] }
        ]
      }
      materials: {
        Row: {
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
        }
        Insert: {
          id?: string
          author_id: string
          team_id?: string | null
          title: string
          description?: string | null
          blob_url: string
          blob_pathname?: string | null
          file_type?: string | null
          size_bytes?: number | null
          tags?: string[]
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          tags?: string[]
          expires_at?: string | null
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          id: string
          actor_id: string | null
          team_id: string | null
          action: string
          entity_type: string
          entity_id: string | null
          metadata: Json
          ip_address: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: string
          actor_id?: string | null
          team_id?: string | null
          action: string
          entity_type: string
          entity_id?: string | null
          metadata?: Json
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: { [_ in never]: never }
        Relationships: []
      }
      report_snapshots: {
        Row: {
          id: string
          team_id: string | null
          period: "day" | "month" | "year"
          period_start: string
          metrics: Json
          created_at: string
        }
        Insert: {
          id?: string
          team_id?: string | null
          period: "day" | "month" | "year"
          period_start: string
          metrics: Json
          created_at?: string
        }
        Update: { metrics?: Json }
        Relationships: []
      }
      ai_credit_limits: {
        Row: {
          id: string
          user_id: string
          monthly_limit: number
          used_this_period: number
          period_type: "daily" | "weekly" | "monthly"
          period_start: string
          period_end: string
          is_unlimited: boolean
          notes: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          monthly_limit?: number
          used_this_period?: number
          period_type?: "daily" | "weekly" | "monthly"
          period_start?: string
          period_end?: string
          is_unlimited?: boolean
          notes?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          monthly_limit?: number
          used_this_period?: number
          period_type?: "daily" | "weekly" | "monthly"
          period_start?: string
          period_end?: string
          is_unlimited?: boolean
          notes?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "ai_credit_limits_user_id_fkey"; columns: ["user_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      ai_usage_log: {
        Row: {
          id: string
          user_id: string
          thread_id: string | null
          event_type: string | null
          model: string | null
          status: string | null
          credits_deducted: number | null
          period_type: "daily" | "weekly" | "monthly" | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          thread_id?: string | null
          event_type?: string | null
          model?: string | null
          status?: string | null
          credits_deducted?: number | null
          period_type?: "daily" | "weekly" | "monthly" | null
          created_at?: string
        }
        Update: { [_ in never]: never }
        Relationships: []
      }
      chat_threads: {
        Row: {
          id: string
          user_id: string
          title: string | null
          updated_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          title?: string | null
          updated_at?: string
          created_at?: string
        }
        Update: {
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "chat_threads_user_id_fkey"; columns: ["user_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      chat_messages: {
        Row: {
          id: string
          thread_id: string
          role: "user" | "assistant" | "tool"
          content: string
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          thread_id: string
          role: "user" | "assistant" | "tool"
          content: string
          metadata?: Json | null
          created_at?: string
        }
        Update: { [_ in never]: never }
        Relationships: [
          { foreignKeyName: "chat_messages_thread_id_fkey"; columns: ["thread_id"]; referencedRelation: "chat_threads"; referencedColumns: ["id"] }
        ]
      }
      chat_documents: {
        Row: {
          id: string
          user_id: string
          thread_id: string | null
          file_name: string
          file_url: string
          file_type: string | null
          rag_status: "pending" | "indexed" | "failed" | "skipped" | "processing" | "completed"
          text_excerpt: string | null
          indexed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          thread_id?: string | null
          file_name: string
          file_url: string
          file_type?: string | null
          rag_status?: "pending" | "indexed" | "failed" | "skipped" | "processing" | "completed"
          text_excerpt?: string | null
          indexed_at?: string | null
          created_at?: string
        }
        Update: {
          rag_status?: "pending" | "indexed" | "failed" | "skipped" | "processing" | "completed"
          text_excerpt?: string | null
          indexed_at?: string | null
        }
        Relationships: []
      }
      rag_documents: {
        Row: {
          id: string
          source_type: string
          source_id: string
          chunk_index: number
          team_id: string | null
          owner_id: string | null
          title: string | null
          content: string
          embedding: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          source_type: string
          source_id: string
          chunk_index: number
          team_id?: string | null
          owner_id?: string | null
          title?: string | null
          content: string
          embedding: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          content?: string
          embedding?: string
          metadata?: Json
        }
        Relationships: []
      }
      conversations: {
        Row: {
          id: string
          type: "dm" | "group"
          name: string | null
          created_by: string
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          type: "dm" | "group"
          name?: string | null
          created_by: string
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string | null
          avatar_url?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "conversations_created_by_fkey"; columns: ["created_by"]; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          user_id: string
          role: "admin" | "member"
          joined_at: string
          last_read_at: string
        }
        Insert: {
          conversation_id: string
          user_id: string
          role?: "admin" | "member"
          joined_at?: string
          last_read_at?: string
        }
        Update: {
          role?: "admin" | "member"
          last_read_at?: string
        }
        Relationships: [
          { foreignKeyName: "conversation_members_conversation_id_fkey"; columns: ["conversation_id"]; referencedRelation: "conversations"; referencedColumns: ["id"] },
          { foreignKeyName: "conversation_members_user_id_fkey"; columns: ["user_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          content: string | null
          type: "text" | "image" | "file" | "audio" | "video"
          media_url: string | null
          media_metadata: Json | null
          reply_to_id: string | null
          edited_at: string | null
          deleted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id: string
          content?: string | null
          type?: "text" | "image" | "file" | "audio" | "video"
          media_url?: string | null
          media_metadata?: Json | null
          reply_to_id?: string | null
          edited_at?: string | null
          deleted_at?: string | null
          created_at?: string
        }
        Update: {
          content?: string | null
          edited_at?: string | null
          deleted_at?: string | null
        }
        Relationships: [
          { foreignKeyName: "messages_conversation_id_fkey"; columns: ["conversation_id"]; referencedRelation: "conversations"; referencedColumns: ["id"] },
          { foreignKeyName: "messages_sender_id_fkey"; columns: ["sender_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      message_reactions: {
        Row: {
          message_id: string
          user_id: string
          emoji: string
          conversation_id: string
          created_at: string
        }
        Insert: {
          message_id: string
          user_id: string
          emoji: string
          conversation_id?: string
          created_at?: string
        }
        Update: { [_ in never]: never }
        Relationships: [
          { foreignKeyName: "message_reactions_message_id_fkey"; columns: ["message_id"]; referencedRelation: "messages"; referencedColumns: ["id"] },
          { foreignKeyName: "message_reactions_user_id_fkey"; columns: ["user_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      permission_definitions: {
        Row: {
          key: string
          module: string
          action: string
          description: string
          is_admin_only: boolean
          created_at: string
        }
        Insert: {
          key: string
          module: string
          action: string
          description?: string
          is_admin_only?: boolean
          created_at?: string
        }
        Update: {
          key?: string
          module?: string
          action?: string
          description?: string
          is_admin_only?: boolean
        }
        Relationships: []
      }
      role_permission_defaults: {
        Row: {
          role: string
          capability_key: string
          created_at: string
        }
        Insert: {
          role: string
          capability_key: string
          created_at?: string
        }
        Update: {
          role?: string
          capability_key?: string
        }
        Relationships: [
          { foreignKeyName: "role_permission_defaults_capability_key_fkey"; columns: ["capability_key"]; referencedRelation: "permission_definitions"; referencedColumns: ["key"] }
        ]
      }
      user_permission_overrides: {
        Row: {
          id: string
          user_id: string
          capability_key: string
          effect: "allow" | "deny"
          granted_by: string | null
          reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          capability_key: string
          effect: "allow" | "deny"
          granted_by?: string | null
          reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          effect?: "allow" | "deny"
          granted_by?: string | null
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "user_permission_overrides_user_id_fkey"; columns: ["user_id"]; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "user_permission_overrides_capability_key_fkey"; columns: ["capability_key"]; referencedRelation: "permission_definitions"; referencedColumns: ["key"] },
          { foreignKeyName: "user_permission_overrides_granted_by_fkey"; columns: ["granted_by"]; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      system_request_logs: {
        Row: {
          id: string
          trace_id: string | null
          method: string
          path: string
          status_code: number | null
          duration_ms: number | null
          user_id: string | null
          ip_address: string | null
          user_agent: string | null
          error_message: string | null
          request_size: number | null
          response_size: number | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          trace_id?: string | null
          method: string
          path: string
          status_code?: number | null
          duration_ms?: number | null
          user_id?: string | null
          ip_address?: string | null
          user_agent?: string | null
          error_message?: string | null
          request_size?: number | null
          response_size?: number | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          trace_id?: string | null
          method?: string
          path?: string
          status_code?: number | null
          duration_ms?: number | null
          user_id?: string | null
          ip_address?: string | null
          user_agent?: string | null
          error_message?: string | null
          request_size?: number | null
          response_size?: number | null
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      system_error_logs: {
        Row: {
          id: string
          trace_id: string | null
          severity: "error" | "warning" | "info"
          source: "api" | "server" | "cron" | "client" | "pipeline" | "ai"
          error_message: string
          error_code: string | null
          stack_trace: string | null
          path: string | null
          method: string | null
          user_id: string | null
          ip_address: string | null
          sentry_event_id: string | null
          context: Json
          resolved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          trace_id?: string | null
          severity?: "error" | "warning" | "info"
          source?: "api" | "server" | "cron" | "client" | "pipeline" | "ai"
          error_message: string
          error_code?: string | null
          stack_trace?: string | null
          path?: string | null
          method?: string | null
          user_id?: string | null
          ip_address?: string | null
          sentry_event_id?: string | null
          context?: Json
          resolved_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          trace_id?: string | null
          severity?: "error" | "warning" | "info"
          source?: "api" | "server" | "cron" | "client" | "pipeline" | "ai"
          error_message?: string
          error_code?: string | null
          stack_trace?: string | null
          path?: string | null
          method?: string | null
          user_id?: string | null
          ip_address?: string | null
          sentry_event_id?: string | null
          context?: Json
          resolved_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      maybe_reset_period: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      increment_ai_usage: {
        Args: { p_user_id: string; p_credits: number; p_event_type: string; p_model: string }
        Returns: undefined
      }
      find_dm_conversation: {
        Args: { user_a: string; user_b: string }
        Returns: { id: string; type: string; name: string | null; created_by: string; avatar_url: string | null; created_at: string; updated_at: string } | null
      }
      find_or_create_dm: {
        Args: { user_a: string; user_b: string }
        Returns: {
          id: string
          type: string
          name: string | null
          created_by: string
          avatar_url: string | null
          created_at: string
          updated_at: string
          was_created: boolean
        }[]
      }
      get_conversation_previews: {
        Args: { p_user_id: string }
        Returns: {
          id: string
          type: string
          name: string | null
          created_by: string
          avatar_url: string | null
          created_at: string
          updated_at: string
          members: Json
          last_message: Json | null
          unread_count: number
        }[]
      }
      toggle_reaction: {
        Args: { p_message_id: string; p_user_id: string; p_emoji: string }
        Returns: string
      }
      search_rag_vector: {
        Args: {
          query_embedding: string
          match_limit: number
          filter_owner_id: string
          filter_team_id: string | null
          filter_role: string
          filter_source_type: string | null
          filter_source_id: string | null
        }
        Returns: { id: string; source_type: string; source_id: string; title: string | null; snippet: string; score: number; metadata: Json }[]
      }
      search_rag_bm25: {
        Args: {
          query_text: string
          match_limit: number
          filter_owner_id: string
          filter_team_id: string | null
          filter_role: string
          filter_source_type: string | null
          filter_source_id: string | null
        }
        Returns: { id: string; source_type: string; source_id: string; title: string | null; snippet: string; score: number; metadata: Json }[]
      }
      insert_rag_chunks: {
        Args: { rows: Json }
        Returns: undefined
      }
      delete_rag_chunks: {
        Args: { p_source_type: string; p_source_id: string }
        Returns: undefined
      }
      list_departments_with_stats: {
        Args: Record<string, never>
        Returns: {
          id: string
          name: string
          description: string | null
          manager_id: string | null
          manager_full_name: string | null
          manager_email: string | null
          member_count: number
          created_at: string
          updated_at: string
        }[]
      }
      assign_task_to_team: {
        Args: { p_task_id: string; p_team_id: string }
        Returns: number
      }
      invalidate_user_sessions: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      get_department_credit_summary: {
        Args: Record<string, never>
        Returns: {
          team_id: string
          team_name: string
          total_credits: number
          used_credits: number
          remaining_credits: number
          user_count: number
        }[]
      }
      get_top_credit_consumers: {
        Args: { p_limit: number }
        Returns: {
          user_id: string
          full_name: string | null
          email: string
          team_name: string | null
          total_credits: number
        }[]
      }
      get_latest_thread_messages: {
        Args: { thread_ids: string[] }
        Returns: {
          thread_id: string
          role: string
          content: string
          created_at: string
        }[]
      }
    }
    Enums: {
      user_role: "main_admin" | "manager" | "member"
      submission_status: "queued" | "parsing" | "validating" | "passed" | "failed" | "needs_review" | "late_submitted" | "missed"
      task_assignment_status: "assigned" | "submitted" | "late_submitted" | "missed"
      announcement_priority: "low" | "normal" | "high" | "urgent"
      ai_credit_period: "daily" | "weekly" | "monthly"
      conversation_type: "dm" | "group"
      member_role: "admin" | "member"
      message_type: "text" | "image" | "file" | "audio" | "video"
      rag_status: "pending" | "indexed" | "failed" | "skipped" | "processing" | "completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
