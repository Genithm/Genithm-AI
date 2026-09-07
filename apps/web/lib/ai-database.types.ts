import type { Database as LiveDatabase, Json } from "@/lib/live-database.types";

type LivePublic = LiveDatabase["public"];

type AiConversation = {
  Row: {
    id: string;
    organization_id: string;
    project_id: string;
    created_by: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    organization_id: string;
    project_id: string;
    created_by: string;
    title: string;
    status?: string;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<AiConversation["Insert"]>;
  Relationships: [];
};

type AiMessage = {
  Row: {
    id: string;
    conversation_id: string;
    organization_id: string;
    project_id: string;
    conversation_owner_id: string;
    role: string;
    content: string;
    message_kind: string;
    plan_request_id: string | null;
    created_at: string;
  };
  Insert: {
    id?: string;
    conversation_id: string;
    organization_id: string;
    project_id: string;
    conversation_owner_id: string;
    role: string;
    content: string;
    message_kind?: string;
    plan_request_id?: string | null;
    created_at?: string;
  };
  Update: Partial<AiMessage["Insert"]>;
  Relationships: [];
};

type AiPlanRequest = {
  Row: {
    id: string;
    conversation_id: string;
    user_message_id: string;
    organization_id: string;
    project_id: string;
    requested_by: string;
    status: string;
    provider: string | null;
    model: string | null;
    prompt_version: string | null;
    policy_version: string;
    plan_schema_version: string | null;
    plan: Json | null;
    plan_sha256: string | null;
    action_type: string | null;
    requires_confirmation: boolean;
    dispatched_resource_type: string | null;
    dispatched_resource_id: string | null;
    processing_attempts: number;
    processing_started_at: string | null;
    processing_finished_at: string | null;
    processing_error: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    conversation_id: string;
    user_message_id: string;
    organization_id: string;
    project_id: string;
    requested_by: string;
    status?: string;
    provider?: string | null;
    model?: string | null;
    prompt_version?: string | null;
    policy_version?: string;
    plan_schema_version?: string | null;
    plan?: Json | null;
    plan_sha256?: string | null;
    action_type?: string | null;
    requires_confirmation?: boolean;
    dispatched_resource_type?: string | null;
    dispatched_resource_id?: string | null;
    processing_attempts?: number;
    processing_started_at?: string | null;
    processing_finished_at?: string | null;
    processing_error?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<AiPlanRequest["Insert"]>;
  Relationships: [];
};

type AiTables = LivePublic["Tables"] & {
  ai_conversations: AiConversation;
  ai_messages: AiMessage;
  ai_plan_requests: AiPlanRequest;
};

type AiFunctions = LivePublic["Functions"] & {
  request_ai_plan: {
    Args: { project_id: string; conversation_id: string | null; user_message: string };
    Returns: { conversation_id: string; plan_request_id: string }[];
  };
  approve_ai_plan: {
    Args: { plan_request_id: string };
    Returns: { resource_type: string; resource_id: string }[];
  };
  claim_ai_plan_request: {
    Args: { visibility_seconds?: number };
    Returns: {
      message_id: number;
      plan_request_id: string;
      conversation_id: string;
      organization_id: string;
      project_id: string;
      requested_by: string;
      user_message: string;
      authorized_context: Json;
    }[];
  };
  finish_ai_plan_success: {
    Args: {
      message_id: number;
      plan_request_id: string;
      provider: string;
      model: string;
      prompt_version: string;
      policy_version: string;
      plan: Json;
    };
    Returns: undefined;
  };
  finish_ai_plan_error: {
    Args: {
      message_id: number;
      plan_request_id: string;
      processing_error: string;
      retryable?: boolean;
      max_attempts?: number;
    };
    Returns: string;
  };
};

export type Database = Omit<LiveDatabase, "public"> & {
  public: Omit<LivePublic, "Tables" | "Functions"> & {
    Tables: AiTables;
    Functions: AiFunctions;
  };
};

export type { Json };
