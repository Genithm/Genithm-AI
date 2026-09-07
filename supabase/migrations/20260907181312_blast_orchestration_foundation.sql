select pgmq.create('blast_remote');

alter table public.sequence_uploads
  add constraint sequence_uploads_id_project_org_key unique (id, project_id, organization_id);

create table public.blast_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  query_upload_id uuid not null,
  service_provider text not null default 'ncbi',
  service_mode text not null default 'common_url_api',
  program text not null,
  database_name text not null,
  expect_value numeric not null default 10,
  max_targets integer not null default 20,
  low_complexity_filter boolean not null default true,
  status text not null default 'queued',
  query_sha256 text not null,
  remote_rid text,
  remote_rtoe_seconds integer,
  next_poll_at timestamptz,
  poll_count integer not null default 0,
  submission_attempts integer not null default 0,
  transient_error_count integer not null default 0,
  service_version text,
  blast_version text,
  database_reported text,
  database_release text,
  result_object_path text unique,
  raw_result_sha256 text,
  raw_result_bytes bigint,
  result_summary jsonb,
  normalized_hits jsonb,
  submitted_at timestamptz,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blast_jobs_project_org_fkey foreign key (project_id, organization_id) references public.projects(id, organization_id) on delete cascade,
  constraint blast_jobs_query_project_org_fkey foreign key (query_upload_id, project_id, organization_id) references public.sequence_uploads(id, project_id, organization_id) on delete restrict,
  constraint blast_jobs_service check (service_provider = 'ncbi' and service_mode = 'common_url_api'),
  constraint blast_jobs_program_database check ((program = 'blastn' and database_name = 'core_nt') or (program = 'blastp' and database_name = 'swissprot')),
  constraint blast_jobs_expect check (expect_value >= 1e-180 and expect_value <= 1000),
  constraint blast_jobs_max_targets check (max_targets between 1 and 20),
  constraint blast_jobs_status check (status in ('queued','submitting','remote_pending','retrieving','completed','error')),
  constraint blast_jobs_query_sha check (query_sha256 ~ '^[0-9a-f]{64}$'),
  constraint blast_jobs_remote_rid check (remote_rid is null or remote_rid ~ '^[A-Za-z0-9_-]{5,128}$'),
  constraint blast_jobs_remote_rtoe check (remote_rtoe_seconds is null or remote_rtoe_seconds between 0 and 21600),
  constraint blast_jobs_counters check (poll_count >= 0 and submission_attempts >= 0 and transient_error_count >= 0),
  constraint blast_jobs_raw_result_sha check (raw_result_sha256 is null or raw_result_sha256 ~ '^[0-9a-f]{64}$'),
  constraint blast_jobs_raw_result_bytes check (raw_result_bytes is null or raw_result_bytes between 1 and 26214400),
  constraint blast_jobs_result_summary_object check (result_summary is null or jsonb_typeof(result_summary) = 'object'),
  constraint blast_jobs_hits_array check (normalized_hits is null or jsonb_typeof(normalized_hits) = 'array'),
  constraint blast_jobs_error_length check (processing_error is null or char_length(processing_error) <= 2000),
  constraint blast_jobs_lifecycle check (
    (status in ('queued','submitting') and remote_rid is null and processing_finished_at is null)
    or (status in ('remote_pending','retrieving') and remote_rid is not null and submitted_at is not null and processing_finished_at is null)
    or (status = 'completed' and remote_rid is not null and submitted_at is not null and processing_finished_at is not null and result_object_path is not null and raw_result_sha256 is not null and raw_result_bytes is not null and nullif(trim(service_version), '') is not null and nullif(trim(blast_version), '') is not null and result_summary is not null and normalized_hits is not null and processing_error is null)
    or (status = 'error' and processing_finished_at is not null and processing_error is not null)
  )
);

create index blast_jobs_project_created_idx on public.blast_jobs(project_id, created_at desc);
create index blast_jobs_project_org_idx on public.blast_jobs(project_id, organization_id);
create index blast_jobs_query_project_org_idx on public.blast_jobs(query_upload_id, project_id, organization_id);
create index blast_jobs_requested_by_idx on public.blast_jobs(requested_by);
create index blast_jobs_status_poll_idx on public.blast_jobs(status, next_poll_at) where status in ('queued','remote_pending');
create unique index blast_jobs_active_dedupe_idx on public.blast_jobs(query_upload_id, program, database_name, expect_value, max_targets, low_complexity_filter) where status in ('queued','submitting','remote_pending','retrieving');

create trigger blast_jobs_set_updated_at before update on public.blast_jobs for each row execute function app_private.set_updated_at();

