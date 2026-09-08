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
};

export type Database = Omit<AiDatabase, "public"> & {
  public: Omit<AiPublic, "Tables" | "Functions"> & {
    Tables: ReportTables;
    Functions: ReportFunctions;
  };
};

export type { Json };
