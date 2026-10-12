-- Genithm sequence intelligence: bounded ORF, six-frame translation, motif, and reverse-complement jobs.
-- All scientific execution stays within the existing queue/worker/provenance model.

alter table public.scientific_jobs
  drop constraint scientific_jobs_type;
alter table public.scientific_jobs
  add constraint scientific_jobs_type check (
    job_type in (
      'pairwise_alignment', 'multiple_sequence_alignment',
      'phylogenetic_tree', 'protein_properties', 'sequence_insights'
    )
  );

insert into app_private.scientific_tools (
  tool_id, tool_version, display_name, category, runtime_kind, status,
  network_required, timeout_seconds, memory_mb, cpu_millicores, max_input_cells, parameter_schema
) values (
  'genithm-sequence-insights', '0.1.0', 'Genithm Sequence Intelligence',
  'sequence_analysis', 'isolated_worker', 'approved',
  false, 60, 256, 1000, 50000,
  '{"type":"object","additionalProperties":false,"required":["operation","motif","min_aa"]}'::jsonb
) on conflict (tool_id, tool_version) do nothing;

insert into app_private.scientific_rate_limit_policies (
  action, window_seconds, user_limit, organization_limit
) values ('sequence_insights', 3600, 30, 120)
on conflict (action) do nothing;

