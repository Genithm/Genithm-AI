select pgmq.create('ncbi_sequence_retrieval');

create table public.sequence_retrievals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  source_provider text not null default 'ncbi',
  source_database text not null,
  requested_accession text not null,
  resolved_accession text,
  record_title text,
  organism text,
  reported_length bigint,
  record_updated_date text,
  status text not null default 'queued',
  sequence_upload_id uuid unique references public.sequence_uploads(id) on delete set null,
  connector_version text,
  source_retrieved_at timestamptz,
  result_message text,
  processing_attempts integer not null default 0,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sequence_retrievals_project_org_fkey foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint sequence_retrievals_provider check (source_provider = 'ncbi'),
  constraint sequence_retrievals_database check (source_database in ('nucleotide', 'protein')),
  constraint sequence_retrievals_accession_format check (
    char_length(requested_accession) between 1 and 64
    and requested_accession ~ '^[A-Z0-9_]+(\.[0-9]+)?$'
    and requested_accession ~ '[A-Z]'
  ),
  constraint sequence_retrievals_resolved_accession_format check (
    resolved_accession is null
    or (
      char_length(resolved_accession) between 1 and 64
      and resolved_accession ~ '^[A-Z0-9_]+(\.[0-9]+)?$'
      and resolved_accession ~ '[A-Z]'
    )
  ),
  constraint sequence_retrievals_reported_length check (reported_length is null or reported_length > 0),
  constraint sequence_retrievals_status check (status in ('queued', 'retrieving', 'retrieved', 'not_found', 'rejected', 'error')),
  constraint sequence_retrievals_attempts check (processing_attempts >= 0),
  constraint sequence_retrievals_lifecycle check (
    (status = 'queued' and processing_started_at is null and processing_finished_at is null)
    or (status = 'retrieving' and processing_started_at is not null and processing_finished_at is null)
    or (status in ('retrieved', 'not_found', 'rejected', 'error') and processing_finished_at is not null)
  ),
  constraint sequence_retrievals_retrieved_metadata check (
    status <> 'retrieved'
    or (
      resolved_accession is not null
      and sequence_upload_id is not null
      and nullif(trim(connector_version), '') is not null
      and source_retrieved_at is not null
    )
  ),
  constraint sequence_retrievals_result_message check (result_message is null or char_length(result_message) <= 2000),
  constraint sequence_retrievals_processing_error check (processing_error is null or char_length(processing_error) <= 2000)
);

create index sequence_retrievals_project_created_idx on public.sequence_retrievals(project_id, created_at desc);
create index sequence_retrievals_org_created_idx on public.sequence_retrievals(organization_id, created_at desc);
create index sequence_retrievals_requested_by_idx on public.sequence_retrievals(requested_by);
create index sequence_retrievals_status_idx on public.sequence_retrievals(status) where status in ('queued', 'retrieving');
create index sequence_retrievals_lookup_idx on public.sequence_retrievals(project_id, source_database, requested_accession, created_at desc);

create trigger sequence_retrievals_set_updated_at
before update on public.sequence_retrievals
for each row execute function app_private.set_updated_at();

alter table public.sequence_retrievals enable row level security;
alter table public.sequence_retrievals force row level security;

create policy sequence_retrievals_select_project_member
on public.sequence_retrievals for select to authenticated
using (app_private.is_org_member(organization_id));

revoke all on table public.sequence_retrievals from anon, authenticated;
grant select on table public.sequence_retrievals to authenticated;