alter table public.blast_jobs enable row level security;
alter table public.blast_jobs force row level security;
create policy blast_jobs_select_project_member on public.blast_jobs for select to authenticated using (app_private.is_org_member(organization_id));
revoke all on table public.blast_jobs from anon, authenticated;
grant select on table public.blast_jobs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('analysis-results', 'analysis-results', false, 26214400, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy analysis_results_select_project_member on storage.objects for select to authenticated
using (bucket_id = 'analysis-results' and exists (select 1 from public.blast_jobs bj where bj.result_object_path = name and app_private.is_org_member(bj.organization_id)));

create or replace function app_private.request_blast_job(
  p_project_id uuid, p_query_upload_id uuid, p_program text, p_database_name text,
  p_expect_value numeric default 10, p_max_targets integer default 20, p_low_complexity_filter boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid(); org_id uuid; upload_row public.sequence_uploads%rowtype;
  normalized_program text := lower(trim(p_program)); normalized_database text := lower(trim(p_database_name));
  existing_id uuid; job_id uuid; queue_message_id bigint; lock_key text;
begin
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select p.organization_id into org_id from public.projects p where p.id = p_project_id;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  if not app_private.can_write_org(org_id) then raise exception 'project write access denied' using errcode = '42501'; end if;
  select * into upload_row from public.sequence_uploads where id = p_query_upload_id and project_id = p_project_id and organization_id = org_id;
  if not found then raise exception 'query sequence not found' using errcode = 'P0002'; end if;
  if upload_row.status <> 'ready' or upload_row.sha256 is null or upload_row.sequence_count <> 1 or upload_row.residue_count is null or upload_row.residue_count < 10 or upload_row.residue_count > 20000 then raise exception 'BLAST V1 requires one validated sequence between 10 and 20000 residues/bases'; end if;
  if normalized_program = 'blastn' then
    if normalized_database <> 'core_nt' or upload_row.sequence_type not in ('dna','rna') then raise exception 'blastn V1 requires a DNA/RNA query and core_nt database'; end if;
    if upload_row.residue_count < 30 then raise exception 'blastn V1 requires at least 30 bases'; end if;
  elsif normalized_program = 'blastp' then
    if normalized_database <> 'swissprot' or upload_row.sequence_type <> 'protein' then raise exception 'blastp V1 requires a protein query and swissprot database'; end if;
  else raise exception 'unsupported BLAST program'; end if;
  if p_expect_value is null or p_expect_value < 1e-180 or p_expect_value > 1000 then raise exception 'E-value must be between 1e-180 and 1000'; end if;
  if p_max_targets is null or p_max_targets < 1 or p_max_targets > 20 then raise exception 'max targets must be between 1 and 20'; end if;
  lock_key := p_query_upload_id::text || '|' || normalized_program || '|' || normalized_database || '|' || p_expect_value::text || '|' || p_max_targets::text || '|' || p_low_complexity_filter::text;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_key, 0));
  select bj.id into existing_id from public.blast_jobs bj where bj.query_upload_id = p_query_upload_id and bj.program = normalized_program and bj.database_name = normalized_database and bj.expect_value = p_expect_value and bj.max_targets = p_max_targets and bj.low_complexity_filter = p_low_complexity_filter and bj.status in ('queued','submitting','remote_pending','retrieving') order by bj.created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;
  insert into public.blast_jobs (organization_id, project_id, requested_by, query_upload_id, program, database_name, expect_value, max_targets, low_complexity_filter, query_sha256)
  values (org_id, p_project_id, caller_id, p_query_upload_id, normalized_program, normalized_database, p_expect_value, p_max_targets, p_low_complexity_filter, upload_row.sha256) returning id into job_id;
  select pgmq.send(queue_name => 'blast_remote', msg => jsonb_build_object('job_id', job_id, 'stage', 'submit')) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue BLAST job'; end if;
  return job_id;
end; $$;

create or replace function public.request_blast_job(project_id uuid, query_upload_id uuid, program text, database_name text, expect_value numeric default 10, max_targets integer default 20, low_complexity_filter boolean default true)
returns uuid language sql security invoker set search_path = '' as $$ select app_private.request_blast_job(project_id, query_upload_id, program, database_name, expect_value, max_targets, low_complexity_filter); $$;
revoke all on function app_private.request_blast_job(uuid, uuid, text, text, numeric, integer, boolean) from public, anon;
grant execute on function app_private.request_blast_job(uuid, uuid, text, text, numeric, integer, boolean) to authenticated;
revoke all on function public.request_blast_job(uuid, uuid, text, text, numeric, integer, boolean) from public, anon;
grant execute on function public.request_blast_job(uuid, uuid, text, text, numeric, integer, boolean) to authenticated;

