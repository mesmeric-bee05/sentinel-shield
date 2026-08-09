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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          ai_summary: string | null
          channel: Database["public"]["Enums"]["appointment_channel"]
          created_at: string
          ends_at: string
          id: string
          no_show_risk: number | null
          patient_id: string
          provider_id: string
          reason: string | null
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          ai_summary?: string | null
          channel?: Database["public"]["Enums"]["appointment_channel"]
          created_at?: string
          ends_at: string
          id?: string
          no_show_risk?: number | null
          patient_id: string
          provider_id: string
          reason?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          ai_summary?: string | null
          channel?: Database["public"]["Enums"]["appointment_channel"]
          created_at?: string
          ends_at?: string
          id?: string
          no_show_risk?: number | null
          patient_id?: string
          provider_id?: string
          reason?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          meta: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          meta?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          meta?: Json | null
        }
        Relationships: []
      }
      care_facilities: {
        Row: {
          address: string | null
          created_at: string
          facility_type: Database["public"]["Enums"]["facility_type"]
          hours: string | null
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          facility_type?: Database["public"]["Enums"]["facility_type"]
          hours?: string | null
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          facility_type?: Database["public"]["Enums"]["facility_type"]
          hours?: string | null
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          name?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      chw_assignments: {
        Row: {
          chw_id: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          last_error: string | null
          last_error_at: string | null
          notes: string | null
          patient_id: string
          patient_lat: number | null
          patient_lng: number | null
          priority: Database["public"]["Enums"]["chw_priority"]
          retry_count: number
          status: Database["public"]["Enums"]["chw_assignment_status"]
          task_type: Database["public"]["Enums"]["chw_task_type"]
          updated_at: string
        }
        Insert: {
          chw_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          notes?: string | null
          patient_id: string
          patient_lat?: number | null
          patient_lng?: number | null
          priority?: Database["public"]["Enums"]["chw_priority"]
          retry_count?: number
          status?: Database["public"]["Enums"]["chw_assignment_status"]
          task_type?: Database["public"]["Enums"]["chw_task_type"]
          updated_at?: string
        }
        Update: {
          chw_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          last_error?: string | null
          last_error_at?: string | null
          notes?: string | null
          patient_id?: string
          patient_lat?: number | null
          patient_lng?: number | null
          priority?: Database["public"]["Enums"]["chw_priority"]
          retry_count?: number
          status?: Database["public"]["Enums"]["chw_assignment_status"]
          task_type?: Database["public"]["Enums"]["chw_task_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chw_assignments_chw_id_fkey"
            columns: ["chw_id"]
            isOneToOne: false
            referencedRelation: "chw_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      chw_check_ins: {
        Row: {
          assignment_id: string
          chw_id: string
          created_at: string
          geo_lat: number | null
          geo_lng: number | null
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["chw_assignment_status"]
        }
        Insert: {
          assignment_id: string
          chw_id: string
          created_at?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          notes?: string | null
          status: Database["public"]["Enums"]["chw_assignment_status"]
        }
        Update: {
          assignment_id?: string
          chw_id?: string
          created_at?: string
          geo_lat?: number | null
          geo_lng?: number | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["chw_assignment_status"]
        }
        Relationships: [
          {
            foreignKeyName: "chw_check_ins_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "chw_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chw_check_ins_chw_id_fkey"
            columns: ["chw_id"]
            isOneToOne: false
            referencedRelation: "chw_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      chw_requeue_log: {
        Row: {
          actor_id: string
          assignment_id: string
          created_at: string
          id: string
          previous_status: string
          retry_count: number
          scope: string
        }
        Insert: {
          actor_id: string
          assignment_id: string
          created_at?: string
          id?: string
          previous_status: string
          retry_count: number
          scope?: string
        }
        Update: {
          actor_id?: string
          assignment_id?: string
          created_at?: string
          id?: string
          previous_status?: string
          retry_count?: number
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "chw_requeue_log_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "chw_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      chw_workers: {
        Row: {
          base_lat: number | null
          base_lng: number | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          languages: string[]
          skills: string[]
          user_id: string
        }
        Insert: {
          base_lat?: number | null
          base_lng?: number | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          languages?: string[]
          skills?: string[]
          user_id: string
        }
        Update: {
          base_lat?: number | null
          base_lng?: number | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          languages?: string[]
          skills?: string[]
          user_id?: string
        }
        Relationships: []
      }
      email_settings: {
        Row: {
          delivery_mode: string
          id: number
          last_dns_check_at: string | null
          live_since_at: string | null
          sender_domain: string | null
          updated_at: string
        }
        Insert: {
          delivery_mode?: string
          id?: number
          last_dns_check_at?: string | null
          live_since_at?: string | null
          sender_domain?: string | null
          updated_at?: string
        }
        Update: {
          delivery_mode?: string
          id?: number
          last_dns_check_at?: string | null
          live_since_at?: string | null
          sender_domain?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      gsc_republish_log: {
        Row: {
          actor_id: string | null
          attempt_number: number
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          error_reason: string | null
          http_status: number | null
          id: string
          kind: string
          site_url: string | null
          status: string
        }
        Insert: {
          actor_id?: string | null
          attempt_number?: number
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          error_reason?: string | null
          http_status?: number | null
          id?: string
          kind: string
          site_url?: string | null
          status: string
        }
        Update: {
          actor_id?: string | null
          attempt_number?: number
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          error_reason?: string | null
          http_status?: number | null
          id?: string
          kind?: string
          site_url?: string | null
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          full_name: string | null
          id: string
          insurance_provider: string | null
          phone: string | null
          phone_e164: string | null
          sms_opt_in: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          insurance_provider?: string | null
          phone?: string | null
          phone_e164?: string | null
          sms_opt_in?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          insurance_provider?: string | null
          phone?: string | null
          phone_e164?: string | null
          sms_opt_in?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      provider_availability: {
        Row: {
          created_at: string
          end_time: string
          id: string
          provider_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          provider_id: string
          start_time: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          provider_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_availability_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          accepts_insurance: boolean | null
          bio: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean | null
          location: string | null
          photo_url: string | null
          rating: number | null
          specialty: string
          telemedicine_enabled: boolean | null
          user_id: string | null
          years_experience: number | null
        }
        Insert: {
          accepts_insurance?: boolean | null
          bio?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean | null
          location?: string | null
          photo_url?: string | null
          rating?: number | null
          specialty: string
          telemedicine_enabled?: boolean | null
          user_id?: string | null
          years_experience?: number | null
        }
        Update: {
          accepts_insurance?: boolean | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean | null
          location?: string | null
          photo_url?: string | null
          rating?: number | null
          specialty?: string
          telemedicine_enabled?: boolean | null
          user_id?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
      role_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          justification: string | null
          requested_role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["role_request_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          justification?: string | null
          requested_role: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["role_request_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          justification?: string | null
          requested_role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["role_request_status"]
          user_id?: string
        }
        Relationships: []
      }
      security_export_audit: {
        Row: {
          actor_id: string
          created_at: string
          duration_ms: number | null
          export_kind: string
          filters: Json
          format: string
          id: string
          row_count: number
          scan_window_from: string | null
          scan_window_to: string | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          duration_ms?: number | null
          export_kind: string
          filters?: Json
          format?: string
          id?: string
          row_count?: number
          scan_window_from?: string | null
          scan_window_to?: string | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          duration_ms?: number | null
          export_kind?: string
          filters?: Json
          format?: string
          id?: string
          row_count?: number
          scan_window_from?: string | null
          scan_window_to?: string | null
        }
        Relationships: []
      }
      security_finding_audit: {
        Row: {
          affected_endpoints: string[]
          affected_queries: string[]
          created_at: string
          id: string
          internal_id: string
          notes: string | null
          resolution: string
          resolved_by: string | null
          scanner_name: string
        }
        Insert: {
          affected_endpoints?: string[]
          affected_queries?: string[]
          created_at?: string
          id?: string
          internal_id: string
          notes?: string | null
          resolution: string
          resolved_by?: string | null
          scanner_name: string
        }
        Update: {
          affected_endpoints?: string[]
          affected_queries?: string[]
          created_at?: string
          id?: string
          internal_id?: string
          notes?: string | null
          resolution?: string
          resolved_by?: string | null
          scanner_name?: string
        }
        Relationships: []
      }
      security_findings: {
        Row: {
          first_seen_at: string
          id: string
          internal_id: string
          last_seen_at: string
          rationale: string | null
          resource: string | null
          scanner_name: string
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          first_seen_at?: string
          id?: string
          internal_id: string
          last_seen_at?: string
          rationale?: string | null
          resource?: string | null
          scanner_name: string
          severity: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          first_seen_at?: string
          id?: string
          internal_id?: string
          last_seen_at?: string
          rationale?: string | null
          resource?: string | null
          scanner_name?: string
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      security_sync_attempts: {
        Row: {
          duration_ms: number | null
          error: string | null
          finding_count: number | null
          id: string
          nonce: string | null
          payload_bytes: number | null
          received_at: string
          signature_valid: boolean
          source_ip: string | null
          status: string
        }
        Insert: {
          duration_ms?: number | null
          error?: string | null
          finding_count?: number | null
          id?: string
          nonce?: string | null
          payload_bytes?: number | null
          received_at?: string
          signature_valid: boolean
          source_ip?: string | null
          status: string
        }
        Update: {
          duration_ms?: number | null
          error?: string | null
          finding_count?: number | null
          id?: string
          nonce?: string | null
          payload_bytes?: number | null
          received_at?: string
          signature_valid?: boolean
          source_ip?: string | null
          status?: string
        }
        Relationships: []
      }
      seo_audit_runs: {
        Row: {
          actor_id: string | null
          checks: Json
          created_at: string
          duration_ms: number
          finished_at: string
          id: string
          started_at: string
          summary: Json
        }
        Insert: {
          actor_id?: string | null
          checks: Json
          created_at?: string
          duration_ms: number
          finished_at: string
          id?: string
          started_at: string
          summary: Json
        }
        Update: {
          actor_id?: string | null
          checks?: Json
          created_at?: string
          duration_ms?: number
          finished_at?: string
          id?: string
          started_at?: string
          summary?: Json
        }
        Relationships: []
      }
      seo_settings: {
        Row: {
          gsc_meta_token: string | null
          gsc_site_url: string | null
          gsc_sitemap_submitted_at: string | null
          gsc_verified_at: string | null
          id: number
          updated_at: string
        }
        Insert: {
          gsc_meta_token?: string | null
          gsc_site_url?: string | null
          gsc_sitemap_submitted_at?: string | null
          gsc_verified_at?: string | null
          id?: number
          updated_at?: string
        }
        Update: {
          gsc_meta_token?: string | null
          gsc_site_url?: string | null
          gsc_sitemap_submitted_at?: string | null
          gsc_verified_at?: string | null
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      service_areas: {
        Row: {
          center_lat: number
          center_lng: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          population_estimate: number | null
          radius_km: number
        }
        Insert: {
          center_lat: number
          center_lng: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          population_estimate?: number | null
          radius_km?: number
        }
        Update: {
          center_lat?: number
          center_lng?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          population_estimate?: number | null
          radius_km?: number
        }
        Relationships: []
      }
      slot_holds: {
        Row: {
          created_at: string
          ends_at: string
          expires_at: string
          id: string
          patient_id: string
          provider_id: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          expires_at: string
          id?: string
          patient_id: string
          provider_id: string
          starts_at: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          expires_at?: string
          id?: string
          patient_id?: string
          provider_id?: string
          starts_at?: string
        }
        Relationships: []
      }
      travel_time_cache: {
        Row: {
          computed_at: string
          dest_lat: number
          dest_lng: number
          distance_meters: number
          duration_seconds: number
          id: string
          mode: string
          origin_lat: number
          origin_lng: number
          provider: string
        }
        Insert: {
          computed_at?: string
          dest_lat: number
          dest_lng: number
          distance_meters: number
          duration_seconds: number
          id?: string
          mode?: string
          origin_lat: number
          origin_lng: number
          provider?: string
        }
        Update: {
          computed_at?: string
          dest_lat?: number
          dest_lng?: number
          distance_meters?: number
          duration_seconds?: number
          id?: string
          mode?: string
          origin_lat?: number
          origin_lng?: number
          provider?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      security_sync_metrics_daily: {
        Row: {
          avg_duration_ms: number | null
          bytes: number | null
          count: number | null
          day: string | null
          last_seen: string | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_slot_hold: {
        Args: {
          _ends_at: string
          _provider_id: string
          _starts_at: string
          _ttl_seconds?: number
        }
        Returns: Json
      }
      admin_count: { Args: never; Returns: number }
      bootstrap_first_admin: { Args: { _user_id: string }; Returns: boolean }
      cleanup_expired_holds: { Args: never; Returns: undefined }
      decide_role_request: {
        Args: { _approve: boolean; _request_id: string }
        Returns: boolean
      }
      grant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _target: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      log_audit: {
        Args: {
          _action: string
          _entity: string
          _entity_id: string
          _meta: Json
        }
        Returns: string
      }
      log_security_fix: {
        Args: {
          _affected_endpoints: string[]
          _affected_queries: string[]
          _internal_id: string
          _notes: string
          _resolution: string
          _scanner_name: string
        }
        Returns: string
      }
      release_slot_hold: { Args: { _hold_id: string }; Returns: boolean }
      revoke_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _target: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "patient" | "provider" | "admin"
      appointment_channel: "in_person" | "telemedicine"
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "no_show"
      chw_assignment_status:
        | "pending"
        | "accepted"
        | "in_progress"
        | "completed"
        | "cancelled"
        | "escalated"
      chw_priority: "low" | "normal" | "high" | "urgent"
      chw_task_type:
        | "home_visit"
        | "medication_check"
        | "wellness_call"
        | "transport"
        | "education"
        | "triage_followup"
      facility_type:
        | "clinic"
        | "hospital"
        | "pharmacy"
        | "urgent_care"
        | "lab"
        | "community_center"
      role_request_status: "pending" | "approved" | "denied"
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
      app_role: ["patient", "provider", "admin"],
      appointment_channel: ["in_person", "telemedicine"],
      appointment_status: [
        "scheduled",
        "confirmed",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ],
      chw_assignment_status: [
        "pending",
        "accepted",
        "in_progress",
        "completed",
        "cancelled",
        "escalated",
      ],
      chw_priority: ["low", "normal", "high", "urgent"],
      chw_task_type: [
        "home_visit",
        "medication_check",
        "wellness_call",
        "transport",
        "education",
        "triage_followup",
      ],
      facility_type: [
        "clinic",
        "hospital",
        "pharmacy",
        "urgent_care",
        "lab",
        "community_center",
      ],
      role_request_status: ["pending", "approved", "denied"],
    },
  },
} as const
