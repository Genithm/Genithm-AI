select pgmq.create('scientific_standard');

create table app_private.scientific_tools (
  tool_id text not null,
  tool_version text not null,
  display_name text not null,
  category text not null,
  runtime_kind text not null,
  status text not null,
  network_required boolean not null default false,
  timeout_seconds integer not null,
  memory_mb integer not null,
  cpu_millicores integer not null,
  max_input_cells bigint not null,
  parameter_schema jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (tool_id, tool_version),
  constraint scientific_tools_id check (tool_id ~ '^[a-z0-9_-]{3,64}$'),
  constraint scientific_tools_version check (char_length(tool_version) between 1 and 64),
  constraint scientific_tools_category check (category ~ '^[a-z0-9_-]{3,64}$'),
  constraint scientific_tools_runtime check (runtime_kind in ('isolated_worker','container')),
  constraint scientific_tools_status check (status in ('approved','deprecated','disabled')),
  constraint scientific_tools_timeout check (timeout_seconds between 1 and 86400),
  constraint scientific_tools_memory check (memory_mb between 64 and 1048576),
  constraint scientific_tools_cpu check (cpu_millicores between 100 and 128000),
  constraint scientific_tools_cells check (max_input_cells between 1 and 1000000000000),
  constraint scientific_tools_parameter_schema check (jsonb_typeof(parameter_schema)='object')
);

alter table app_private.scientific_tools enable row level security;
alter table app_private.scientific_tools force row level security;
create policy scientific_tools_deny_api on app_private.scientific_tools as restrictive for all to public using (false) with check (false);
revoke all on table app_private.scientific_tools from public, anon, authenticated, service_role;

insert into app_private.scientific_tools(tool_id,tool_version,display_name,category,runtime_kind,status,network_required,timeout_seconds,memory_mb,cpu_millicores,max_input_cells,parameter_schema)
values ('genithm-pairwise-aligner','0.1.0','Genithm Pairwise Aligner','alignment','isolated_worker','approved',false,120,512,1000,9000000,
'{"algorithm":{"enum":["global","local"]},"match_score":{"min":1,"max":10},"mismatch_score":{"min":-10,"max":0},"gap_score":{"min":-20,"max":-1}}'::jsonb);

create table public.scientific_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  job_type text not null,
  tool_id text not null,
  tool_version text not null,
  status text not null default 'queued',
  parameters jsonb not null default '{}'::jsonb,
  request_fingerprint text not null,
  processing_attempts integer not null default 0,
  executor_version text,
  result_object_path text unique,
  result_sha256 text,
  result_bytes bigint,
  result_summary jsonb,
  provenance jsonb,
  failure_class text,
  processing_error text,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scientific_jobs_project_org_fkey foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  constraint scientific_jobs_tool_fkey foreign key (tool_id, tool_version) references app_private.scientific_tools(tool_id, tool_version) on delete restrict,
  constraint scientific_jobs_id_project_org_key unique (id, project_id, organization_id),
  constraint scientific_jobs_type check (job_type in ('pairwise_alignment')),
  constraint scientific_jobs_status check (status in ('queued','running','validating_result','completed','error','cancelled')),
  constraint scientific_jobs_parameters check (jsonb_typeof(parameters)='object'),
  constraint scientific_jobs_fingerprint check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint scientific_jobs_attempts check (processing_attempts >= 0),
  constraint scientific_jobs_result_sha check (result_sha256 is null or result_sha256 ~ '^[0-9a-f]{64}$'),
  constraint scientific_jobs_result_bytes check (result_bytes is null or result_bytes between 1 and 26214400),
  constraint scientific_jobs_result_summary check (result_summary is null or jsonb_typeof(result_summary)='object'),
  constraint scientific_jobs_provenance check (provenance is null or jsonb_typeof(provenance)='object'),
  constraint scientific_jobs_failure_class check (failure_class is null or failure_class in ('input_integrity','execution','output_validation','infrastructure')),
  constraint scientific_jobs_error_length check (processing_error is null or char_length(processing_error) <= 2000)
);

