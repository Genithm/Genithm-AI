export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      blast_jobs: {
        Row: {
          blast_version: string | null
          created_at: string
          database_name: string
          database_release: string | null
          database_reported: string | null
          expect_value: number
          id: string
          low_complexity_filter: boolean
          max_targets: number
          next_poll_at: string | null
          normalized_hits: Json | null
          organization_id: string
          poll_count: number
          processing_error: string | null
          processing_finished_at: string | null
          processing_started_at: string | null
          program: string
          project_id: string
          query_sha256: string
          query_upload_id: string
          raw_result_bytes: number | null
          raw_result_sha256: string | null
          remote_rid: string | null
          remote_rtoe_seconds: number | null
          requested_by: string
          result_object_path: string | null
          result_summary: Json | null
          service_mode: string
          service_provider: string
          service_version: string | null
          status: string
          submission_attempts: number
          submitted_at: string | null
          transient_error_count: number
          updated_at: string
        }
        Insert: {
          blast_version?: string | null
          created_at?: string
          database_name: string
          database_release?: string | null
          database_reported?: string | null
          expect_value?: number
          id?: string
          low_complexity_filter?: boolean
          max_targets?: number
          next_poll_at?: string | null
          normalized_hits?: Json | null
          organization_id: string
          poll_count?: number
          processing_error?: string | null
          processing_finished_at?: string | null
          processing_started_at?: string | null
          program: string
          project_id: string
          query_sha256: string
          query_upload_id: string
          raw_result_bytes?: number | null
          raw_result_sha256?: string | null
          remote_rid?: string | null
          remote_rtoe_seconds?: number | null
          requested_by: string
          result_object_path?: string | null
          result_summary?: Json | null
          service_mode?: string
          service_provider?: string
          service_version?: string | null
          status?: string
          submission_attempts?: number
          submitted_at?: string | null
          transient_error_count?: number
          updated_at?: string
        }
        Update: {
          blast_version?: string | null
          created_at?: string
          database_name?: string
          database_release?: string | null
          database_reported?: string | null
          expect_value?: number
          id?: string
          low_complexity_filter?: boolean
          max_targets?: number
          next_poll_at?: string | null
          normalized_hits?: Json | null
          organization_id?: string
          poll_count?: number
          processing_error?: string | null
          processing_finished_at?: string | null
          processing_started_at?: string | null
          program?: string
          project_id?: string
          query_sha256?: string
          query_upload_id?: string
          raw_result_bytes?: number | null
          raw_result_sha256?: string | null
          remote_rid?: string | null
          remote_rtoe_seconds?: number | null
          requested_by?: string
          result_object_path?: string | null
          result_summary?: Json | null
          service_mode?: string
          service_provider?: string
          service_version?: string | null
          status?: string
          submission_attempts?: number
          submitted_at?: string | null
          transient_error_count?: number
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "blast_jobs_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "blast_jobs_project_org_fkey"; columns: ["project_id", "organization_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id", "organization_id"] },
          { foreignKeyName: "blast_jobs_query_project_org_fkey"; columns: ["query_upload_id", "project_id", "organization_id"]; isOneToOne: false; referencedRelation: "sequence_uploads"; referencedColumns: ["id", "project_id", "organization_id"] },
        ]
      }
      organization_members: {
        Row: { created_at: string; organization_id: string; role: string; user_id: string }
        Insert: { created_at?: string; organization_id: string; role: string; user_id: string }
        Update: { created_at?: string; organization_id?: string; role?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "organization_members_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }]
      }
      organizations: {
        Row: { created_at: string; created_by: string; id: string; name: string; slug: string; updated_at: string }
        Insert: { created_at?: string; created_by: string; id?: string; name: string; slug: string; updated_at?: string }
        Update: { created_at?: string; created_by?: string; id?: string; name?: string; slug?: string; updated_at?: string }
        Relationships: []
      }
      profiles: {
        Row: { created_at: string; display_name: string | null; id: string; updated_at: string }
        Insert: { created_at?: string; display_name?: string | null; id: string; updated_at?: string }
        Update: { created_at?: string; display_name?: string | null; id?: string; updated_at?: string }
        Relationships: []
      }
      projects: {
        Row: { created_at: string; created_by: string; description: string | null; id: string; name: string; organization_id: string; status: string; updated_at: string }
        Insert: { created_at?: string; created_by: string; description?: string | null; id?: string; name: string; organization_id: string; status?: string; updated_at?: string }
        Update: { created_at?: string; created_by?: string; description?: string | null; id?: string; name?: string; organization_id?: string; status?: string; updated_at?: string }
        Relationships: [{ foreignKeyName: "projects_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }]
      }
      sequence_retrievals: {
        Row: {
          connector_version: string | null; created_at: string; id: string; organism: string | null; organization_id: string; processing_attempts: number; processing_error: string | null; processing_finished_at: string | null; processing_started_at: string | null; project_id: string; record_title: string | null; record_updated_date: string | null; reported_length: number | null; requested_accession: string; requested_by: string; resolved_accession: string | null; result_message: string | null; sequence_upload_id: string | null; source_database: string; source_provider: string; source_retrieved_at: string | null; status: string; updated_at: string
        }
        Insert: {
          connector_version?: string | null; created_at?: string; id?: string; organism?: string | null; organization_id: string; processing_attempts?: number; processing_error?: string | null; processing_finished_at?: string | null; processing_started_at?: string | null; project_id: string; record_title?: string | null; record_updated_date?: string | null; reported_length?: number | null; requested_accession: string; requested_by: string; resolved_accession?: string | null; result_message?: string | null; sequence_upload_id?: string | null; source_database: string; source_provider?: string; source_retrieved_at?: string | null; status?: string; updated_at?: string
        }
        Update: {
          connector_version?: string | null; created_at?: string; id?: string; organism?: string | null; organization_id?: string; processing_attempts?: number; processing_error?: string | null; processing_finished_at?: string | null; processing_started_at?: string | null; project_id?: string; record_title?: string | null; record_updated_date?: string | null; reported_length?: number | null; requested_accession?: string; requested_by?: string; resolved_accession?: string | null; result_message?: string | null; sequence_upload_id?: string | null; source_database?: string; source_provider?: string; source_retrieved_at?: string | null; status?: string; updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "sequence_retrievals_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "sequence_retrievals_project_org_fkey"; columns: ["project_id", "organization_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id", "organization_id"] },
          { foreignKeyName: "sequence_retrievals_sequence_upload_id_fkey"; columns: ["sequence_upload_id"]; isOneToOne: true; referencedRelation: "sequence_uploads"; referencedColumns: ["id"] },
        ]
      }
      sequence_uploads: {
        Row: {
          content_type: string | null; created_at: string; created_by: string; file_size_bytes: number; id: string; object_path: string; organization_id: string; original_filename: string; processing_attempts: number; processing_error: string | null; processing_finished_at: string | null; processing_started_at: string | null; project_id: string; residue_count: number | null; sequence_count: number | null; sequence_statistics: Json | null; sequence_type: string | null; sha256: string | null; statistics_calculated_at: string | null; statistics_version: string | null; status: string; updated_at: string; validated_at: string | null; validation_error: string | null; validation_warnings: Json; validator_version: string | null
        }
        Insert: {
          content_type?: string | null; created_at?: string; created_by: string; file_size_bytes: number; id: string; object_path: string; organization_id: string; original_filename: string; processing_attempts?: number; processing_error?: string | null; processing_finished_at?: string | null; processing_started_at?: string | null; project_id: string; residue_count?: number | null; sequence_count?: number | null; sequence_statistics?: Json | null; sequence_type?: string | null; sha256?: string | null; statistics_calculated_at?: string | null; statistics_version?: string | null; status?: string; updated_at?: string; validated_at?: string | null; validation_error?: string | null; validation_warnings?: Json; validator_version?: string | null
        }
        Update: {
          content_type?: string | null; created_at?: string; created_by?: string; file_size_bytes?: number; id?: string; object_path?: string; organization_id?: string; original_filename?: string; processing_attempts?: number; processing_error?: string | null; processing_finished_at?: string | null; processing_started_at?: string | null; project_id?: string; residue_count?: number | null; sequence_count?: number | null; sequence_statistics?: Json | null; sequence_type?: string | null; sha256?: string | null; statistics_calculated_at?: string | null; statistics_version?: string | null; status?: string; updated_at?: string; validated_at?: string | null; validation_error?: string | null; validation_warnings?: Json; validator_version?: string | null
        }
        Relationships: [
          { foreignKeyName: "sequence_uploads_organization_id_fkey"; columns: ["organization_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "sequence_uploads_project_org_fkey"; columns: ["project_id", "organization_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id", "organization_id"] },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      claim_blast_job: { Args: { visibility_seconds?: number }; Returns: { database_name: string; expect_value: string; job_id: string; low_complexity_filter: boolean; max_targets: number; message_id: number; organization_id: string; program: string; project_id: string; query_file_size_bytes: number; query_object_path: string; query_sha256: string; query_upload_id: string; remote_rid: string; requested_by: string; stage: string }[] }
      claim_ncbi_sequence_retrieval_job: { Args: { visibility_seconds?: number }; Returns: { database_name: string; message_id: number; organization_id: string; project_id: string; read_count: number; requested_accession: string; requested_by: string; retrieval_id: string }[] }
      claim_sequence_validation_job: { Args: { visibility_seconds?: number }; Returns: { content_type: string; file_size_bytes: number; message_id: number; object_path: string; read_count: number; upload_id: string }[] }
      complete_sequence_upload: { Args: { upload_id: string }; Returns: string }
      create_organization: { Args: { org_name: string; org_slug: string }; Returns: { created_at: string; created_by: string; id: string; name: string; slug: string; updated_at: string }; SetofOptions: { from: "*"; to: "organizations"; isOneToOne: true; isSetofReturn: false } }
      finish_blast_error: { Args: { job_id: string; max_poll_errors?: number; message_id: number; processing_error: string; retry_poll?: boolean }; Returns: string }
      finish_blast_poll_pending: { Args: { job_id: string; message_id: number }; Returns: undefined }
      finish_blast_submission: { Args: { job_id: string; message_id: number; remote_rid: string; rtoe_seconds: number; service_version: string }; Returns: undefined }
      finish_blast_success: { Args: { blast_version: string; database_release: string; database_reported: string; job_id: string; message_id: number; normalized_hits: Json; raw_result_bytes: number; raw_result_sha256: string; result_object_path: string; result_summary: Json }; Returns: undefined }
      finish_ncbi_sequence_retrieval_error: { Args: { max_attempts?: number; message_id: number; processing_error: string; retrieval_id: string }; Returns: string }
      finish_ncbi_sequence_retrieval_not_found: { Args: { connector_version: string; message_id: number; retrieval_id: string }; Returns: undefined }
      finish_ncbi_sequence_retrieval_rejected: { Args: { connector_version: string; message_id: number; reason: string; retrieval_id: string }; Returns: undefined }
      finish_ncbi_sequence_retrieval_success: { Args: { connector_version: string; file_size_bytes: number; message_id: number; organism: string; record_title: string; record_updated_date: string; reported_length: number; resolved_accession: string; retrieval_id: string; sequence_upload_id: string }; Returns: string }
      finish_sequence_validation_error: { Args: { max_attempts?: number; message_id: number; processing_error: string; upload_id: string }; Returns: string }
      finish_sequence_validation_rejected: { Args: { message_id: number; sha256?: string; upload_id: string; validation_error: string; validator_version: string }; Returns: undefined }
      finish_sequence_validation_success: { Args: { message_id: number; residue_count: number; sequence_count: number; sequence_type: string; sha256: string; upload_id: string; validator_version: string; warnings?: Json }; Returns: undefined }
      finish_sequence_validation_success_v2: { Args: { message_id: number; residue_count: number; sequence_count: number; sequence_type: string; sha256: string; statistics: Json; statistics_version: string; upload_id: string; validator_version: string; warnings: Json }; Returns: undefined }
      request_blast_job: { Args: { database_name: string; expect_value?: number; low_complexity_filter?: boolean; max_targets?: number; program: string; project_id: string; query_upload_id: string }; Returns: string }
      request_ncbi_sequence_retrieval: { Args: { accession: string; database_name: string; project_id: string }; Returns: string }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"]) : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R } ? R : never : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R } ? R : never : never

export type TablesInsert<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Insert: infer I } ? I : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Insert: infer I } ? I : never : never

export type TablesUpdate<DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals }, TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] : never = never> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Update: infer U } ? U : never : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Update: infer U } ? U : never : never

export type Enums<DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals }, EnumName extends DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"] : never = never> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName] : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions] : never

export type CompositeTypes<PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals }, CompositeTypeName extends PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"] : never = never> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals } ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName] : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions] : never

export const Constants = { public: { Enums: {} } } as const
