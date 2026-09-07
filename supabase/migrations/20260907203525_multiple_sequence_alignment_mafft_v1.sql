alter table public.scientific_jobs drop constraint scientific_jobs_type;
alter table public.scientific_jobs
  add constraint scientific_jobs_type
  check (job_type in ('pairwise_alignment','multiple_sequence_alignment'));

insert into app_private.scientific_tools(
  tool_id, tool_version, display_name, category, runtime_kind, status,
  network_required, timeout_seconds, memory_mb, cpu_millicores, max_input_cells, parameter_schema
) values (
  'mafft', '7.505-1', 'MAFFT Multiple Sequence Alignment', 'alignment', 'isolated_worker', 'approved',
  false, 300, 2048, 1000, 100000000,
  '{"strategy":{"enum":["auto"]},"thread_count":{"const":1},"max_sequences":{"const":50},"max_total_residues":{"const":100000}}'::jsonb
);

insert into app_private.scientific_rate_limit_policies(action, window_seconds, user_limit, organization_limit)
values ('multiple_sequence_alignment', 3600, 10, 40)
on conflict (action) do update set
  window_seconds = excluded.window_seconds,
  user_limit = excluded.user_limit,
  organization_limit = excluded.organization_limit;

create or replace function app_private.request_multiple_sequence_alignment(
  p_project_id uuid,
  p_sequence_upload_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  input_count integer;
  matched_count integer;
  distinct_count integer;
  sequence_type_count integer;
  invalid_count integer;
  total_residues bigint;
  max_residues bigint;
  tool app_private.scientific_tools%rowtype;
  normalized_params jsonb := jsonb_build_object('strategy','auto','thread_count',1);
  fingerprint_material text;
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

  select organization_id into org_id from public.projects where id = p_project_id;
  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  if not app_private.can_write_org(org_id) then
    raise exception 'project write access denied' using errcode = '42501';
  end if;

  input_count := coalesce(array_length(p_sequence_upload_ids, 1), 0);
  if input_count < 3 or input_count > 50 then
    raise exception 'MSA V1 requires between 3 and 50 input sequences';
  end if;

  select count(distinct x.upload_id) into distinct_count
  from unnest(p_sequence_upload_ids) as x(upload_id);
  if distinct_count <> input_count
     or exists(select 1 from unnest(p_sequence_upload_ids) as x(upload_id) where x.upload_id is null) then
    raise exception 'MSA input sequence IDs must be unique and non-null';
  end if;

  with requested as (
    select x.upload_id, x.ordinality
    from unnest(p_sequence_upload_ids) with ordinality as x(upload_id, ordinality)
  ), matched as (
    select r.ordinality, u.*
    from requested r
    join public.sequence_uploads u on u.id = r.upload_id
    where u.project_id = p_project_id and u.organization_id = org_id
  )
  select
    count(*),
    count(distinct sequence_type),
    count(*) filter (
      where status <> 'ready'
         or sha256 is null
         or sequence_count <> 1
         or sequence_type not in ('dna','rna','protein')
         or residue_count is null
         or residue_count < 1
         or residue_count > 20000
         or file_size_bytes > 2097152
         or coalesce(validation_warnings, '[]'::jsonb) ? 'gap_characters_present'
    ),
    coalesce(sum(residue_count),0),
    coalesce(max(residue_count),0)
  into matched_count, sequence_type_count, invalid_count, total_residues, max_residues
  from matched;

  if matched_count <> input_count then
    raise exception 'one or more MSA input sequences were not found in this project' using errcode = 'P0002';
  end if;
  if invalid_count <> 0 then
    raise exception 'MSA requires validated single-record ungapped sequences within V1 input limits';
  end if;
  if sequence_type_count <> 1 then
    raise exception 'MSA requires all input sequences to have the same validated sequence type';
  end if;
  if total_residues > 100000 then
    raise exception 'MSA total input residues exceed the V1 compute budget';
  end if;

  select * into tool
  from app_private.scientific_tools
  where tool_id = 'mafft' and tool_version = '7.505-1' and status = 'approved';
  if not found then
    raise exception 'approved MAFFT tool is unavailable';
  end if;

  select string_agg(
    concat_ws(':', r.ordinality::text, u.id::text, u.sha256, u.sequence_type, u.residue_count::text),
    E'\x1e' order by r.ordinality
  ) into fingerprint_material
  from unnest(p_sequence_upload_ids) with ordinality as r(upload_id, ordinality)
  join public.sequence_uploads u on u.id = r.upload_id;

  fingerprint := encode(
    extensions.digest(
      convert_to(
        concat_ws(E'\x1f', 'multiple_sequence_alignment', p_project_id::text, tool.tool_id, tool.tool_version, normalized_params::text, fingerprint_material),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint, 11273));

  select id into existing_id
  from public.scientific_jobs
  where organization_id = org_id
    and request_fingerprint = fingerprint
    and status in ('queued','running','validating_result')
  order by created_at desc
  limit 1;
  if existing_id is not null then
    return existing_id;
  end if;

  perform app_private.consume_scientific_rate_limit('multiple_sequence_alignment', caller_id, org_id);

  select count(*) into user_active
  from public.scientific_jobs
  where requested_by = caller_id and status in ('queued','running','validating_result');
  select count(*) into org_active
  from public.scientific_jobs
  where organization_id = org_id and status in ('queued','running','validating_result');
  if user_active >= 5 or org_active >= 25 then
    raise sqlstate 'PGRST' using
      message = jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active scientific analyses. Wait for current jobs to finish.')::text,
      detail = jsonb_build_object('status',429)::text;
  end if;

  insert into public.scientific_jobs(
    organization_id, project_id, requested_by, job_type, tool_id, tool_version, parameters, request_fingerprint
  ) values (
    org_id, p_project_id, caller_id, 'multiple_sequence_alignment', tool.tool_id, tool.tool_version,
    normalized_params, fingerprint
  ) returning id into new_id;

  insert into public.scientific_job_inputs(
    job_id, organization_id, project_id, input_position, input_role,
    sequence_upload_id, input_sha256, sequence_type, residue_count
  )
  select
    new_id, org_id, p_project_id, r.ordinality::smallint, 'sequence',
    u.id, u.sha256, u.sequence_type, u.residue_count
  from unnest(p_sequence_upload_ids) with ordinality as r(upload_id, ordinality)
  join public.sequence_uploads u on u.id = r.upload_id
  order by r.ordinality;

  select pgmq.send(
    queue_name => 'scientific_standard',
    msg => jsonb_build_object('job_id', new_id, 'job_type', 'multiple_sequence_alignment')
  ) into queue_message_id;
  if queue_message_id is null then
    raise exception 'failed to enqueue MSA scientific job';
  end if;

  return new_id;
end;
$$;

create or replace function public.request_multiple_sequence_alignment(
  project_id uuid,
  sequence_upload_ids uuid[]
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.request_multiple_sequence_alignment(project_id, sequence_upload_ids);
$$;

revoke all on function app_private.request_multiple_sequence_alignment(uuid,uuid[]) from public, anon, authenticated, service_role;
grant execute on function app_private.request_multiple_sequence_alignment(uuid,uuid[]) to authenticated;
revoke all on function public.request_multiple_sequence_alignment(uuid,uuid[]) from public, anon, service_role;
grant execute on function public.request_multiple_sequence_alignment(uuid,uuid[]) to authenticated;

create or replace function app_private.claim_scientific_job(p_visibility_seconds integer default 300)
returns table(
  message_id bigint,
  job_id uuid,
  organization_id uuid,
  project_id uuid,
  requested_by uuid,
  job_type text,
  tool_id text,
  tool_version text,
  parameters jsonb,
  request_fingerprint text,
  inputs jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  q record;
  target public.scientific_jobs%rowtype;
  target_id uuid;
  payload_type text;
  input_rows jsonb;
  input_count integer;
  tool_status text;
begin
  if p_visibility_seconds < 60 or p_visibility_seconds > 900 then
    raise exception 'visibility timeout must be between 60 and 900 seconds';
  end if;

  select * into q
  from pgmq.read(queue_name => 'scientific_standard', vt => p_visibility_seconds, qty => 1)
  limit 1;
  if not found then
    return;
  end if;

  begin
    target_id := (q.message->>'job_id')::uuid;
    payload_type := q.message->>'job_type';
  exception when others then
    perform pgmq.delete('scientific_standard', q.msg_id);
    return;
  end;

  select * into target
  from public.scientific_jobs
  where id = target_id
  for update;

  if not found or target.status <> 'queued' or payload_type is distinct from target.job_type then
    perform pgmq.delete('scientific_standard', q.msg_id);
    return;
  end if;

  select status into tool_status
  from app_private.scientific_tools
  where tool_id = target.tool_id and tool_version = target.tool_version;
  if tool_status is null or tool_status = 'disabled' then
    update public.scientific_jobs
       set status='error', failure_class='execution', processing_error='Approved scientific tool is unavailable.',
           processing_finished_at=now(), updated_at=now()
     where id=target.id;
    perform pgmq.delete('scientific_standard', q.msg_id);
    return;
  end if;

  select count(*) into input_count
  from public.scientific_job_inputs
  where job_id = target.id;

  if (target.job_type = 'pairwise_alignment' and input_count <> 2)
     or (target.job_type = 'multiple_sequence_alignment' and (input_count < 3 or input_count > 50)) then
    update public.scientific_jobs
       set status='error', failure_class='input_integrity', processing_error='Scientific job inputs are incomplete or outside approved bounds.',
           processing_finished_at=now(), updated_at=now()
     where id=target.id;
    perform pgmq.delete('scientific_standard', q.msg_id);
    return;
  end if;

  update public.scientific_jobs
     set status='running', processing_attempts=processing_attempts+1,
         processing_started_at=coalesce(processing_started_at,now()), processing_error=null,
         failure_class=null, updated_at=now()
   where id=target.id
   returning * into target;

  select jsonb_agg(
    jsonb_build_object(
      'position', i.input_position,
      'role', i.input_role,
      'upload_id', i.sequence_upload_id,
      'object_path', u.object_path,
      'file_size_bytes', u.file_size_bytes,
      'sha256', i.input_sha256,
      'sequence_type', i.sequence_type,
      'residue_count', i.residue_count
    ) order by i.input_position
  ) into input_rows
  from public.scientific_job_inputs i
  join public.sequence_uploads u on u.id = i.sequence_upload_id
  where i.job_id = target.id;

  return query select
    q.msg_id::bigint, target.id, target.organization_id, target.project_id, target.requested_by,
    target.job_type, target.tool_id, target.tool_version, target.parameters,
    target.request_fingerprint, input_rows;
end;
$$;

create or replace function app_private.finish_scientific_job_success(
  p_message_id bigint,
  p_job_id uuid,
  p_executor_version text,
  p_result_object_path text,
  p_result_sha256 text,
  p_result_bytes bigint,
  p_result_summary jsonb,
  p_provenance jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.scientific_jobs%rowtype;
  expected_path text;
  a_sha text;
  b_sha text;
  expected_hashes jsonb;
  input_count integer;
  aligned_length integer;
  identity numeric;
begin
  select * into target
  from public.scientific_jobs
  where id = p_job_id
  for update;

  if not found or target.status <> 'running' then
    raise exception 'scientific job is not active' using errcode='P0002';
  end if;

  expected_path := target.organization_id::text || '/' || target.project_id::text || '/' || target.id::text ||
    case when target.job_type = 'pairwise_alignment' then '/pairwise-result.json'
         when target.job_type = 'multiple_sequence_alignment' then '/msa-result.fasta'
         else '/unsupported-result' end;

  if p_result_object_path is distinct from expected_path then
    raise exception 'scientific result object path mismatch';
  end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='analysis-results' and o.name=expected_path) then
    raise exception 'scientific result artifact not found' using errcode='P0002';
  end if;
  if p_result_sha256 is null or p_result_sha256 !~ '^[0-9a-f]{64}$'
     or p_result_bytes is null or p_result_bytes < 1 or p_result_bytes > 26214400 then
    raise exception 'scientific result integrity metadata is invalid';
  end if;
  if nullif(trim(p_executor_version),'') is null or char_length(trim(p_executor_version)) > 128 then
    raise exception 'scientific executor provenance is invalid';
  end if;
  if p_result_summary is null or jsonb_typeof(p_result_summary) <> 'object'
     or p_provenance is null or jsonb_typeof(p_provenance) <> 'object' then
    raise exception 'scientific normalized result or provenance is invalid';
  end if;
  if p_result_summary->>'job_type' is distinct from target.job_type then
    raise exception 'scientific result job type mismatch';
  end if;
  if p_provenance->>'tool_id' is distinct from target.tool_id
     or p_provenance->>'tool_version' is distinct from target.tool_version
     or p_provenance->>'executor_version' is distinct from trim(p_executor_version)
     or p_provenance->>'request_fingerprint' is distinct from target.request_fingerprint then
    raise exception 'scientific provenance mismatch';
  end if;

  if target.job_type = 'pairwise_alignment' then
    select input_sha256 into a_sha from public.scientific_job_inputs where job_id=target.id and input_position=1;
    select input_sha256 into b_sha from public.scientific_job_inputs where job_id=target.id and input_position=2;
    if p_result_summary->>'input_a_sha256' is distinct from a_sha
       or p_result_summary->>'input_b_sha256' is distinct from b_sha
       or p_result_summary->>'algorithm' is distinct from target.parameters->>'algorithm' then
      raise exception 'scientific result input or parameter provenance mismatch';
    end if;
    begin
      aligned_length := (p_result_summary->>'aligned_length')::integer;
      identity := (p_result_summary->>'identity_percent')::numeric;
    exception when others then
      raise exception 'scientific result metrics are invalid';
    end;
    if aligned_length < 0 or identity < 0 or identity > 100 then
      raise exception 'scientific result metrics are outside valid bounds';
    end if;
  elsif target.job_type = 'multiple_sequence_alignment' then
    select count(*), jsonb_agg(input_sha256 order by input_position)
      into input_count, expected_hashes
    from public.scientific_job_inputs
    where job_id = target.id;

    if p_result_summary->'input_sha256s' is distinct from expected_hashes
       or p_result_summary->>'strategy' is distinct from 'auto' then
      raise exception 'MSA result input or parameter provenance mismatch';
    end if;
    begin
      if (p_result_summary->>'sequence_count')::integer <> input_count then
        raise exception 'MSA result sequence count mismatch';
      end if;
      aligned_length := (p_result_summary->>'aligned_length')::integer;
    exception when others then
      raise exception 'MSA result metrics are invalid';
    end;
    if aligned_length < 1 or aligned_length > 500000 then
      raise exception 'MSA aligned length is outside approved bounds';
    end if;
  else
    raise exception 'unsupported scientific job type';
  end if;

  update public.scientific_jobs
     set status='completed', executor_version=trim(p_executor_version),
         result_object_path=expected_path, result_sha256=p_result_sha256,
         result_bytes=p_result_bytes, result_summary=p_result_summary,
         provenance=p_provenance, processing_finished_at=now(),
         processing_error=null, failure_class=null, updated_at=now()
   where id=target.id;

  if not pgmq.delete('scientific_standard', p_message_id) then
    raise exception 'scientific queue message delete failed';
  end if;
end;
$$;
