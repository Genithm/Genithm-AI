-- Science V25: manual staging-only evidence audit.
-- Example:
-- psql "$GENITHM_STAGING_DB_URL" -X -v ON_ERROR_STOP=1 \
--   -v message_id="<approved_user_message_uuid>" \
--   -v run_id="<approved_pipeline_uuid>" \
--   -f supabase/tests/v25_staging_evidence_readonly.sql
--
-- Explicitly verify the URL refers to an ISOLATED STAGING database before use.
-- This query issues NO writes, jobs, network requests or schema changes.
-- It never selects raw sequence bodies, private result JSON, storage keys or
-- credentials. Run in a database session authorized to inspect the test user.
begin transaction isolation level repeatable read read only;

with linked as (
  select
    m.id as message_id,
    m.conversation_owner_id as owner_id,
    m.project_id,
    m.organization_id,
    m.protocol_input_scope,
    m.role as message_role,
    m.plan_request_id,
    coalesce(pg_catalog.cardinality(m.attachment_upload_ids),0) as attachment_count,
    c.created_by as conversation_owner,
    c.project_id as conversation_project,
    c.organization_id as conversation_organization,
    p.id as run_id,
    p.requested_by,
    p.project_id as run_project,
    p.organization_id as run_organization,
    p.template,
    p.requested_accession,
    p.status as pipeline_status,
    p.retrieval_id,
    p.sequence_upload_id,
    p.sequence_sha256,
    p.scientific_job_id,
    r.status as retrieval_status,
    r.source_database,
    r.requested_accession as retrieval_accession,
    r.sequence_upload_id as retrieved_upload,
    s.status as sequence_status,
    s.sha256 as uploaded_sha,
    j.status as science_status,
    j.job_type,
    j.parameters,
    j.result_sha256,
    j.result_object_path,
    inp.input_count,
    inp.all_inputs_match
  from public.ai_messages m
  join public.ai_conversations c
    on c.id=m.conversation_id
  join public.research_pipeline_runs p
    on p.id=m.research_pipeline_run_id
  left join public.sequence_retrievals r
    on r.id=p.retrieval_id
  left join public.sequence_uploads s
    on s.id=p.sequence_upload_id
  left join public.scientific_jobs j
    on j.id=p.scientific_job_id
  left join lateral (
    select count(*)::integer as input_count,
      coalesce(bool_and(
        i.input_position=1
        and i.sequence_upload_id=p.sequence_upload_id
        and i.input_sha256=p.sequence_sha256
      ),false) as all_inputs_match
    from public.scientific_job_inputs i
    where i.job_id=p.scientific_job_id
  ) inp on true
  where m.id=:'message_id'::uuid and p.id=:'run_id'::uuid
), audited as (
  select *,
    (
      message_role='user'
      and protocol_input_scope='text_only'
      and attachment_count=0
      and plan_request_id is null
      and owner_id=requested_by
      and owner_id=conversation_owner
      and project_id=conversation_project
      and project_id=run_project
      and organization_id=conversation_organization
      and organization_id=run_organization
    ) as consent_valid,
    (
      retrieval_status='retrieved'
      and retrieval_accession=requested_accession
      and source_database=case when template='ncbi_nucleotide_orf_v1' then 'nucleotide'
        when template='ncbi_protein_profile_v1' then 'protein' else '' end
      and retrieved_upload=sequence_upload_id
      and sequence_status='ready'
      and uploaded_sha=sequence_sha256
      and sequence_sha256 ~ '^[0-9a-f]{64}$'
    ) as source_valid,
    (
      science_status='completed'
      and input_count=1 and all_inputs_match
      and (
        (template='ncbi_nucleotide_orf_v1' and job_type='sequence_insights'
          and parameters->>'operation'='orf_scan'
          and parameters->>'min_aa'='30')
        or (template='ncbi_protein_profile_v1' and job_type='protein_properties')
      )
      and result_sha256 ~ '^[0-9a-f]{64}$'
      and nullif(result_object_path,'') is not null
    ) as job_valid
  from linked
)
select
  case when coalesce(consent_valid,false)
            and pipeline_status='completed'
            and coalesce(source_valid,false)
            and coalesce(job_valid,false)
       then 'PASS: recorded lineage consistent'
       else 'REVIEW: recorded lineage incomplete'
  end as staging_evidence_audit,
  pipeline_status,
  retrieval_status,
  sequence_status,
  science_status,
  coalesce(consent_valid,false) as consent_valid,
  coalesce(source_valid,false) as source_valid,
  coalesce(job_valid,false) as job_valid,
  input_count,
  template,
  requested_accession
from audited;

-- An empty query result means the supplied exact message/run pair did not
-- match. The staging operator must treat that as FAIL, not as evidence.
commit;
