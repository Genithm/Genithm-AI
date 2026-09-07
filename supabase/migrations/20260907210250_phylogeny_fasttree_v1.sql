alter table public.scientific_jobs drop constraint if exists scientific_jobs_type;
alter table public.scientific_jobs
  add constraint scientific_jobs_type
  check (job_type in ('pairwise_alignment','multiple_sequence_alignment','phylogenetic_tree'));

create table public.scientific_job_dependencies (
  job_id uuid not null,
  dependency_job_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  dependency_role text not null,
  dependency_result_sha256 text not null,
  dependency_result_object_path text not null,
  created_at timestamptz not null default now(),
  primary key (job_id, dependency_job_id, dependency_role),
  constraint scientific_job_dependencies_job_fkey
    foreign key (job_id, project_id, organization_id)
    references public.scientific_jobs(id, project_id, organization_id) on delete cascade,
  constraint scientific_job_dependencies_source_fkey
    foreign key (dependency_job_id, project_id, organization_id)
    references public.scientific_jobs(id, project_id, organization_id) on delete restrict,
  constraint scientific_job_dependencies_no_self check (job_id <> dependency_job_id),
  constraint scientific_job_dependencies_role check (dependency_role ~ '^[a-z0-9_]{2,64}$'),
  constraint scientific_job_dependencies_sha check (dependency_result_sha256 ~ '^[0-9a-f]{64}$'),
  constraint scientific_job_dependencies_path check (char_length(dependency_result_object_path) between 10 and 1024)
);

create index scientific_job_dependencies_org_idx on public.scientific_job_dependencies(organization_id);
create index scientific_job_dependencies_project_idx on public.scientific_job_dependencies(project_id);
create index scientific_job_dependencies_source_idx on public.scientific_job_dependencies(dependency_job_id, project_id, organization_id);

alter table public.scientific_job_dependencies enable row level security;
alter table public.scientific_job_dependencies force row level security;
create policy scientific_job_dependencies_select_org_member
on public.scientific_job_dependencies for select to authenticated
using ((select app_private.is_org_member(organization_id)));
revoke all on table public.scientific_job_dependencies from public, anon, authenticated, service_role;
grant select on table public.scientific_job_dependencies to authenticated;

insert into app_private.scientific_tools(
  tool_id, tool_version, display_name, category, runtime_kind, status,
  network_required, timeout_seconds, memory_mb, cpu_millicores, max_input_cells, parameter_schema
) values (
  'fasttree', '2.1.11-2', 'FastTree Approximate Maximum-Likelihood Phylogeny', 'phylogeny',
  'isolated_worker', 'approved', false, 300, 2048, 1000, 100000000,
  '{"model":{"enum":["gtr_cat","jtt_cat"]},"source":{"const":"completed_msa"}}'::jsonb
)
on conflict (tool_id, tool_version) do update set
  display_name=excluded.display_name,
  category=excluded.category,
  runtime_kind=excluded.runtime_kind,
  status=excluded.status,
  network_required=excluded.network_required,
  timeout_seconds=excluded.timeout_seconds,
  memory_mb=excluded.memory_mb,
  cpu_millicores=excluded.cpu_millicores,
  max_input_cells=excluded.max_input_cells,
  parameter_schema=excluded.parameter_schema;

insert into app_private.scientific_rate_limit_policies(action, window_seconds, user_limit, organization_limit)
values ('phylogenetic_tree', 3600, 10, 40)
on conflict (action) do update set
  window_seconds=excluded.window_seconds,
  user_limit=excluded.user_limit,
  organization_limit=excluded.organization_limit;

