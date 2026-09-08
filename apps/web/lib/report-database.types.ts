import type { Database as AiDatabase, Json } from "@/lib/ai-database.types";

type AiPublic = AiDatabase["public"];

type ScientificReport = {
  Row: {
    id: string;
    organization_id: string;
    project_id: string;
    created_by: string;
    source_job_id: string;
    source_job_type: string;
    source_result_sha256: string;
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

type ReportFunctions = AiPublic["Functions"] & {
  request_scientific_report: {
    Args: { source_job_id: string };
    Returns: string;
  };
  get_scientific_report: {
    Args: { report_id: string };
    Returns: {
      id: string;
      organization_id: string;
      project_id: string;
      created_by: string;
      source_job_id: string;
      source_job_type: string;
      source_result_sha256: string;
      report_schema_version: string;
      report_snapshot: Json;
      report_sha256: string;
      integrity_valid: boolean;
      generated_at: string;
      created_at: string;
    }[];
  };
};

export type Database = Omit<AiDatabase, "public"> & {
  public: Omit<AiPublic, "Tables" | "Functions"> & {
    Tables: ReportTables;
    Functions: ReportFunctions;
  };
};

export type { Json };