create or replace function app_private.claim_blast_job(p_visibility_seconds integer default 300)
returns table (message_id bigint, stage text, job_id uuid, organization_id uuid, project_id uuid, requested_by uuid, query_upload_id uuid, query_object_path text, query_file_size_bytes bigint, query_sha256 text, program text, database_name text, expect_value text, max_targets integer, low_complexity_filter boolean, remote_rid text)
language plpgsql security definer set search_path = '' as $$
declare queue_row record; stage_name text; target_id uuid; target public.blast_jobs%rowtype; upload_row public.sequence_uploads%rowtype; delay_seconds integer;
begin
  if p_visibility_seconds < 60 or p_visibility_seconds > 900 then raise exception 'visibility timeout must be between 60 and 900 seconds'; end if;
  select * into queue_row from pgmq.read(queue_name => 'blast_remote', vt => p_visibility_seconds, qty => 1) limit 1;
  if not found then return; end if;
  begin target_id := (queue_row.message->>'job_id')::uuid; stage_name := queue_row.message->>'stage'; exception when others then perform pgmq.delete('blast_remote', queue_row.msg_id); return; end;
  if stage_name not in ('submit','poll') then perform pgmq.delete('blast_remote', queue_row.msg_id); return; end if;
  select * into target from public.blast_jobs where id = target_id for update;
  if not found then perform pgmq.delete('blast_remote', queue_row.msg_id); return; end if;
  if stage_name = 'submit' then
    if target.status <> 'queued' then perform pgmq.delete('blast_remote', queue_row.msg_id); return; end if;
    update public.blast_jobs set status='submitting', submission_attempts=submission_attempts+1, processing_started_at=coalesce(processing_started_at,now()), processing_error=null, updated_at=now() where id=target.id returning * into target;
  else
    if target.status <> 'remote_pending' or target.remote_rid is null then perform pgmq.delete('blast_remote', queue_row.msg_id); return; end if;
    if target.next_poll_at is not null and target.next_poll_at > now() then delay_seconds := greatest(1, ceil(extract(epoch from (target.next_poll_at-now())))::integer); perform pgmq.delete('blast_remote', queue_row.msg_id); perform pgmq.send('blast_remote', jsonb_build_object('job_id',target.id,'stage','poll'), delay_seconds); return; end if;
    update public.blast_jobs set status='retrieving', poll_count=poll_count+1, updated_at=now() where id=target.id returning * into target;
  end if;
  select * into upload_row from public.sequence_uploads where id=target.query_upload_id;
  if not found then raise exception 'BLAST query upload missing' using errcode='P0002'; end if;
  return query select queue_row.msg_id::bigint, stage_name, target.id, target.organization_id, target.project_id, target.requested_by, target.query_upload_id, upload_row.object_path, upload_row.file_size_bytes, target.query_sha256, target.program, target.database_name, target.expect_value::text, target.max_targets, target.low_complexity_filter, target.remote_rid;
end; $$;

create or replace function app_private.finish_blast_submission(p_message_id bigint, p_job_id uuid, p_remote_rid text, p_rtoe_seconds integer, p_service_version text)
returns void language plpgsql security definer set search_path='' as $$
declare delay_seconds integer; queue_message_id bigint;
begin
  if p_remote_rid is null or p_remote_rid !~ '^[A-Za-z0-9_-]{5,128}$' then raise exception 'invalid BLAST RID'; end if;
  if p_rtoe_seconds is null or p_rtoe_seconds < 0 or p_rtoe_seconds > 21600 then raise exception 'invalid BLAST RTOE'; end if;
  if nullif(trim(p_service_version),'') is null then raise exception 'service version is required'; end if;
  delay_seconds := greatest(60,p_rtoe_seconds);
  update public.blast_jobs set status='remote_pending', remote_rid=p_remote_rid, remote_rtoe_seconds=p_rtoe_seconds, service_version=left(trim(p_service_version),128), submitted_at=now(), next_poll_at=now()+make_interval(secs=>delay_seconds), transient_error_count=0, processing_error=null, updated_at=now() where id=p_job_id and status='submitting';
  if not found then raise exception 'BLAST submission job is not active' using errcode='P0002'; end if;
  if not pgmq.delete('blast_remote',p_message_id) then raise exception 'BLAST queue message delete failed'; end if;
  select pgmq.send(queue_name=>'blast_remote',msg=>jsonb_build_object('job_id',p_job_id,'stage','poll'),delay=>delay_seconds) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue BLAST poll'; end if;
