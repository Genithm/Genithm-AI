import type { Database as BaseDatabase, Json } from "@/lib/database.types";

// Live-schema overlay generated from the Genithm Supabase project after the
// audit and generalized scientific-job migrations. Keeping this overlay
// explicit lets the application remain type-safe while the repository
// transitions the older generated baseline to automated schema generation.
type BasePublic = BaseDatabase["public"];
type BaseTables = BasePublic["Tables"];
type BaseFunctions = BasePublic["Functions"];
type RetrievalBase = BaseTables["sequence_retrievals"];

type SequenceRetrieval = {
  Row: RetrievalBase["Row"] & {
    freshness_policy: string;
    resolution_mode: string | null;
    source_checked_at: string | null;
    source_response_bytes: number | null;
    source_response_sha256: string | null;
  };
  Insert: RetrievalBase["Insert"] & {
    freshness_policy?: string;
    resolution_mode?: string | null;
    source_checked_at?: string | null;
    source_response_bytes?: number | null;
    source_response_sha256?: string | null;
  };
  Update: RetrievalBase["Update"] & {
    freshness_policy?: string;
    resolution_mode?: string | null;
    source_checked_at?: string | null;
    source_response_bytes?: number | null;
    source_response_sha256?: string | null;
  };
  Relationships: RetrievalBase["Relationships"];
};

type ScientificJob = {
  Row: {
    created_at: string;
    executor_version: string | null;
    failure_class: string | null;
    id: string;
    job_type: string;
    organization_id: string;
    parameters: Json;
    processing_attempts: number;
    processing_error: string | null;
    processing_finished_at: string | null;
    processing_started_at: string | null;
    project_id: string;
    provenance: Json | null;
    request_fingerprint: string;
    requested_by: string;
    result_bytes: number | null;
    result_object_path: string | null;
    result_sha256: string | null;
    result_summary: Json | null;
    status: string;
    tool_id: string;
    tool_version: string;
    updated_at: string;
  };
  Insert: {
    created_at?: string;
    executor_version?: string | null;
    failure_class?: string | null;
    id?: string;
    job_type: string;
    organization_id: string;
    parameters?: Json;
    processing_attempts?: number;
    processing_error?: string | null;
    processing_finished_at?: string | null;
    processing_started_at?: string | null;
    project_id: string;
    provenance?: Json | null;
    request_fingerprint: string;
    requested_by: string;
    result_bytes?: number | null;
    result_object_path?: string | null;
    result_sha256?: string | null;
    result_summary?: Json | null;
    status?: string;
    tool_id: string;
    tool_version: string;
    updated_at?: string;
  };
  Update: Partial<ScientificJob["Insert"]>;
  Relationships: [];
};

type ScientificJobInput = {
  Row: {
    created_at: string;
    input_position: number;
    input_role: string;
    input_sha256: string;
    job_id: string;
    organization_id: string;
    project_id: string;
    residue_count: number;
    sequence_type: string;
    sequence_upload_id: string;
  };
  Insert: {
    created_at?: string;
    input_position: number;
    input_role: string;
    input_sha256: string;
    job_id: string;
    organization_id: string;
    project_id: string;
    residue_count: number;
    sequence_type: string;
    sequence_upload_id: string;
  };
  Update: Partial<ScientificJobInput["Insert"]>;
  Relationships: [];
};

type ScientificJobDependency = {
  Row: {
    created_at: string;
    dependency_job_id: string;
    dependency_result_object_path: string;
    dependency_result_sha256: string;
    dependency_role: string;
    job_id: string;
    organization_id: string;
    project_id: string;
  };
  Insert: {
    created_at?: string;
    dependency_job_id: string;
    dependency_result_object_path: string;
    dependency_result_sha256: string;
    dependency_role: string;
    job_id: string;
    organization_id: string;
    project_id: string;
  };
  Update: Partial<ScientificJobDependency["Insert"]>;
  Relationships: [];
};

type AuditEvent = {
  Row: {
    actor_type: string;
    actor_user_id: string | null;
    chain_sequence: number;
    chain_version: string;
    event_hash: string;
    event_id: string;
    event_type: string;
    metadata: Json;
    occurred_at: string;
    organization_id: string;
    outcome: string;
    previous_hash: string;
    project_id: string | null;
    resource_id: string;
    resource_type: string;
  };
  Insert: {
    actor_type: string;
    actor_user_id?: string | null;
    chain_sequence: number;
    chain_version?: string;
    event_hash: string;
    event_id: string;
    event_type: string;
    metadata?: Json;
    occurred_at: string;
    organization_id: string;
    outcome: string;
    previous_hash: string;
    project_id?: string | null;
    resource_id: string;
    resource_type: string;
  };
  Update: Partial<AuditEvent["Insert"]>;
  Relationships: [];
};

