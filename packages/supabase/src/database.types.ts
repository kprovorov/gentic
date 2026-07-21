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
          agent_provider: string
          created_at: string
          id: string
          pr_url: string | null
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
          agent_provider?: string
          created_at?: string
          id?: string
          pr_url?: string | null
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
          agent_provider?: string
          created_at?: string
          id?: string
          pr_url?: string | null
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
          consumed_at: string | null
          consumed_by_run_id: string | null
          content: string | null
          created_at: string
          event_id: string | null
          event_seq: number | null
          event_status: string | null
          event_ts: string | null
          event_type: string | null
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
          consumed_at?: string | null
          consumed_by_run_id?: string | null
          content?: string | null
          created_at?: string
          event_id?: string | null
          event_seq?: number | null
          event_status?: string | null
          event_ts?: string | null
          event_type?: string | null
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
          consumed_at?: string | null
          consumed_by_run_id?: string | null
          content?: string | null
          created_at?: string
          event_id?: string | null
          event_seq?: number | null
          event_status?: string | null
          event_ts?: string | null
          event_type?: string | null
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
          name: string
          repo: string
          setup_script: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_respond_to_reviews?: boolean
          created_at?: string
          id?: string
          name: string
          repo: string
          setup_script?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_respond_to_reviews?: boolean
          created_at?: string
          id?: string
          name?: string
          repo?: string
          setup_script?: string | null
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
      reset_issue_run: {
        Args: { p_agent_provider: string; p_issue_id: string }
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
      [_ in never]: never
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
    Enums: {},
  },
} as const