create unique index scientific_jobs_active_fingerprint_idx on public.scientific_jobs(organization_id, request_fingerprint) where status in ('queued','running','validating_result');
create index scientific_jobs_org_created_idx on public.scientific_jobs(organization_id, created_at desc);
create index scientific_jobs_project_created_idx on public.scientific_jobs(project_id, created_at desc);
create index scientific_jobs_requested_by_idx on public.scientific_jobs(requested_by, created_at desc);
create index scientific_jobs_status_idx on public.scientific_jobs(status, created_at);

alter table public.scientific_jobs enable row level security;
alter table public.scientific_jobs force row level security;
create policy scientific_jobs_select_org_member on public.scientific_jobs for select to authenticated using ((select app_private.is_org_member(organization_id)));
revoke all on table public.scientific_jobs from public, anon, authenticated, service_role;
grant select on table public.scientific_jobs to authenticated;

create table public.scientific_job_inputs (
  job_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  input_position smallint not null,
  input_role text not null,
  sequence_upload_id uuid not null,
  input_sha256 text not null,
  sequence_type text not null,
  residue_count bigint not null,
  created_at timestamptz not null default now(),
  primary key (job_id, input_position),
  constraint scientific_job_inputs_job_fkey foreign key (job_id, project_id, organization_id) references public.scientific_jobs(id, project_id, organization_id) on delete cascade,
  constraint scientific_job_inputs_upload_fkey foreign key (sequence_upload_id, project_id, organization_id) references public.sequence_uploads(id, project_id, organization_id) on delete restrict,
  constraint scientific_job_inputs_position check (input_position between 1 and 32),
  constraint scientific_job_inputs_role check (input_role ~ '^[a-z0-9_]{2,64}$'),
  constraint scientific_job_inputs_sha check (input_sha256 ~ '^[0-9a-f]{64}$'),
  constraint scientific_job_inputs_type check (sequence_type in ('dna','rna','protein')),
  constraint scientific_job_inputs_residues check (residue_count > 0)
);

create index scientific_job_inputs_org_idx on public.scientific_job_inputs(organization_id);
create index scientific_job_inputs_project_org_idx on public.scientific_job_inputs(project_id, organization_id);
create index scientific_job_inputs_upload_idx on public.scientific_job_inputs(sequence_upload_id);

alter table public.scientific_job_inputs enable row level security;
alter table public.scientific_job_inputs force row level security;
create policy scientific_job_inputs_select_org_member on public.scientific_job_inputs for select to authenticated using ((select app_private.is_org_member(organization_id)));
revoke all on table public.scientific_job_inputs from public, anon, authenticated, service_role;
grant select on table public.scientific_job_inputs to authenticated;

insert into app_private.scientific_rate_limit_policies(action,window_seconds,user_limit,organization_limit)
values ('pairwise_alignment',3600,30,120)
on conflict (action) do update set window_seconds=excluded.window_seconds,user_limit=excluded.user_limit,organization_limit=excluded.organization_limit;