create or replace function app_private.request_phylogenetic_tree(
  p_project_id uuid,
  p_msa_job_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  source_job public.scientific_jobs%rowtype;
  tool app_private.scientific_tools%rowtype;
  source_sequence_type text;
  source_type_count integer;
  source_input_count integer;
  source_sequence_count integer;
  source_aligned_length integer;
  selected_model text;
  normalized_params jsonb;
  fingerprint text;
  existing_id uuid;
  new_id uuid;
  queue_message_id bigint;
  user_active integer;
  org_active integer;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  select organization_id into org_id from public.projects where id=p_project_id;
  if not found then raise exception 'project not found' using errcode='P0002'; end if;
  if not app_private.can_write_org(org_id) then raise exception 'project write access denied' using errcode='42501'; end if;

  select * into source_job from public.scientific_jobs
  where id=p_msa_job_id and project_id=p_project_id and organization_id=org_id for share;
  if not found then raise exception 'MSA job not found' using errcode='P0002'; end if;
  if source_job.job_type <> 'multiple_sequence_alignment' or source_job.status <> 'completed' then
    raise exception 'phylogeny requires a completed MSA job';
  end if;
  if source_job.result_object_path is null or source_job.result_sha256 is null or source_job.result_bytes is null
     or source_job.result_sha256 !~ '^[0-9a-f]{64}$' or source_job.result_bytes < 1 or source_job.result_bytes > 26214400 then
    raise exception 'MSA result artifact provenance is incomplete';
  end if;

  select count(*), count(distinct sequence_type), min(sequence_type)
    into source_input_count, source_type_count, source_sequence_type
  from public.scientific_job_inputs where job_id=source_job.id;
  if source_input_count < 3 or source_input_count > 50 or source_type_count <> 1
     or source_sequence_type not in ('dna','rna','protein') then
    raise exception 'MSA input provenance is not eligible for phylogeny';
  end if;

  begin
    source_sequence_count := (source_job.result_summary->>'sequence_count')::integer;
    source_aligned_length := (source_job.result_summary->>'aligned_length')::integer;
  exception when others then raise exception 'MSA result summary is invalid'; end;
  if source_sequence_count <> source_input_count or source_aligned_length < 1 or source_aligned_length > 500000 then
    raise exception 'MSA result dimensions are invalid for phylogeny';
  end if;

  selected_model := case when source_sequence_type in ('dna','rna') then 'gtr_cat' else 'jtt_cat' end;
  select * into tool from app_private.scientific_tools
  where tool_id='fasttree' and tool_version='2.1.11-2' and status='approved';
  if not found then raise exception 'approved FastTree tool is unavailable'; end if;

  normalized_params := jsonb_build_object(
    'model', selected_model,
    'source_msa_job_id', source_job.id,
    'source_result_object_path', source_job.result_object_path,
    'source_result_sha256', source_job.result_sha256,
    'source_result_bytes', source_job.result_bytes,
    'sequence_type', source_sequence_type,
    'sequence_count', source_sequence_count,
    'aligned_length', source_aligned_length
  );

  fingerprint := encode(extensions.digest(convert_to(concat_ws(E'\x1f',
    'phylogenetic_tree', p_project_id::text, source_job.id::text, source_job.result_sha256,
    tool.tool_id, tool.tool_version, normalized_params::text), 'UTF8'), 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint, 13271));

  select id into existing_id from public.scientific_jobs
  where organization_id=org_id and request_fingerprint=fingerprint
    and status in ('queued','running','validating_result') order by created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;

  perform app_private.consume_scientific_rate_limit('phylogenetic_tree', caller_id, org_id);
  select count(*) into user_active from public.scientific_jobs
  where requested_by=caller_id and status in ('queued','running','validating_result');
  select count(*) into org_active from public.scientific_jobs
  where organization_id=org_id and status in ('queued','running','validating_result');
  if user_active >= 5 or org_active >= 25 then
    raise sqlstate 'PGRST' using
      message=jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active scientific analyses. Wait for current jobs to finish.')::text,
      detail=jsonb_build_object('status',429)::text;
  end if;

  insert into public.scientific_jobs(
    organization_id, project_id, requested_by, job_type, tool_id, tool_version, parameters, request_fingerprint
  ) values (
    org_id, p_project_id, caller_id, 'phylogenetic_tree', tool.tool_id, tool.tool_version, normalized_params, fingerprint
  ) returning id into new_id;

  insert into public.scientific_job_dependencies(
    job_id, dependency_job_id, organization_id, project_id, dependency_role,
    dependency_result_sha256, dependency_result_object_path
  ) values (
    new_id, source_job.id, org_id, p_project_id, 'source_msa', source_job.result_sha256, source_job.result_object_path
  );

  select pgmq.send(queue_name=>'scientific_standard', msg=>jsonb_build_object('job_id',new_id,'job_type','phylogenetic_tree')) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue phylogenetic job'; end if;
  return new_id;
end;
$$;

create or replace function public.request_phylogenetic_tree(project_id uuid, msa_job_id uuid)
returns uuid language sql security invoker set search_path=''
as $$ select app_private.request_phylogenetic_tree(project_id, msa_job_id); $$;

revoke all on function app_private.request_phylogenetic_tree(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.request_phylogenetic_tree(uuid,uuid) to authenticated;
revoke all on function public.request_phylogenetic_tree(uuid,uuid) from public,anon,service_role;
grant execute on function public.request_phylogenetic_tree(uuid,uuid) to authenticated;

create or replace function app_private.finish_phylogenetic_job_success(
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
set search_path=''
as $$
declare
  target public.scientific_jobs%rowtype;
  dep public.scientific_job_dependencies%rowtype;
  expected_path text;
  leaf_count integer;
  internal_support_count integer;
begin
  select * into target from public.scientific_jobs where id=p_job_id for update;
  if not found or target.status <> 'running' or target.job_type <> 'phylogenetic_tree' then
    raise exception 'phylogenetic job is not active' using errcode='P0002';
  end if;
  if target.tool_id <> 'fasttree' or target.tool_version <> '2.1.11-2' then
    raise exception 'phylogenetic job tool provenance mismatch';
  end if;
  select * into dep from public.scientific_job_dependencies
  where job_id=target.id and dependency_role='source_msa';
  if not found then raise exception 'phylogenetic source MSA dependency is missing'; end if;
  if dep.dependency_result_sha256 is distinct from target.parameters->>'source_result_sha256'
     or dep.dependency_result_object_path is distinct from target.parameters->>'source_result_object_path'
     or dep.dependency_job_id::text is distinct from target.parameters->>'source_msa_job_id' then
    raise exception 'phylogenetic source dependency provenance mismatch';
  end if;

  expected_path := target.organization_id::text || '/' || target.project_id::text || '/' || target.id::text || '/tree-result.nwk';
  if p_result_object_path is distinct from expected_path then raise exception 'phylogenetic result path mismatch'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='analysis-results' and o.name=expected_path) then
    raise exception 'phylogenetic result artifact not found' using errcode='P0002';
  end if;
  if p_result_sha256 is null or p_result_sha256 !~ '^[0-9a-f]{64}$'
     or p_result_bytes is null or p_result_bytes < 4 or p_result_bytes > 26214400 then
    raise exception 'phylogenetic result integrity metadata is invalid';
  end if;
  if nullif(trim(p_executor_version),'') is null or char_length(trim(p_executor_version)) > 128 then
    raise exception 'phylogenetic executor provenance is invalid';
  end if;
  if p_result_summary is null or jsonb_typeof(p_result_summary)<>'object'
     or p_provenance is null or jsonb_typeof(p_provenance)<>'object' then
    raise exception 'phylogenetic result summary or provenance is invalid';
  end if;
  if p_result_summary->>'job_type' is distinct from 'phylogenetic_tree'
     or p_result_summary->>'source_msa_sha256' is distinct from dep.dependency_result_sha256
     or p_result_summary->>'model' is distinct from target.parameters->>'model' then
    raise exception 'phylogenetic normalized result provenance mismatch';
  end if;
  begin
    leaf_count := (p_result_summary->>'leaf_count')::integer;
    internal_support_count := (p_result_summary->>'internal_support_count')::integer;
  exception when others then raise exception 'phylogenetic result metrics are invalid'; end;
  if leaf_count <> (target.parameters->>'sequence_count')::integer
     or leaf_count < 3 or leaf_count > 50
     or internal_support_count < 0 or internal_support_count > leaf_count-2 then
    raise exception 'phylogenetic result metrics are outside approved bounds';
  end if;
  if p_provenance->>'tool_id' is distinct from target.tool_id
     or p_provenance->>'tool_version' is distinct from target.tool_version
     or p_provenance->>'executor_version' is distinct from trim(p_executor_version)
     or p_provenance->>'request_fingerprint' is distinct from target.request_fingerprint
     or p_provenance->>'source_msa_sha256' is distinct from dep.dependency_result_sha256 then
    raise exception 'phylogenetic provenance mismatch';
  end if;

  update public.scientific_jobs
     set status='completed', executor_version=trim(p_executor_version), result_object_path=expected_path,
         result_sha256=p_result_sha256, result_bytes=p_result_bytes, result_summary=p_result_summary,
         provenance=p_provenance, processing_finished_at=now(), processing_error=null, failure_class=null, updated_at=now()
   where id=target.id;
  if not pgmq.delete('scientific_standard', p_message_id) then raise exception 'scientific queue message delete failed'; end if;
end;
$$;

create or replace function public.finish_phylogenetic_job_success(
  message_id bigint,
  job_id uuid,
  executor_version text,
  result_object_path text,
  result_sha256 text,
  result_bytes bigint,
  result_summary jsonb,
  provenance jsonb
)
returns void language sql security invoker set search_path=''
as $$
  select app_private.finish_phylogenetic_job_success(message_id,job_id,executor_version,result_object_path,result_sha256,result_bytes,result_summary,provenance);
$$;

revoke all on function app_private.finish_phylogenetic_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function app_private.finish_phylogenetic_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) to service_role;
revoke all on function public.finish_phylogenetic_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_phylogenetic_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) to service_role;
