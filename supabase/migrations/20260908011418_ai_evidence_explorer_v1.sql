create or replace function public.get_ai_interpretation_evidence(interpretation_request_id uuid)
returns table (
  interpretation_request_id uuid,
  conversation_id uuid,
  project_id uuid,
  resource_type text,
  resource_id uuid,
  evidence_schema_version text,
  evidence_snapshot jsonb,
  evidence_sha256 text,
  evidence_integrity_ok boolean,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.id,
    r.conversation_id,
    r.project_id,
    r.resource_type,
    r.resource_id,
    r.evidence_schema_version,
    r.evidence_snapshot,
    r.evidence_sha256,
    encode(extensions.digest(convert_to(r.evidence_snapshot::text, 'UTF8'), 'sha256'), 'hex') = r.evidence_sha256,
    r.created_at
  from public.ai_interpretation_requests r
  where r.id = $1
    and r.status = 'completed';
$$;

revoke all on function public.get_ai_interpretation_evidence(uuid) from public, anon, service_role;
grant execute on function public.get_ai_interpretation_evidence(uuid) to authenticated;

comment on function public.get_ai_interpretation_evidence(uuid) is
  'Returns the caller-authorized frozen evidence snapshot for a completed AI interpretation and recomputes its SHA-256 integrity flag. RLS on ai_interpretation_requests remains authoritative.';