create or replace function app_private.request_pairwise_alignment(p_project_id uuid,p_sequence_a_id uuid,p_sequence_b_id uuid,p_algorithm text default 'global',p_match_score integer default 2,p_mismatch_score integer default -1,p_gap_score integer default -2)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  caller_id uuid := auth.uid(); org_id uuid; a public.sequence_uploads%rowtype; b public.sequence_uploads%rowtype; tool app_private.scientific_tools%rowtype;
  normalized_algorithm text := lower(trim(p_algorithm)); normalized_params jsonb; fingerprint text; existing_id uuid; new_id uuid; queue_message_id bigint; user_active integer; org_active integer;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  select organization_id into org_id from public.projects where id=p_project_id;
  if not found then raise exception 'project not found' using errcode='P0002'; end if;
  if not app_private.can_write_org(org_id) then raise exception 'project write access denied' using errcode='42501'; end if;
  if normalized_algorithm not in ('global','local') then raise exception 'unsupported pairwise alignment algorithm'; end if;
  if p_match_score not between 1 and 10 or p_mismatch_score not between -10 and 0 or p_gap_score not between -20 and -1 then raise exception 'invalid pairwise scoring parameters'; end if;
  select * into a from public.sequence_uploads where id=p_sequence_a_id and project_id=p_project_id and organization_id=org_id;
  if not found then raise exception 'sequence A not found' using errcode='P0002'; end if;
  select * into b from public.sequence_uploads where id=p_sequence_b_id and project_id=p_project_id and organization_id=org_id;
  if not found then raise exception 'sequence B not found' using errcode='P0002'; end if;
  if a.status <> 'ready' or b.status <> 'ready' or a.sha256 is null or b.sha256 is null or a.sequence_count <> 1 or b.sequence_count <> 1 then raise exception 'pairwise alignment requires two validated single-record sequences'; end if;
  if a.sequence_type not in ('dna','rna','protein') or b.sequence_type <> a.sequence_type then raise exception 'pairwise alignment requires matching validated sequence types'; end if;
  if a.residue_count is null or b.residue_count is null or a.residue_count < 1 or b.residue_count < 1 or a.residue_count > 10000 or b.residue_count > 10000 or (a.residue_count*b.residue_count) > 9000000 then raise exception 'pairwise alignment input exceeds V1 compute bounds'; end if;
  if a.file_size_bytes > 2097152 or b.file_size_bytes > 2097152 then raise exception 'pairwise alignment input file exceeds worker read limit'; end if;
  if coalesce(a.validation_warnings,'[]'::jsonb) ? 'gap_characters_present' or coalesce(b.validation_warnings,'[]'::jsonb) ? 'gap_characters_present' then raise exception 'pairwise alignment requires ungapped input sequences'; end if;
  select * into tool from app_private.scientific_tools where tool_id='genithm-pairwise-aligner' and tool_version='0.1.0' and status='approved';
  if not found then raise exception 'approved pairwise alignment tool is unavailable'; end if;
  normalized_params := jsonb_build_object('algorithm',normalized_algorithm,'match_score',p_match_score,'mismatch_score',p_mismatch_score,'gap_score',p_gap_score);
  fingerprint := encode(extensions.digest(convert_to(concat_ws(E'\x1f','pairwise_alignment',p_project_id::text,a.id::text,a.sha256,b.id::text,b.sha256,tool.tool_id,tool.tool_version,normalized_params::text),'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,9173));
  select id into existing_id from public.scientific_jobs where organization_id=org_id and request_fingerprint=fingerprint and status in ('queued','running','validating_result') order by created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;
  perform app_private.consume_scientific_rate_limit('pairwise_alignment',caller_id,org_id);
  select count(*) into user_active from public.scientific_jobs where requested_by=caller_id and status in ('queued','running','validating_result');
  select count(*) into org_active from public.scientific_jobs where organization_id=org_id and status in ('queued','running','validating_result');
  if user_active >= 5 or org_active >= 25 then raise sqlstate 'PGRST' using message=jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active scientific analyses. Wait for current jobs to finish.')::text, detail=jsonb_build_object('status',429)::text; end if;
  insert into public.scientific_jobs(organization_id,project_id,requested_by,job_type,tool_id,tool_version,parameters,request_fingerprint)
  values(org_id,p_project_id,caller_id,'pairwise_alignment',tool.tool_id,tool.tool_version,normalized_params,fingerprint) returning id into new_id;
  insert into public.scientific_job_inputs(job_id,organization_id,project_id,input_position,input_role,sequence_upload_id,input_sha256,sequence_type,residue_count)
  values (new_id,org_id,p_project_id,1,'sequence_a',a.id,a.sha256,a.sequence_type,a.residue_count),(new_id,org_id,p_project_id,2,'sequence_b',b.id,b.sha256,b.sequence_type,b.residue_count);
  select pgmq.send(queue_name=>'scientific_standard',msg=>jsonb_build_object('job_id',new_id,'job_type','pairwise_alignment')) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue scientific job'; end if;
  return new_id;
end;$$;

create or replace function public.request_pairwise_alignment(project_id uuid,sequence_a_id uuid,sequence_b_id uuid,algorithm text default 'global',match_score integer default 2,mismatch_score integer default -1,gap_score integer default -2)
returns uuid language sql security invoker set search_path='' as $$ select app_private.request_pairwise_alignment(project_id,sequence_a_id,sequence_b_id,algorithm,match_score,mismatch_score,gap_score); $$;

create or replace function app_private.claim_scientific_job(p_visibility_seconds integer default 300)
returns table(message_id bigint,job_id uuid,organization_id uuid,project_id uuid,requested_by uuid,job_type text,tool_id text,tool_version text,parameters jsonb,request_fingerprint text,inputs jsonb)
language plpgsql security definer set search_path='' as $$
declare q record; target public.scientific_jobs%rowtype; target_id uuid; payload_type text; input_rows jsonb; tool_status text;
begin
  if p_visibility_seconds < 60 or p_visibility_seconds > 900 then raise exception 'visibility timeout must be between 60 and 900 seconds'; end if;
  select * into q from pgmq.read(queue_name=>'scientific_standard',vt=>p_visibility_seconds,qty=>1) limit 1;
  if not found then return; end if;
  begin target_id := (q.message->>'job_id')::uuid; payload_type := q.message->>'job_type'; exception when others then perform pgmq.delete('scientific_standard',q.msg_id); return; end;
  select * into target from public.scientific_jobs where id=target_id for update;
  if not found or target.status <> 'queued' or payload_type is distinct from target.job_type then perform pgmq.delete('scientific_standard',q.msg_id); return; end if;
  select status into tool_status from app_private.scientific_tools where tool_id=target.tool_id and tool_version=target.tool_version;
  if tool_status is null or tool_status='disabled' then update public.scientific_jobs set status='error',failure_class='execution',processing_error='Approved scientific tool is unavailable.',processing_finished_at=now(),updated_at=now() where id=target.id; perform pgmq.delete('scientific_standard',q.msg_id); return; end if;
  update public.scientific_jobs set status='running',processing_attempts=processing_attempts+1,processing_started_at=coalesce(processing_started_at,now()),processing_error=null,failure_class=null,updated_at=now() where id=target.id returning * into target;
  select jsonb_agg(jsonb_build_object('position',i.input_position,'role',i.input_role,'upload_id',i.sequence_upload_id,'object_path',u.object_path,'file_size_bytes',u.file_size_bytes,'sha256',i.input_sha256,'sequence_type',i.sequence_type,'residue_count',i.residue_count) order by i.input_position)
  into input_rows from public.scientific_job_inputs i join public.sequence_uploads u on u.id=i.sequence_upload_id where i.job_id=target.id;
  if input_rows is null or jsonb_array_length(input_rows) <> 2 then raise exception 'scientific job inputs are incomplete'; end if;
  return query select q.msg_id::bigint,target.id,target.organization_id,target.project_id,target.requested_by,target.job_type,target.tool_id,target.tool_version,target.parameters,target.request_fingerprint,input_rows;
end;$$;

create or replace function public.claim_scientific_job(visibility_seconds integer default 300)
returns table(message_id bigint,job_id uuid,organization_id uuid,project_id uuid,requested_by uuid,job_type text,tool_id text,tool_version text,parameters jsonb,request_fingerprint text,inputs jsonb)
language sql security invoker set search_path='' as $$ select * from app_private.claim_scientific_job(visibility_seconds); $$;

create or replace function app_private.finish_scientific_job_success(p_message_id bigint,p_job_id uuid,p_executor_version text,p_result_object_path text,p_result_sha256 text,p_result_bytes bigint,p_result_summary jsonb,p_provenance jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare target public.scientific_jobs%rowtype; expected_path text; a_sha text; b_sha text; aligned_length integer; identity numeric;
begin
  select * into target from public.scientific_jobs where id=p_job_id for update;
  if not found or target.status <> 'running' then raise exception 'scientific job is not active' using errcode='P0002'; end if;
  expected_path := target.organization_id::text || '/' || target.project_id::text || '/' || target.id::text || '/pairwise-result.json';
  if target.job_type <> 'pairwise_alignment' or p_result_object_path is distinct from expected_path then raise exception 'scientific result object path mismatch'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='analysis-results' and o.name=expected_path) then raise exception 'scientific result artifact not found' using errcode='P0002'; end if;
  if p_result_sha256 is null or p_result_sha256 !~ '^[0-9a-f]{64}$' or p_result_bytes is null or p_result_bytes < 1 or p_result_bytes > 26214400 then raise exception 'scientific result integrity metadata is invalid'; end if;
  if nullif(trim(p_executor_version),'') is null or char_length(trim(p_executor_version)) > 128 then raise exception 'scientific executor provenance is invalid'; end if;
  if p_result_summary is null or jsonb_typeof(p_result_summary)<>'object' or p_provenance is null or jsonb_typeof(p_provenance)<>'object' then raise exception 'scientific normalized result or provenance is invalid'; end if;
  select input_sha256 into a_sha from public.scientific_job_inputs where job_id=target.id and input_position=1;
  select input_sha256 into b_sha from public.scientific_job_inputs where job_id=target.id and input_position=2;
  if p_result_summary->>'job_type' is distinct from target.job_type or p_result_summary->>'input_a_sha256' is distinct from a_sha or p_result_summary->>'input_b_sha256' is distinct from b_sha or p_result_summary->>'algorithm' is distinct from target.parameters->>'algorithm' then raise exception 'scientific result input or parameter provenance mismatch'; end if;
  begin aligned_length := (p_result_summary->>'aligned_length')::integer; identity := (p_result_summary->>'identity_percent')::numeric; exception when others then raise exception 'scientific result metrics are invalid'; end;
  if aligned_length < 0 or identity < 0 or identity > 100 then raise exception 'scientific result metrics are outside valid bounds'; end if;
  if p_provenance->>'tool_id' is distinct from target.tool_id or p_provenance->>'tool_version' is distinct from target.tool_version or p_provenance->>'executor_version' is distinct from trim(p_executor_version) or p_provenance->>'request_fingerprint' is distinct from target.request_fingerprint then raise exception 'scientific provenance mismatch'; end if;
  update public.scientific_jobs set status='completed',executor_version=trim(p_executor_version),result_object_path=expected_path,result_sha256=p_result_sha256,result_bytes=p_result_bytes,result_summary=p_result_summary,provenance=p_provenance,processing_finished_at=now(),processing_error=null,failure_class=null,updated_at=now() where id=target.id;
  if not pgmq.delete('scientific_standard',p_message_id) then raise exception 'scientific queue message delete failed'; end if;
end;$$;

create or replace function public.finish_scientific_job_success(message_id bigint,job_id uuid,executor_version text,result_object_path text,result_sha256 text,result_bytes bigint,result_summary jsonb,provenance jsonb)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_scientific_job_success(message_id,job_id,executor_version,result_object_path,result_sha256,result_bytes,result_summary,provenance); $$;

create or replace function app_private.finish_scientific_job_error(p_message_id bigint,p_job_id uuid,p_failure_class text,p_processing_error text,p_retryable boolean default false,p_max_attempts integer default 3)
returns text language plpgsql security definer set search_path='' as $$
declare target public.scientific_jobs%rowtype; new_message bigint; safe_error text;
begin
  if p_failure_class not in ('input_integrity','execution','output_validation','infrastructure') then raise exception 'invalid scientific failure class'; end if;
  if p_max_attempts < 1 or p_max_attempts > 10 then raise exception 'invalid max attempts'; end if;
  safe_error := left(coalesce(nullif(trim(p_processing_error),''),'Scientific job failed.'),2000);
  select * into target from public.scientific_jobs where id=p_job_id for update;
  if not found then perform pgmq.delete('scientific_standard',p_message_id); return 'discarded'; end if;
  if target.status='completed' then perform pgmq.delete('scientific_standard',p_message_id); return 'completed'; end if;
  if target.status <> 'running' then perform pgmq.delete('scientific_standard',p_message_id); return 'discarded'; end if;
  if p_retryable and target.processing_attempts < p_max_attempts then
    update public.scientific_jobs set status='queued',failure_class=p_failure_class,processing_error=safe_error,updated_at=now() where id=target.id;
    if not pgmq.delete('scientific_standard',p_message_id) then raise exception 'scientific queue delete failed'; end if;
    select pgmq.send(queue_name=>'scientific_standard',msg=>jsonb_build_object('job_id',target.id,'job_type',target.job_type),delay=>30) into new_message;
    if new_message is null then raise exception 'scientific retry enqueue failed'; end if;
    return 'retry';
  end if;
  update public.scientific_jobs set status='error',failure_class=p_failure_class,processing_error=safe_error,processing_finished_at=now(),updated_at=now() where id=target.id;
  perform pgmq.delete('scientific_standard',p_message_id);
  return 'error';
end;$$;

create or replace function public.finish_scientific_job_error(message_id bigint,job_id uuid,failure_class text,processing_error text,retryable boolean default false,max_attempts integer default 3)
returns text language sql security invoker set search_path='' as $$ select app_private.finish_scientific_job_error(message_id,job_id,failure_class,processing_error,retryable,max_attempts); $$;

create or replace function app_private.audit_scientific_job_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=auth.uid(); actor_kind text; event_name text; event_outcome text; details jsonb;
begin
  actor_id:=coalesce(actor_id,new.requested_by); actor_kind:=case when auth.uid() is null then 'service' else 'user' end;
  if tg_op='INSERT' then event_name:='SCIENTIFIC_JOB_CREATED'; event_outcome:='created'; details:=jsonb_build_object('job_type',new.job_type,'tool_id',new.tool_id,'tool_version',new.tool_version,'request_fingerprint',new.request_fingerprint,'status',new.status);
  elsif new.status is distinct from old.status then event_name:='SCIENTIFIC_JOB_STATUS_CHANGED'; event_outcome:=case when new.status='completed' then 'completed' when new.status in ('error','cancelled') then 'failed' else 'state_change' end; details:=jsonb_strip_nulls(jsonb_build_object('from_status',old.status,'to_status',new.status,'tool_id',new.tool_id,'tool_version',new.tool_version,'executor_version',new.executor_version,'result_sha256',new.result_sha256,'failure_class',new.failure_class));
  else return new; end if;
  perform app_private.append_audit_event(new.organization_id,new.project_id,actor_id,actor_kind,event_name,'scientific_job',new.id::text,event_outcome,details); return new;
end;$$;
create trigger scientific_jobs_audit_events after insert or update on public.scientific_jobs for each row execute function app_private.audit_scientific_job_change();

drop policy analysis_results_select_project_member on storage.objects;
create policy analysis_results_select_project_member on storage.objects for select to authenticated using (
  bucket_id='analysis-results' and (
    exists(select 1 from public.blast_jobs bj where bj.result_object_path=objects.name and (select app_private.is_org_member(bj.organization_id)))
    or exists(select 1 from public.scientific_jobs sj where sj.result_object_path=objects.name and (select app_private.is_org_member(sj.organization_id)))
  )
);

revoke all on function app_private.request_pairwise_alignment(uuid,uuid,uuid,text,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function app_private.request_pairwise_alignment(uuid,uuid,uuid,text,integer,integer,integer) to authenticated;
revoke all on function public.request_pairwise_alignment(uuid,uuid,uuid,text,integer,integer,integer) from public,anon,service_role;
grant execute on function public.request_pairwise_alignment(uuid,uuid,uuid,text,integer,integer,integer) to authenticated;
revoke all on function app_private.claim_scientific_job(integer) from public,anon,authenticated;
revoke all on function app_private.finish_scientific_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function app_private.finish_scientific_job_error(bigint,uuid,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function app_private.claim_scientific_job(integer) to service_role;
grant execute on function app_private.finish_scientific_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) to service_role;
grant execute on function app_private.finish_scientific_job_error(bigint,uuid,text,text,boolean,integer) to service_role;
revoke all on function public.claim_scientific_job(integer) from public,anon,authenticated;
revoke all on function public.finish_scientific_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.finish_scientific_job_error(bigint,uuid,text,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.claim_scientific_job(integer) to service_role;
grant execute on function public.finish_scientific_job_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) to service_role;
grant execute on function public.finish_scientific_job_error(bigint,uuid,text,text,boolean,integer) to service_role;