end; $$;

create or replace function app_private.finish_blast_poll_pending(p_message_id bigint,p_job_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare queue_message_id bigint;
begin
  update public.blast_jobs set status='remote_pending',next_poll_at=now()+interval '60 seconds',transient_error_count=0,processing_error=null,updated_at=now() where id=p_job_id and status='retrieving' and remote_rid is not null;
  if not found then raise exception 'BLAST polling job is not active' using errcode='P0002'; end if;
  if not pgmq.delete('blast_remote',p_message_id) then raise exception 'BLAST queue message delete failed'; end if;
  select pgmq.send(queue_name=>'blast_remote',msg=>jsonb_build_object('job_id',p_job_id,'stage','poll'),delay=>60) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue BLAST poll'; end if;
end; $$;

create or replace function app_private.finish_blast_success(p_message_id bigint,p_job_id uuid,p_result_object_path text,p_raw_result_sha256 text,p_raw_result_bytes bigint,p_blast_version text,p_database_reported text,p_database_release text,p_result_summary jsonb,p_normalized_hits jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare target public.blast_jobs%rowtype; expected_path text; hit_count integer;
begin
  select * into target from public.blast_jobs where id=p_job_id for update;
  if not found or target.status<>'retrieving' then raise exception 'BLAST result job is not active' using errcode='P0002'; end if;
  expected_path:=target.organization_id::text||'/'||target.project_id::text||'/'||target.id::text||'/blast-result.xml';
  if p_result_object_path is distinct from expected_path then raise exception 'BLAST result object path mismatch'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='analysis-results' and o.name=expected_path) then raise exception 'BLAST result artifact not found' using errcode='P0002'; end if;
  if p_raw_result_sha256 is null or p_raw_result_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid BLAST result checksum'; end if;
  if p_raw_result_bytes is null or p_raw_result_bytes<1 or p_raw_result_bytes>26214400 then raise exception 'BLAST result artifact exceeds allowed size'; end if;
  if nullif(trim(p_blast_version),'') is null or nullif(trim(p_database_reported),'') is null then raise exception 'BLAST provenance is incomplete'; end if;
  if p_result_summary is null or jsonb_typeof(p_result_summary)<>'object' or p_normalized_hits is null or jsonb_typeof(p_normalized_hits)<>'array' then raise exception 'BLAST normalized result payload is invalid'; end if;
  hit_count:=jsonb_array_length(p_normalized_hits);
  if hit_count>target.max_targets then raise exception 'BLAST result exceeds requested max targets'; end if;
  if p_result_summary->>'query_sha256' is distinct from target.query_sha256 then raise exception 'BLAST result query checksum mismatch'; end if;
  if p_result_summary->>'hit_count' is null or (p_result_summary->>'hit_count')::integer<>hit_count then raise exception 'BLAST result hit count mismatch'; end if;
  if exists(select 1 from jsonb_array_elements(p_normalized_hits) h where jsonb_typeof(h)<>'object' or h->>'subject_id' is null or h->>'alignment_length' is null or h->>'e_value' is null or h->>'bit_score' is null or h->>'identity_percent' is null or h->>'query_coverage_percent' is null) then raise exception 'BLAST hit payload is missing required fields'; end if;
  update public.blast_jobs set status='completed',result_object_path=expected_path,raw_result_sha256=p_raw_result_sha256,raw_result_bytes=p_raw_result_bytes,blast_version=left(trim(p_blast_version),128),database_reported=left(trim(p_database_reported),256),database_release=left(nullif(trim(p_database_release),''),256),result_summary=p_result_summary,normalized_hits=p_normalized_hits,next_poll_at=null,processing_finished_at=now(),processing_error=null,updated_at=now() where id=p_job_id;
  if not pgmq.delete('blast_remote',p_message_id) then raise exception 'BLAST queue message delete failed'; end if;
end; $$;

create or replace function app_private.finish_blast_error(p_message_id bigint,p_job_id uuid,p_processing_error text,p_retry_poll boolean default false,p_max_poll_errors integer default 5)
returns text language plpgsql security definer set search_path='' as $$
declare target public.blast_jobs%rowtype; queue_message_id bigint; next_errors integer;
begin
  if p_max_poll_errors<1 or p_max_poll_errors>10 then raise exception 'max poll errors must be between 1 and 10'; end if;
  select * into target from public.blast_jobs where id=p_job_id for update;
  if not found then perform pgmq.delete('blast_remote',p_message_id); return 'discarded'; end if;
  if p_retry_poll and target.status='retrieving' and target.remote_rid is not null then
    next_errors:=target.transient_error_count+1;
    if next_errors<p_max_poll_errors then
      update public.blast_jobs set status='remote_pending',transient_error_count=next_errors,next_poll_at=now()+interval '60 seconds',processing_error=left(coalesce(nullif(trim(p_processing_error),''),'BLAST poll failed'),2000),updated_at=now() where id=target.id;
      perform pgmq.delete('blast_remote',p_message_id);
      select pgmq.send(queue_name=>'blast_remote',msg=>jsonb_build_object('job_id',target.id,'stage','poll'),delay=>60) into queue_message_id;
      if queue_message_id is null then raise exception 'failed to enqueue BLAST poll retry'; end if;
      return 'retry';
    end if;
  end if;
  update public.blast_jobs set status='error',next_poll_at=null,processing_finished_at=now(),processing_error=left(coalesce(nullif(trim(p_processing_error),''),'BLAST execution failed'),2000),updated_at=now() where id=target.id;
  perform pgmq.delete('blast_remote',p_message_id);
  return 'error';
end; $$;

create or replace function public.claim_blast_job(visibility_seconds integer default 300)
returns table (message_id bigint,stage text,job_id uuid,organization_id uuid,project_id uuid,requested_by uuid,query_upload_id uuid,query_object_path text,query_file_size_bytes bigint,query_sha256 text,program text,database_name text,expect_value text,max_targets integer,low_complexity_filter boolean,remote_rid text)
language sql security invoker set search_path='' as $$ select * from app_private.claim_blast_job(visibility_seconds); $$;
create or replace function public.finish_blast_submission(message_id bigint,job_id uuid,remote_rid text,rtoe_seconds integer,service_version text) returns void language sql security invoker set search_path='' as $$ select app_private.finish_blast_submission(message_id,job_id,remote_rid,rtoe_seconds,service_version); $$;
create or replace function public.finish_blast_poll_pending(message_id bigint,job_id uuid) returns void language sql security invoker set search_path='' as $$ select app_private.finish_blast_poll_pending(message_id,job_id); $$;
create or replace function public.finish_blast_success(message_id bigint,job_id uuid,result_object_path text,raw_result_sha256 text,raw_result_bytes bigint,blast_version text,database_reported text,database_release text,result_summary jsonb,normalized_hits jsonb) returns void language sql security invoker set search_path='' as $$ select app_private.finish_blast_success(message_id,job_id,result_object_path,raw_result_sha256,raw_result_bytes,blast_version,database_reported,database_release,result_summary,normalized_hits); $$;
create or replace function public.finish_blast_error(message_id bigint,job_id uuid,processing_error text,retry_poll boolean default false,max_poll_errors integer default 5) returns text language sql security invoker set search_path='' as $$ select app_private.finish_blast_error(message_id,job_id,processing_error,retry_poll,max_poll_errors); $$;

revoke all on function app_private.claim_blast_job(integer) from public,anon,authenticated;
revoke all on function app_private.finish_blast_submission(bigint,uuid,text,integer,text) from public,anon,authenticated;
revoke all on function app_private.finish_blast_poll_pending(bigint,uuid) from public,anon,authenticated;
revoke all on function app_private.finish_blast_success(bigint,uuid,text,text,bigint,text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function app_private.finish_blast_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function app_private.claim_blast_job(integer) to service_role;
grant execute on function app_private.finish_blast_submission(bigint,uuid,text,integer,text) to service_role;
grant execute on function app_private.finish_blast_poll_pending(bigint,uuid) to service_role;
grant execute on function app_private.finish_blast_success(bigint,uuid,text,text,bigint,text,text,text,jsonb,jsonb) to service_role;
grant execute on function app_private.finish_blast_error(bigint,uuid,text,boolean,integer) to service_role;
revoke all on function public.claim_blast_job(integer) from public,anon,authenticated;
revoke all on function public.finish_blast_submission(bigint,uuid,text,integer,text) from public,anon,authenticated;
revoke all on function public.finish_blast_poll_pending(bigint,uuid) from public,anon,authenticated;
revoke all on function public.finish_blast_success(bigint,uuid,text,text,bigint,text,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.finish_blast_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.claim_blast_job(integer) to service_role;
grant execute on function public.finish_blast_submission(bigint,uuid,text,integer,text) to service_role;
grant execute on function public.finish_blast_poll_pending(bigint,uuid) to service_role;
grant execute on function public.finish_blast_success(bigint,uuid,text,text,bigint,text,text,text,jsonb,jsonb) to service_role;
grant execute on function public.finish_blast_error(bigint,uuid,text,boolean,integer) to service_role;