create or replace function app_private.request_ncbi_sequence_retrieval(p_project_id uuid, p_database_name text, p_accession text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  normalized_database text := lower(trim(p_database_name));
  normalized_accession text := upper(trim(p_accession));
  existing_id uuid;
  retrieval_id uuid;
  queue_message_id bigint;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if normalized_database not in ('nucleotide', 'protein') then
    raise exception 'unsupported NCBI database';
  end if;
  if char_length(normalized_accession) < 1 or char_length(normalized_accession) > 64
     or normalized_accession !~ '^[A-Z0-9_]+(\.[0-9]+)?$' or normalized_accession !~ '[A-Z]' then
    raise exception 'invalid accession format';
  end if;
  select p.organization_id into org_id from public.projects p where p.id = p_project_id;
  if not found then raise exception 'project not found' using errcode = 'P0002'; end if;
  if not app_private.can_write_org(org_id) then raise exception 'project write access denied' using errcode = '42501'; end if;
  select sr.id into existing_id from public.sequence_retrievals sr
   where sr.project_id = p_project_id and sr.source_database = normalized_database
     and sr.requested_accession = normalized_accession and sr.status in ('queued', 'retrieving')
   order by sr.created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;
  insert into public.sequence_retrievals (organization_id, project_id, requested_by, source_provider, source_database, requested_accession)
  values (org_id, p_project_id, caller_id, 'ncbi', normalized_database, normalized_accession)
  returning id into retrieval_id;
  select pgmq.send(queue_name => 'ncbi_sequence_retrieval', msg => jsonb_build_object('retrieval_id', retrieval_id)) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue NCBI retrieval'; end if;
  return retrieval_id;
end;
$$;

create or replace function public.request_ncbi_sequence_retrieval(project_id uuid, database_name text, accession text)
returns uuid language sql security invoker set search_path = '' as $$
  select app_private.request_ncbi_sequence_retrieval(project_id, database_name, accession);
$$;
revoke all on function app_private.request_ncbi_sequence_retrieval(uuid, text, text) from public, anon;
grant execute on function app_private.request_ncbi_sequence_retrieval(uuid, text, text) to authenticated;
revoke all on function public.request_ncbi_sequence_retrieval(uuid, text, text) from public, anon;
grant execute on function public.request_ncbi_sequence_retrieval(uuid, text, text) to authenticated;

create or replace function app_private.claim_ncbi_sequence_retrieval_job(p_visibility_seconds integer default 300)
returns table (message_id bigint, read_count integer, retrieval_id uuid, organization_id uuid, project_id uuid, requested_by uuid, database_name text, requested_accession text)
language plpgsql security definer set search_path = '' as $$
declare
  job record;
  target_id uuid;
  target public.sequence_retrievals%rowtype;
begin
  if p_visibility_seconds < 60 or p_visibility_seconds > 1800 then raise exception 'visibility timeout must be between 60 and 1800 seconds'; end if;
  select * into job from pgmq.read(queue_name => 'ncbi_sequence_retrieval', vt => p_visibility_seconds, qty => 1) limit 1;
  if not found then return; end if;
  begin target_id := (job.message->>'retrieval_id')::uuid; exception when others then perform pgmq.delete('ncbi_sequence_retrieval', job.msg_id); return; end;
  select * into target from public.sequence_retrievals where id = target_id for update;
  if not found then perform pgmq.delete('ncbi_sequence_retrieval', job.msg_id); return; end if;
  if target.status not in ('queued', 'retrieving') then perform pgmq.delete('ncbi_sequence_retrieval', job.msg_id); return; end if;
  update public.sequence_retrievals set status='retrieving', processing_attempts=processing_attempts+1,
    processing_started_at=now(), processing_finished_at=null, processing_error=null, updated_at=now()
    where id=target.id returning * into target;
  return query select job.msg_id::bigint, job.read_ct::integer, target.id, target.organization_id, target.project_id,
    target.requested_by, target.source_database, target.requested_accession;
end;
$$;

create or replace function app_private.finish_ncbi_sequence_retrieval_success(
  p_message_id bigint, p_retrieval_id uuid, p_sequence_upload_id uuid, p_resolved_accession text,
  p_file_size_bytes bigint, p_record_title text, p_organism text, p_reported_length bigint,
  p_record_updated_date text, p_connector_version text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  target public.sequence_retrievals%rowtype;
  normalized_resolved text := upper(trim(p_resolved_accession));
  expected_filename text;
  expected_path text;
  validation_message_id bigint;
begin
  select * into target from public.sequence_retrievals where id=p_retrieval_id for update;
  if not found or target.status <> 'retrieving' then raise exception 'retrieval job is not active' using errcode='P0002'; end if;
  if char_length(normalized_resolved)<1 or char_length(normalized_resolved)>64 or normalized_resolved !~ '^[A-Z0-9_]+(\.[0-9]+)?$' or normalized_resolved !~ '[A-Z]' then raise exception 'resolved accession format is invalid'; end if;
  if split_part(normalized_resolved,'.',1) <> split_part(target.requested_accession,'.',1) then raise exception 'resolved accession does not match requested accession'; end if;
  if position('.' in target.requested_accession)>0 and normalized_resolved <> target.requested_accession then raise exception 'versioned accession mismatch'; end if;
  if p_file_size_bytes<1 or p_file_size_bytes>52428800 then raise exception 'retrieved FASTA is outside the 50 MiB limit'; end if;
  if p_reported_length is null or p_reported_length<1 then raise exception 'NCBI reported length is invalid'; end if;
  if nullif(trim(p_connector_version),'') is null then raise exception 'connector version is required'; end if;
  expected_filename := 'ncbi-' || lower(normalized_resolved) || '.fasta';
  expected_path := target.organization_id::text || '/' || target.project_id::text || '/' || target.requested_by::text || '/' || p_sequence_upload_id::text || '/' || expected_filename;
  if not exists (select 1 from storage.objects o where o.bucket_id='sequence-inputs' and o.name=expected_path) then raise exception 'retrieved FASTA object not found' using errcode='P0002'; end if;
  insert into public.sequence_uploads (id,organization_id,project_id,created_by,original_filename,object_path,file_size_bytes,content_type,status)
  values (p_sequence_upload_id,target.organization_id,target.project_id,target.requested_by,expected_filename,expected_path,p_file_size_bytes,'text/plain','pending_validation');
  update public.sequence_retrievals set status='retrieved', resolved_accession=normalized_resolved,
    record_title=left(nullif(trim(p_record_title),''),2000), organism=left(nullif(trim(p_organism),''),512),
    reported_length=p_reported_length, record_updated_date=left(nullif(trim(p_record_updated_date),''),64),
    sequence_upload_id=p_sequence_upload_id, connector_version=left(trim(p_connector_version),128),
    source_retrieved_at=now(), result_message=null, processing_finished_at=now(), processing_error=null, updated_at=now()
    where id=target.id;
  select pgmq.send(queue_name=>'sequence_validation', msg=>jsonb_build_object('upload_id',p_sequence_upload_id)) into validation_message_id;
  if validation_message_id is null then raise exception 'failed to enqueue retrieved sequence validation'; end if;
  if not pgmq.delete('ncbi_sequence_retrieval',p_message_id) then raise exception 'retrieval queue message delete failed'; end if;
  return p_sequence_upload_id;
end;
$$;

create or replace function app_private.finish_ncbi_sequence_retrieval_not_found(p_message_id bigint,p_retrieval_id uuid,p_connector_version text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.sequence_retrievals set status='not_found',connector_version=left(trim(p_connector_version),128),
    result_message='NCBI did not return a record for this accession.',processing_finished_at=now(),processing_error=null,updated_at=now()
  where id=p_retrieval_id and status='retrieving';
  if not found then raise exception 'retrieval job is not active' using errcode='P0002'; end if;
  if not pgmq.delete('ncbi_sequence_retrieval',p_message_id) then raise exception 'retrieval queue message delete failed'; end if;
end;
$$;

create or replace function app_private.finish_ncbi_sequence_retrieval_rejected(p_message_id bigint,p_retrieval_id uuid,p_reason text,p_connector_version text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if nullif(trim(p_reason),'') is null then raise exception 'rejection reason is required'; end if;
  update public.sequence_retrievals set status='rejected',connector_version=left(trim(p_connector_version),128),
    result_message=left(trim(p_reason),2000),processing_finished_at=now(),processing_error=null,updated_at=now()
  where id=p_retrieval_id and status='retrieving';
  if not found then raise exception 'retrieval job is not active' using errcode='P0002'; end if;
  if not pgmq.delete('ncbi_sequence_retrieval',p_message_id) then raise exception 'retrieval queue message delete failed'; end if;
end;
$$;

create or replace function app_private.finish_ncbi_sequence_retrieval_error(p_message_id bigint,p_retrieval_id uuid,p_processing_error text,p_max_attempts integer default 3)
returns text language plpgsql security definer set search_path='' as $$
declare attempts integer;
begin
  if p_max_attempts<1 or p_max_attempts>10 then raise exception 'max attempts must be between 1 and 10'; end if;
  select processing_attempts into attempts from public.sequence_retrievals where id=p_retrieval_id for update;
  if not found then perform pgmq.delete('ncbi_sequence_retrieval',p_message_id); return 'discarded'; end if;
  if attempts>=p_max_attempts then
    update public.sequence_retrievals set status='error',processing_finished_at=now(),
      processing_error=left(coalesce(nullif(trim(p_processing_error),''),'NCBI retrieval failed'),2000),updated_at=now()
    where id=p_retrieval_id and status='retrieving';
    perform pgmq.delete('ncbi_sequence_retrieval',p_message_id); return 'error';
  end if;
  update public.sequence_retrievals set status='queued',processing_started_at=null,processing_finished_at=null,
    processing_error=left(coalesce(nullif(trim(p_processing_error),''),'NCBI retrieval failed'),2000),updated_at=now()
  where id=p_retrieval_id and status='retrieving';
  return 'retry';
end;
$$;

create or replace function public.claim_ncbi_sequence_retrieval_job(visibility_seconds integer default 300)
returns table (message_id bigint,read_count integer,retrieval_id uuid,organization_id uuid,project_id uuid,requested_by uuid,database_name text,requested_accession text)
language sql security invoker set search_path='' as $$ select * from app_private.claim_ncbi_sequence_retrieval_job(visibility_seconds); $$;
create or replace function public.finish_ncbi_sequence_retrieval_success(message_id bigint,retrieval_id uuid,sequence_upload_id uuid,resolved_accession text,file_size_bytes bigint,record_title text,organism text,reported_length bigint,record_updated_date text,connector_version text)
returns uuid language sql security invoker set search_path='' as $$ select app_private.finish_ncbi_sequence_retrieval_success(message_id,retrieval_id,sequence_upload_id,resolved_accession,file_size_bytes,record_title,organism,reported_length,record_updated_date,connector_version); $$;
create or replace function public.finish_ncbi_sequence_retrieval_not_found(message_id bigint,retrieval_id uuid,connector_version text)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_ncbi_sequence_retrieval_not_found(message_id,retrieval_id,connector_version); $$;
create or replace function public.finish_ncbi_sequence_retrieval_rejected(message_id bigint,retrieval_id uuid,reason text,connector_version text)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_ncbi_sequence_retrieval_rejected(message_id,retrieval_id,reason,connector_version); $$;
create or replace function public.finish_ncbi_sequence_retrieval_error(message_id bigint,retrieval_id uuid,processing_error text,max_attempts integer default 3)
returns text language sql security invoker set search_path='' as $$ select app_private.finish_ncbi_sequence_retrieval_error(message_id,retrieval_id,processing_error,max_attempts); $$;

revoke all on function app_private.claim_ncbi_sequence_retrieval_job(integer) from public,anon,authenticated;
revoke all on function app_private.finish_ncbi_sequence_retrieval_success(bigint,uuid,uuid,text,bigint,text,text,bigint,text,text) from public,anon,authenticated;
revoke all on function app_private.finish_ncbi_sequence_retrieval_not_found(bigint,uuid,text) from public,anon,authenticated;
revoke all on function app_private.finish_ncbi_sequence_retrieval_rejected(bigint,uuid,text,text) from public,anon,authenticated;
revoke all on function app_private.finish_ncbi_sequence_retrieval_error(bigint,uuid,text,integer) from public,anon,authenticated;
grant execute on function app_private.claim_ncbi_sequence_retrieval_job(integer) to service_role;
grant execute on function app_private.finish_ncbi_sequence_retrieval_success(bigint,uuid,uuid,text,bigint,text,text,bigint,text,text) to service_role;
grant execute on function app_private.finish_ncbi_sequence_retrieval_not_found(bigint,uuid,text) to service_role;
grant execute on function app_private.finish_ncbi_sequence_retrieval_rejected(bigint,uuid,text,text) to service_role;
grant execute on function app_private.finish_ncbi_sequence_retrieval_error(bigint,uuid,text,integer) to service_role;
revoke all on function public.claim_ncbi_sequence_retrieval_job(integer) from public,anon,authenticated;
revoke all on function public.finish_ncbi_sequence_retrieval_success(bigint,uuid,uuid,text,bigint,text,text,bigint,text,text) from public,anon,authenticated;
revoke all on function public.finish_ncbi_sequence_retrieval_not_found(bigint,uuid,text) from public,anon,authenticated;
revoke all on function public.finish_ncbi_sequence_retrieval_rejected(bigint,uuid,text,text) from public,anon,authenticated;
revoke all on function public.finish_ncbi_sequence_retrieval_error(bigint,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_ncbi_sequence_retrieval_job(integer) to service_role;
grant execute on function public.finish_ncbi_sequence_retrieval_success(bigint,uuid,uuid,text,bigint,text,text,bigint,text,text) to service_role;
grant execute on function public.finish_ncbi_sequence_retrieval_not_found(bigint,uuid,text) to service_role;
grant execute on function public.finish_ncbi_sequence_retrieval_rejected(bigint,uuid,text,text) to service_role;
grant execute on function public.finish_ncbi_sequence_retrieval_error(bigint,uuid,text,integer) to service_role;
