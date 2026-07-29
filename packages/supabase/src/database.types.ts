// Generated from Supabase migrations. Refresh with `pnpm db:types`.
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
      attachments: {
        Row: {
          content_type: string | null
          created_at: string
          deleted_at: string | null
          file_name: string
          id: string
          issue_id: string
          message_id: string | null
          size_bytes: number | null
          storage_deleted_at: string | null
          storage_path: string
          upload_completed_at: string | null
        }
        Insert: {
          content_type?: string | null
          created_at?: string
          deleted_at?: string | null
          file_name: string
          id?: string
          issue_id: string
          message_id?: string | null
          size_bytes?: number | null
          storage_deleted_at?: string | null
          storage_path: string
          upload_completed_at?: string | null
        }
        Update: {
          content_type?: string | null
          created_at?: string
          deleted_at?: string | null
          file_name?: string
          id?: string
          issue_id?: string
          message_id?: string | null
          size_bytes?: number | null
          storage_deleted_at?: string | null
          storage_path?: string
          upload_completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      github_integration_states: {
        Row: {
          created_at: string
          expires_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      github_integrations: {
        Row: {
          connected_at: string | null
          created_at: string
          id: string
          installation_id: string | null
          setup_action: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_at?: string | null
          created_at?: string
          id?: string
          installation_id?: string | null
          setup_action?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_at?: string | null
          created_at?: string
          id?: string
          installation_id?: string | null
          setup_action?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      issue_automatic_pr_requests: {
        Row: {
          create_pr_automatically_snapshot: boolean
          created_at: string
          error: string | null
          id: string
          issue_id: string
          requested_by_message_id: string | null
          run_id: string
          status: string
          updated_at: string
        }
        Insert: {
          create_pr_automatically_snapshot?: boolean
          created_at?: string
          error?: string | null
          id?: string
          issue_id: string
          requested_by_message_id?: string | null
          run_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          create_pr_automatically_snapshot?: boolean
          created_at?: string
          error?: string | null
          id?: string
          issue_id?: string
          requested_by_message_id?: string | null
          run_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_automatic_pr_requests_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_automatic_pr_requests_requested_by_message_id_fkey"
            columns: ["requested_by_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_events: {
        Row: {
          created_at: string
          id: string
          issue_id: string
          payload: Json
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          issue_id: string
          payload?: Json
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          issue_id?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_events_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_pull_requests: {
        Row: {
          created_at: string
          id: string
          issue_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          issue_id: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          issue_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_pull_requests_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issue_relations: {
        Row: {
          created_at: string
          id: string
          source_issue_id: string
          target_issue_id: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_issue_id: string
          target_issue_id: string
          type?: string
        }
        Update: {
          created_at?: string
          id?: string
          source_issue_id?: string
          target_issue_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "issue_relations_source_issue_id_fkey"
            columns: ["source_issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issue_relations_target_issue_id_fkey"
            columns: ["target_issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      issues: {
        Row: {
          active_run_id: string | null
          active_worker_id: string | null
          agent_provider: string
          create_pr_automatically: boolean
          created_at: string
          has_unpublished_agent_changes: boolean
          id: string
          issue_model: string | null
          number: number
          pr_url: string | null
          priority: Database["public"]["Enums"]["issue_priority"]
          project_id: string
          prompt: string | null
          run_error: string | null
          run_finished_at: string | null
          run_started_at: string | null
          session_id: string | null
          status: string
          title: string | null
          type: string
          updated_at: string
          usage_limit_reset_at: string | null
        }
        Insert: {
          active_run_id?: string | null
          active_worker_id?: string | null
          agent_provider?: string
          create_pr_automatically?: boolean
          created_at?: string
          has_unpublished_agent_changes?: boolean
          id?: string
          issue_model?: string | null
          number: number
          pr_url?: string | null
          priority?: Database["public"]["Enums"]["issue_priority"]
          project_id: string
          prompt?: string | null
          run_error?: string | null
          run_finished_at?: string | null
          run_started_at?: string | null
          session_id?: string | null
          status?: string
          title?: string | null
          type?: string
          updated_at?: string
          usage_limit_reset_at?: string | null
        }
        Update: {
          active_run_id?: string | null
          active_worker_id?: string | null
          agent_provider?: string
          create_pr_automatically?: boolean
          created_at?: string
          has_unpublished_agent_changes?: boolean
          id?: string
          issue_model?: string | null
          number?: number
          pr_url?: string | null
          priority?: Database["public"]["Enums"]["issue_priority"]
          project_id?: string
          prompt?: string | null
          run_error?: string | null
          run_finished_at?: string | null
          run_started_at?: string | null
          session_id?: string | null
          status?: string
          title?: string | null
          type?: string
          updated_at?: string
          usage_limit_reset_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "issues_active_worker_id_fkey"
            columns: ["active_worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          author_type: string
          consumed_at: string | null
          consumed_by_run_id: string | null
          content: string | null
          created_at: string
          event_id: string | null
          event_seq: number | null
          event_status: string | null
          event_ts: string | null
          event_type: string | null
          generated_action: string | null
          github_comment_id: number | null
          github_review_id: number | null
          id: string
          issue_id: string
          kind: string
          payload: Json | null
          role: string
          run_id: string | null
          seq: number
          status: string
          tool_call_id: string | null
          updated_at: string
        }
        Insert: {
          author_type?: string
          consumed_at?: string | null
          consumed_by_run_id?: string | null
          content?: string | null
          created_at?: string
          event_id?: string | null
          event_seq?: number | null
          event_status?: string | null
          event_ts?: string | null
          event_type?: string | null
          generated_action?: string | null
          github_comment_id?: number | null
          github_review_id?: number | null
          id?: string
          issue_id: string
          kind?: string
          payload?: Json | null
          role: string
          run_id?: string | null
          seq?: number
          status?: string
          tool_call_id?: string | null
          updated_at?: string
        }
        Update: {
          author_type?: string
          consumed_at?: string | null
          consumed_by_run_id?: string | null
          content?: string | null
          created_at?: string
          event_id?: string | null
          event_seq?: number | null
          event_status?: string | null
          event_ts?: string | null
          event_type?: string | null
          generated_action?: string | null
          github_comment_id?: number | null
          github_review_id?: number | null
          id?: string
          issue_id?: string
          kind?: string
          payload?: Json | null
          role?: string
          run_id?: string | null
          seq?: number
          status?: string
          tool_call_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_issue_id_fkey"
            columns: ["issue_id"]
            isOneToOne: false
            referencedRelation: "issues"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          auto_respond_to_reviews: boolean
          created_at: string
          id: string
          key: string
          name: string
          next_issue_number: number
          repo: string
          setup_script: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_respond_to_reviews?: boolean
          created_at?: string
          id?: string
          key: string
          name: string
          next_issue_number?: number
          repo: string
          setup_script?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_respond_to_reviews?: boolean
          created_at?: string
          id?: string
          key?: string
          name?: string
          next_issue_number?: number
          repo?: string
          setup_script?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          default_agent_provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_agent_provider?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_agent_provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      worker_enrollment_codes: {
        Row: {
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          user_id: string
        }
        Update: {
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: []
      }
      worker_enrollment_exchange_failures: {
        Row: {
          failed_count: number
          locked_until: string | null
          rate_limit_key: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          failed_count?: number
          locked_until?: string | null
          rate_limit_key: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          failed_count?: number
          locked_until?: string | null
          rate_limit_key?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      workers: {
        Row: {
          arch: string | null
          banned_at: string | null
          configured_capacity: number
          created_at: string
          credential_expires_at: string | null
          credential_hash: string
          display_name: string
          gentic_version: string | null
          id: string
          last_seen_at: string | null
          normalized_name: string | null
          os: string | null
          process_started_at: string | null
          provider_capabilities: Json
          setup_state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          arch?: string | null
          banned_at?: string | null
          configured_capacity?: number
          created_at?: string
          credential_expires_at?: string | null
          credential_hash: string
          display_name: string
          gentic_version?: string | null
          id?: string
          last_seen_at?: string | null
          normalized_name?: string | null
          os?: string | null
          process_started_at?: string | null
          provider_capabilities?: Json
          setup_state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          arch?: string | null
          banned_at?: string | null
          configured_capacity?: number
          created_at?: string
          credential_expires_at?: string | null
          credential_hash?: string
          display_name?: string
          gentic_version?: string | null
          id?: string
          last_seen_at?: string | null
          normalized_name?: string | null
          os?: string | null
          process_started_at?: string | null
          provider_capabilities?: Json
          setup_state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_worker_enrollment_code: {
        Args: {
          p_arch: string
          p_code_hash: string
          p_configured_capacity: number
          p_credential_hash: string
          p_display_name: string
          p_gentic_version: string
          p_now?: string
          p_os: string
          p_process_started_at: string
          p_provider_capabilities: Json
        }
        Returns: {
          arch: string | null
          banned_at: string | null
          configured_capacity: number
          created_at: string
          credential_expires_at: string | null
          credential_hash: string
          display_name: string
          gentic_version: string | null
          id: string
          last_seen_at: string | null
          normalized_name: string | null
          os: string | null
          process_started_at: string | null
          provider_capabilities: Json
          setup_state: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_old_orphaned_attachments: {
        Args: { older_than?: string }
        Returns: {
          storage_path: string
        }[]
      }
      delete_orphaned_attachment_rows: {
        Args: { older_than?: string }
        Returns: number
      }
      finish_issue_run_if_no_pending: {
        Args: {
          p_issue_id: string
          p_pr_url?: string
          p_run_finished_at: string
          p_run_id: string
          p_status: string
        }
        Returns: boolean
      }
      mark_attachment_storage_deleted: {
        Args: { storage_paths: string[] }
        Returns: number
      }
      next_issue_number_for_project: {
        Args: { p_project_id: string }
        Returns: number
      }
      record_worker_enrollment_exchange_failure: {
        Args: {
          p_max_failures: number
          p_now: string
          p_rate_limit_key: string
          p_window_ms: number
        }
        Returns: {
          failed_count: number
          locked_until: string
        }[]
      }
      reset_issue_run:
        | {
            Args: { p_agent_provider: string; p_issue_id: string }
            Returns: undefined
          }
        | {
            Args: {
              p_agent_provider: string
              p_issue_id: string
              p_issue_model?: string
            }
            Returns: undefined
          }
      send_issue_user_message: {
        Args: { p_content: string; p_issue_id: string }
        Returns: {
          created_at: string
          id: string
        }[]
      }
      start_issue_from_draft: {
        Args: { p_issue_id: string }
        Returns: undefined
      }
    }
    Enums: {
      issue_priority: "low" | "medium" | "high" | "urgent"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      issue_priority: ["low", "medium", "high", "urgent"],
    },
  },
} as const
