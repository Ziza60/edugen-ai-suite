export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      certificates: {
        Row: {
          course_id: string
          custom_data: Json | null
          id: string
          issued_at: string
          student_name: string
          template: string
          token: string
          user_id: string
        }
        Insert: {
          course_id: string
          custom_data?: Json | null
          id?: string
          issued_at?: string
          student_name: string
          template?: string
          token?: string
          user_id: string
        }
        Update: {
          course_id?: string
          custom_data?: Json | null
          id?: string
          issued_at?: string
          student_name?: string
          template?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_flashcards: {
        Row: {
          back: string
          created_at: string
          front: string
          id: string
          module_id: string
        }
        Insert: {
          back: string
          created_at?: string
          front: string
          id?: string
          module_id: string
        }
        Update: {
          back?: string
          created_at?: string
          front?: string
          id?: string
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_flashcards_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      course_images: {
        Row: {
          alt_text: string | null
          created_at: string
          id: string
          module_id: string
          url: string
        }
        Insert: {
          alt_text?: string | null
          created_at?: string
          id?: string
          module_id: string
          url: string
        }
        Update: {
          alt_text?: string | null
          created_at?: string
          id?: string
          module_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_images_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      course_landings: {
        Row: {
          benefits: Json
          course_id: string
          created_at: string
          cta_text: string
          headline: string
          id: string
          is_published: boolean
          slug: string
          subtitle: string
          summary: string
          testimonial_name: string
          testimonial_text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          benefits?: Json
          course_id: string
          created_at?: string
          cta_text?: string
          headline?: string
          id?: string
          is_published?: boolean
          slug: string
          subtitle?: string
          summary?: string
          testimonial_name?: string
          testimonial_text?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          benefits?: Json
          course_id?: string
          created_at?: string
          cta_text?: string
          headline?: string
          id?: string
          is_published?: boolean
          slug?: string
          subtitle?: string
          summary?: string
          testimonial_name?: string
          testimonial_text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_landings_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_modules: {
        Row: {
          content: string | null
          course_id: string
          created_at: string
          id: string
          order_index: number
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          course_id: string
          created_at?: string
          id?: string
          order_index?: number
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          course_id?: string
          created_at?: string
          id?: string
          order_index?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_quiz_questions: {
        Row: {
          correct_answer: number
          created_at: string
          explanation: string | null
          id: string
          module_id: string
          options: Json
          question: string
        }
        Insert: {
          correct_answer?: number
          created_at?: string
          explanation?: string | null
          id?: string
          module_id: string
          options?: Json
          question: string
        }
        Update: {
          correct_answer?: number
          created_at?: string
          explanation?: string | null
          id?: string
          module_id?: string
          options?: Json
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_quiz_questions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      course_sources: {
        Row: {
          char_count: number
          content_type: string
          course_id: string
          created_at: string
          extracted_text: string | null
          file_path: string
          filename: string
          id: string
          user_id: string
        }
        Insert: {
          char_count?: number
          content_type?: string
          course_id: string
          created_at?: string
          extracted_text?: string | null
          file_path: string
          filename: string
          id?: string
          user_id: string
        }
        Update: {
          char_count?: number
          content_type?: string
          course_id?: string
          created_at?: string
          extracted_text?: string | null
          file_path?: string
          filename?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_sources_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          description: string | null
          id: string
          include_flashcards: boolean
          include_images: boolean
          include_quiz: boolean
          language: string
          status: Database["public"]["Enums"]["course_status"]
          target_audience: string | null
          theme: string | null
          title: string
          tone: string | null
          tutor_enabled: boolean
          tutor_slug: string | null
          updated_at: string
          use_sources: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          include_flashcards?: boolean
          include_images?: boolean
          include_quiz?: boolean
          language?: string
          status?: Database["public"]["Enums"]["course_status"]
          target_audience?: string | null
          theme?: string | null
          title: string
          tone?: string | null
          tutor_enabled?: boolean
          tutor_slug?: string | null
          updated_at?: string
          use_sources?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          include_flashcards?: boolean
          include_images?: boolean
          include_quiz?: boolean
          language?: string
          status?: Database["public"]["Enums"]["course_status"]
          target_audience?: string | null
          theme?: string | null
          title?: string
          tone?: string | null
          tutor_enabled?: boolean
          tutor_slug?: string | null
          updated_at?: string
          use_sources?: boolean
          user_id?: string
        }
        Relationships: []
      }
      pptx_export_reports: {
        Row: {
          blocked_reason: string | null
          checkpoints: Json
          corrections_attempted: Json
          course_id: string
          created_at: string
          forensic_trace: Json
          id: string
          passed: boolean
          pipeline_version: string | null
          problematic_slides: Json
          quality_score: number
          summary: Json
          user_id: string
        }
        Insert: {
          blocked_reason?: string | null
          checkpoints?: Json
          corrections_attempted?: Json
          course_id: string
          created_at?: string
          forensic_trace?: Json
          id?: string
          passed?: boolean
          pipeline_version?: string | null
          problematic_slides?: Json
          quality_score?: number
          summary?: Json
          user_id: string
        }
        Update: {
          blocked_reason?: string | null
          checkpoints?: Json
          corrections_attempted?: Json
          course_id?: string
          created_at?: string
          forensic_trace?: Json
          id?: string
          passed?: boolean
          pipeline_version?: string | null
          problematic_slides?: Json
          quality_score?: number
          summary?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pptx_export_reports_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          is_dev: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_dev?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_dev?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          plan: Database["public"]["Enums"]["subscription_plan"]
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tutor_sessions: {
        Row: {
          answer: string
          course_id: string
          created_at: string
          id: string
          question: string
          session_token: string
        }
        Insert: {
          answer: string
          course_id: string
          created_at?: string
          id?: string
          question: string
          session_token: string
        }
        Update: {
          answer?: string
          course_id?: string
          created_at?: string
          id?: string
          question?: string
          session_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "tutor_sessions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      course_status: "draft" | "published"
      subscription_plan: "free" | "pro"
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
      course_status: ["draft", "published"],
      subscription_plan: ["free", "pro"],
    },
  },
} as const
