import type { Database as AiDatabase, Json } from "@/lib/ai-database.types";

type AiPublic = AiDatabase["public"];

type ScientificReport = {
  Row: {
    id: string;
    organization_id: string;
    project_id: string;
    created_by: string;
    source_job_id: string | null;
    source_job_type: string | null;
    source_result_sha256: string | null;
    source_resource_type: string;
    source_resource_id: string;
    source_evidence_sha256: string;
    blast_job_id: string | null;
    sequence_retrieval_id: string | null;
    protein_annotation_job_id: string | null;
    report_schema_version: string;
    report_snapshot: Json;
    report_sha256: string;
    generated_at: string;
    created_at: string;
  };
  Insert: never;
  Update: never;
  Relationships: [];
};

type ReportTables = AiPublic["Tables"] & {
  scientific_reports: ScientificReport;
};

type ReportRow = {
  id: string;
  organization_id: string;
  project_id: string;
  created_by: string;
  source_job_id: string | null;
  source_job_type: string | null;
  source_result_sha256: string | null;
  source_resource_type: string;
  source_resource_id: string;
  source_evidence_sha256: string;
  report_schema_version: string;
  report_snapshot: Json;
  report_sha256: string;
  integrity_valid: boolean;
  generated_at: string;
  created_at: string;
};

type AdminOrganizationRow = {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  member_count: number;
  project_count: number;
  created_at: string;
};

type PlatformSupportUserRow = {
  user_id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  display_name: string | null;
  organization_count: number;
  project_count: number;
};

type PlatformSupportMembershipRow = {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  membership_role: string;
  project_count: number;
};

type PlatformSupportCaseRow = {
  support_case_id: string;
  organization_id: string;
  target_user_id: string | null;
  target_project_id: string | null;
  category: string;
  title: string;
  initial_note: string;
  status: string;
  opened_by: string;
  opened_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

type ReportFunctions = AiPublic["Functions"] & {
  request_scientific_report: {
    Args: { source_job_id: string };
    Returns: string;
  };
  request_authoritative_report: {
    Args: { source_resource_type: string; source_resource_id: string };
    Returns: string;
  };
  get_scientific_report: {
    Args: { report_id: string };
    Returns: ReportRow[];
  };
  is_platform_admin: {
    Args: Record<PropertyKey, never>;
    Returns: boolean;
  };
  get_platform_admin_overview: {
    Args: Record<PropertyKey, never>;
    Returns: Json;
  };
  get_platform_admin_billing_overview: {
    Args: Record<PropertyKey, never>;
    Returns: Json;
  };
  get_platform_admin_plan_catalog: {
    Args: Record<PropertyKey, never>;
    Returns: Json;
  };
  get_platform_admin_payment_operations: {
    Args: Record<PropertyKey, never>;
    Returns: Json;
  };
  authorize_platform_billing_configuration: {
    Args: Record<PropertyKey, never>;
    Returns: boolean;
  };
  get_platform_admin_organizations: {
    Args: { page_size?: number; page_offset?: number };
    Returns: AdminOrganizationRow[];
  };
  lookup_platform_support_user: {
    Args: { exact_email: string };
    Returns: PlatformSupportUserRow[];
  };
  get_platform_support_user_memberships: {
    Args: { user_id: string };
    Returns: PlatformSupportMembershipRow[];
  };
  get_platform_support_cases: {
    Args: { organization_id: string; page_size?: number; page_offset?: number };
    Returns: PlatformSupportCaseRow[];
  };
  create_platform_support_case: {
    Args: {
      organization_id: string;
      target_user_id?: string | null;
      target_project_id?: string | null;
      category?: string;
      title?: string;
      initial_note?: string;
    };
    Returns: string;
  };
  resolve_platform_support_case: {
    Args: { support_case_id: string; resolution_note: string };
    Returns: string;
  };
  get_organization_plan_summary: {
    Args: { target_organization_id: string };
    Returns: Json;
  };
  has_organization_entitlement: {
    Args: { target_organization_id: string; requested_feature_key: string };
    Returns: boolean;
  };
  get_organization_billing_state: {
    Args: { organization_id: string; livemode: boolean };
    Returns: Json;
  };
  get_billing_checkout_context: {
    Args: { organization_id: string; price_key: string; livemode: boolean };
    Returns: Json;
  };
  get_billing_portal_context: {
    Args: { organization_id: string; livemode: boolean };
    Returns: Json;
  };
  request_platform_refund: {
    Args: { provider_invoice_id: string; amount_minor?: number | null; reason?: string };
    Returns: Json;
  };
};

export type Database = Omit<AiDatabase, "public"> & {
  public: Omit<AiPublic, "Tables" | "Functions"> & {
    Tables: ReportTables;
    Functions: ReportFunctions;
  };
};

export type { Json };