type AuditCheckpoint = {
  Row: {
    chain_head_hash: string;
    chain_sequence: number;
    checkpoint_version: string;
    created_at: string;
    id: string;
    organization_id: string;
    payload_sha256: string;
    public_key_base64: string;
    public_key_sha256: string;
    signature_base64: string;
    signed_at: string;
    signing_key_id: string;
  };
  Insert: {
    chain_head_hash: string;
    chain_sequence: number;
    checkpoint_version?: string;
    created_at?: string;
    id: string;
    organization_id: string;
    payload_sha256: string;
    public_key_base64: string;
    public_key_sha256: string;
    signature_base64: string;
    signed_at: string;
    signing_key_id: string;
  };
  Update: Partial<AuditCheckpoint["Insert"]>;
  Relationships: [];
};

type LiveTables = BaseTables & {
  audit_checkpoints: AuditCheckpoint;
  audit_events: AuditEvent;
  scientific_job_dependencies: ScientificJobDependency;
  scientific_job_inputs: ScientificJobInput;
  scientific_jobs: ScientificJob;
  sequence_retrievals: SequenceRetrieval;
};

type ScientificFinishArgs = {
  executor_version: string;
  job_id: string;
  message_id: number;
  provenance: Json;
  result_bytes: number;
  result_object_path: string;
  result_sha256: string;
  result_summary: Json;
};

type LiveFunctions = BaseFunctions & {
  claim_audit_checkpoint_job: {
    Args: { visibility_seconds?: number };
    Returns: {
      chain_head_hash: string;
      chain_sequence: number;
      checkpoint_request_id: string;
      message_id: number;
      organization_id: string;
      payload_sha256: string;
      signing_payload: string;
    }[];
  };
  claim_scientific_job: {
    Args: { visibility_seconds?: number };
    Returns: {
      inputs: Json;
      job_id: string;
      job_type: string;
      message_id: number;
      organization_id: string;
      parameters: Json;
      project_id: string;
      request_fingerprint: string;
      requested_by: string;
      tool_id: string;
      tool_version: string;
    }[];
  };
  finish_audit_checkpoint_error: {
    Args: { checkpoint_request_id: string; max_attempts?: number; message_id: number; processing_error: string };
    Returns: string;
  };
  finish_audit_checkpoint_success: {
    Args: { checkpoint_request_id: string; message_id: number; public_key_base64: string; signature_base64: string; signing_key_id: string };
    Returns: string;
  };
  finish_ncbi_sequence_retrieval_success_v2: {
    Args: {
      connector_version: string;
      file_size_bytes: number;
      message_id: number;
      organism: string;
      record_title: string;
      record_updated_date: string;
      reported_length: number;
      resolved_accession: string;
      retrieval_id: string;
      sequence_upload_id: string;
      source_response_bytes: number;
      source_response_sha256: string;
    };
    Returns: string;
  };
  finish_phylogenetic_job_success: { Args: ScientificFinishArgs; Returns: undefined };
  finish_protein_properties_success: { Args: ScientificFinishArgs; Returns: undefined };
  finish_scientific_job_error: {
    Args: { failure_class: string; job_id: string; max_attempts?: number; message_id: number; processing_error: string; retryable?: boolean };
    Returns: string;
  };
  finish_scientific_job_success: { Args: ScientificFinishArgs; Returns: undefined };
  request_multiple_sequence_alignment: {
    Args: { project_id: string; sequence_upload_ids: string[] };
    Returns: string;
  };
  request_pairwise_alignment: {
    Args: {
      algorithm?: string;
      gap_score?: number;
      match_score?: number;
      mismatch_score?: number;
      project_id: string;
      sequence_a_id: string;
      sequence_b_id: string;
    };
    Returns: string;
  };
  request_phylogenetic_tree: {
    Args: { msa_job_id: string; project_id: string };
    Returns: string;
  };
  request_protein_properties: {
    Args: { project_id: string; sequence_upload_id: string };
    Returns: string;
  };
  requeue_audit_checkpoint_request: {
    Args: { checkpoint_request_id: string };
    Returns: undefined;
  };
  verify_audit_chain: {
    Args: { organization_id: string };
    Returns: Json;
  };
};

export type Database = Omit<BaseDatabase, "public"> & {
  public: Omit<BasePublic, "Tables" | "Functions"> & {
    Tables: LiveTables;
    Functions: LiveFunctions;
  };
};

export type { Json };