create or replace function app_private.request_sequence_insights(
  p_project_id uuid,
  p_sequence_upload_id uuid,
  p_operation text,
  p_motif text default null,
  p_min_aa integer default 30
) returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  input public.sequence_uploads%rowtype;
  tool app_private.scientific_tools%rowtype;
  normalized_operation text := lower(trim(coalesce(p_operation,'')));
  normalized_motif text := nullif(upper(trim(coalesce(p_motif,''))),'');
  normalized_parameters jsonb;
  fingerprint text;
  existing_id uuid;
  new_id uuid;
  queue_message_id bigint;
  user_active integer;
  org_active integer;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select organization_id into org_id
  from public.projects
  where id = p_project_id and status = 'active';
  if not found then
    raise exception 'project not found or inactive' using errcode = 'P0002';
  end if;
  if not app_private.can_write_org(org_id) then
    raise exception 'project write access denied' using errcode = '42501';
  end if;

  if normalized_operation not in ('orf_scan','six_frame_translation','motif_scan','reverse_complement') then
    raise exception 'unapproved sequence intelligence operation';
  end if;
  if p_min_aa is null or p_min_aa < 1 or p_min_aa > 1000 then
    raise exception 'ORF minimum amino acids must be between 1 and 1000';
  end if;
  if normalized_operation = 'motif_scan' then
    if normalized_motif is null or normalized_motif !~ '^[ACGTRYSWKMBDHVNU]{2,32}$' then
      raise exception 'motif must contain 2-32 IUPAC nucleotide symbols';
    end if;
    normalized_motif := replace(normalized_motif,'U','T');
  elsif normalized_motif is not null then
    raise exception 'motif is allowed only for motif_scan';
  end if;
  if normalized_operation <> 'orf_scan' and p_min_aa <> 30 then
    raise exception 'minimum ORF length is allowed only for orf_scan';
  end if;

  select * into input
  from public.sequence_uploads
  where id = p_sequence_upload_id
    and project_id = p_project_id and organization_id = org_id
  for share;
  if not found then
    raise exception 'sequence not found in this project' using errcode = 'P0002';
  end if;
  if input.status <> 'ready' or input.sha256 is null
     or input.sha256 !~ '^[0-9a-f]{64}$'
     or input.sequence_type not in ('dna','rna') or input.sequence_count <> 1
     or input.residue_count is null or input.residue_count < 1 or input.residue_count > 50000
     or input.file_size_bytes < 1 or input.file_size_bytes > 2097152
     or coalesce(input.validation_warnings,'[]'::jsonb) ? 'gap_characters_present'
  then
    raise exception 'sequence intelligence requires one ready, ungapped DNA/RNA sequence within 50000 bases';
  end if;

  select * into tool from app_private.scientific_tools
  where tool_id = 'genithm-sequence-insights'
    and tool_version = '0.1.0' and status = 'approved';
  if not found then
    raise exception 'approved sequence intelligence tool is unavailable';
  end if;

  normalized_parameters := jsonb_build_object(
    'operation',normalized_operation,
    'motif',normalized_motif,
    'min_aa',p_min_aa
  );
  fingerprint := encode(
    extensions.digest(
      convert_to(concat_ws(E'\\x1f',
        'sequence_insights', p_project_id::text, input.id::text, input.sha256,
        tool.tool_id, tool.tool_version, normalized_parameters::text
      ),'UTF8'), 'sha256'
    ), 'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,19321));

  select id into existing_id from public.scientific_jobs
  where organization_id=org_id
    and request_fingerprint=fingerprint
    and status in ('queued','running','validating_result')
  order by created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;

  perform app_private.consume_scientific_rate_limit('sequence_insights',caller_id,org_id);
  select count(*) into user_active from public.scientific_jobs
  where requested_by=caller_id and status in ('queued','running','validating_result');
  select count(*) into org_active from public.scientific_jobs
  where organization_id=org_id and status in ('queued','running','validating_result');
  if user_active >= 5 or org_active >= 25 then
    raise sqlstate 'PGRST' using
      message=jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active scientific analyses.')::text,
      detail=jsonb_build_object('status',429)::text;
  end if;

  insert into public.scientific_jobs (
    organization_id,project_id,requested_by,job_type,tool_id,tool_version,parameters,request_fingerprint
  ) values (
    org_id,p_project_id,caller_id,'sequence_insights',
    tool.tool_id,tool.tool_version,normalized_parameters,fingerprint
  ) returning id into new_id;

  insert into public.scientific_job_inputs (
    job_id,organization_id,project_id,input_position,input_role,
    sequence_upload_id,input_sha256,sequence_type,residue_count
  ) values (
    new_id,org_id,p_project_id,1,'nucleotide_sequence',
    input.id,input.sha256,input.sequence_type,input.residue_count
  );

  select pgmq.send(
    queue_name=>'scientific_standard',
    msg=>jsonb_build_object('job_id',new_id,'job_type','sequence_insights')
  ) into queue_message_id;
  if queue_message_id is null then
    raise exception 'failed to queue sequence intelligence analysis';
  end if;
  return new_id;
end;
$function$;

create or replace function public.request_sequence_insights(
  project_id uuid,
  sequence_upload_id uuid,
  operation text,
  motif text default null,
  min_aa integer default 30
) returns uuid
language sql
set search_path to ''
as $function$
  select app_private.request_sequence_insights(
    project_id, sequence_upload_id, operation, motif, min_aa
  );
$function$;

revoke all on function public.request_sequence_insights(uuid,uuid,text,text,integer) from public,anon;
grant execute on function public.request_sequence_insights(uuid,uuid,text,text,integer) to authenticated,service_role;

create or replace function app_private.finish_sequence_insights_job_success(
  p_message_id bigint,
  p_job_id uuid,
  p_executor_version text,
  p_result_object_path text,
  p_result_sha256 text,
  p_result_bytes bigint,
  p_result_summary jsonb,
  p_provenance jsonb
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  target public.scientific_jobs%rowtype;
  expected_path text;
  input public.scientific_job_inputs%rowtype;
  sequence public.sequence_uploads%rowtype;
  result_operation text;
begin
  select * into target from public.scientific_jobs where id=p_job_id for update;
  if not found or target.status <> 'running' or target.job_type <> 'sequence_insights' then
    raise exception 'sequence insights job is not active' using errcode='P0002';
  end if;

  expected_path := target.organization_id::text||'/'||target.project_id::text||
    '/'||target.id::text||'/sequence-insights-result.json';
  if p_result_object_path is distinct from expected_path then
    raise exception 'sequence insights result path mismatch';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id='analysis-results' and name=expected_path
  ) then
    raise exception 'sequence insights output was not uploaded';
  end if;
  if p_result_sha256 is null or p_result_sha256 !~ '^[0-9a-f]{64}$'
     or p_result_bytes is null or p_result_bytes < 1 or p_result_bytes > 26214400
     or p_executor_version is distinct from 'genithm-scientific-worker/0.5.0' then
    raise exception 'sequence insights result integrity is invalid';
  end if;
  if p_result_summary is null or jsonb_typeof(p_result_summary) <> 'object'
     or p_provenance is null or jsonb_typeof(p_provenance) <> 'object' then
    raise exception 'sequence insights provenance is invalid';
  end if;
  result_operation := target.parameters->>'operation';
  select * into input from public.scientific_job_inputs
  where job_id=target.id and input_position=1;
  if not found or input.input_role <> 'nucleotide_sequence' then
    raise exception 'sequence insights input lineage missing';
  end if;
  if (select count(*) from public.scientific_job_inputs where job_id=target.id) <> 1 then
    raise exception 'sequence insights has unexpected inputs';
  end if;
  select * into sequence from public.sequence_uploads where id=input.sequence_upload_id;
  if not found then raise exception 'sequence insights source missing'; end if;
  if p_result_summary->>'job_type' is distinct from 'sequence_insights'
     or p_result_summary->>'operation' is distinct from result_operation
     or p_result_summary->>'sequence_type' is distinct from input.sequence_type
     or p_result_summary->>'input_sha256' is distinct from input.input_sha256
     or (p_result_summary->>'sequence_length')::integer is distinct from input.residue_count
     or p_provenance->>'tool_id' is distinct from target.tool_id
     or p_provenance->>'tool_version' is distinct from target.tool_version
     or p_provenance->>'executor_version' is distinct from p_executor_version
     or p_provenance->>'request_fingerprint' is distinct from target.request_fingerprint
     or p_provenance->'parameters' is distinct from target.parameters
  then
    raise exception 'sequence insights result provenance mismatch';
  end if;

  update public.scientific_jobs
  set status='completed',executor_version=p_executor_version,
      result_object_path=expected_path,result_sha256=p_result_sha256,
      result_bytes=p_result_bytes,result_summary=p_result_summary,
      provenance=p_provenance,processing_finished_at=now(),
      processing_error=null,failure_class=null,updated_at=now()
  where id=target.id;

  if not pgmq.delete('scientific_standard',p_message_id) then
    raise exception 'sequence insights queue message acknowledgement failed';
  end if;
end;
$function$;

create or replace function public.finish_sequence_insights_job_success(
  message_id bigint,
  job_id uuid,
  executor_version text,
  result_object_path text,
  result_sha256 text,
  result_bytes bigint,
  result_summary jsonb,
  provenance jsonb
) returns void
language sql
set search_path to ''
as $function$
  select app_private.finish_sequence_insights_job_success(
    message_id,job_id,executor_version,result_object_path,
    result_sha256,result_bytes,result_summary,provenance
  );
$function$;

revoke all on function public.finish_sequence_insights_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_sequence_insights_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) to service_role;
