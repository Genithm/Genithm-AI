-- V44 managed large data. Additive and opt-in: no project gets a quota here.
-- File bytes travel directly to a dedicated private S3-compatible bucket.
-- ONLY a separately authenticated API may call mutation functions (service_role).
create table public.large_data_project_limits (
  project_id uuid primary key references public.projects(id) on delete restrict,
  enabled boolean not null default false,
  capacity_bytes bigint not null check (capacity_bytes between 1 and 10995116277760),
  max_file_bytes bigint not null default 107374182400 check (max_file_bytes between 1 and 107374182400),
  charged_bytes bigint not null default 0 check (charged_bytes >= 0 and charged_bytes <= capacity_bytes),
  updated_at timestamptz not null default now()
);
create table public.large_data_uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  project_id uuid not null references public.projects(id),
  created_by uuid not null references auth.users(id),
  request_id uuid not null,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  data_format text not null check (data_format in ('fastq','fastq.gz','opaque')),
  expected_bytes bigint not null check (expected_bytes between 1 and 107374182400),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  storage_identity text not null check (storage_identity ~ '^[0-9a-f]{64}$'),
  object_key text not null unique,
  provider_upload_id text,
  part_bytes integer not null default 67108864 check (part_bytes = 67108864),
  state text not null default 'reserved' check (state in
    ('reserved','initializing','uploading','completing','uploaded','verifying','ready','rejected','verification_error','aborting','aborted')),
  operation_token uuid,
  operation_started_at timestamptz,
  signed_until timestamptz,
  object_etag text,
  actual_sha256 text check (actual_sha256 is null or actual_sha256 ~ '^[0-9a-f]{64}$'),
  summary jsonb check (summary is null or (jsonb_typeof(summary) = 'object' and pg_column_size(summary) <= 65536)),
  checked_bytes bigint not null default 0 check (checked_bytes >= 0 and checked_bytes <= expected_bytes),
  verification_attempts integer not null default 0 check (verification_attempts between 0 and 3),
  lease_until timestamptz,
  error_code text check (error_code is null or error_code in
    ('checksum_mismatch','format_invalid','source_changed','resource_limit','transfer_error','verification_attempts_exhausted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,created_by,request_id),
  check (state <> 'ready' or (actual_sha256 = expected_sha256 and checked_bytes = expected_bytes and summary is not null))
);
create index large_data_owner_recent on public.large_data_uploads(created_by,project_id,created_at desc);
create index large_data_verification_queue on public.large_data_uploads(state,lease_until,created_at);
create table public.large_data_worker_heartbeats (
  worker_id uuid primary key,
  last_seen timestamptz not null,
  version text not null check (version = 'genithm-large-data/1.0.0'),
  storage_identity text not null check (storage_identity ~ '^[0-9a-f]{64}$')
);
alter table public.large_data_project_limits enable row level security;
alter table public.large_data_uploads enable row level security;
alter table public.large_data_worker_heartbeats enable row level security;
-- No direct end-user mutation. Owner reads are still protected if SELECT is explicitly granted later.
create policy large_data_owner_read on public.large_data_uploads for select to authenticated
using (created_by = (select auth.uid()) and (select app_private.is_org_member(organization_id)));
revoke all on public.large_data_project_limits, public.large_data_uploads, public.large_data_worker_heartbeats from public,anon,authenticated;
grant select,insert,update on public.large_data_project_limits, public.large_data_uploads, public.large_data_worker_heartbeats to service_role;

create function app_private.large_data_access(p_owner uuid, p_project uuid, p_write boolean)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.projects p join public.organization_members m on m.organization_id=p.organization_id
 where p.id=p_project and p.status='active' and m.user_id=p_owner
 and (not p_write or m.role in ('owner','admin','member')));
$$;

create function public.large_data_limits(p_owner uuid, p_project uuid, p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.large_data_project_limits;
begin
 if not app_private.large_data_access(p_owner,p_project,false) then raise exception 'not_found' using errcode='42501'; end if;
 select * into q from public.large_data_project_limits where project_id=p_project;
 return jsonb_build_object('enabled',coalesce(q.enabled,false),'capacity_bytes',coalesce(q.capacity_bytes,0),
 'charged_bytes',coalesce(q.charged_bytes,0),'max_file_bytes',coalesce(q.max_file_bytes,0),
 'verifier_ready',exists(select 1 from public.large_data_worker_heartbeats where storage_identity=p_storage
 and last_seen>clock_timestamp()-interval '120 seconds'));
end $$;

create function public.large_data_reserve(p_owner uuid,p_project uuid,p_request uuid,p_filename text,
 p_bytes bigint,p_sha256 text,p_format text,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.large_data_project_limits; u public.large_data_uploads; new_id uuid:=gen_random_uuid(); org uuid;
begin
 if not app_private.large_data_access(p_owner,p_project,true) then raise exception 'not_found' using errcode='42501'; end if;
 -- The project row lock serializes reservation and cleanup accounting across users/processes.
 select * into q from public.large_data_project_limits where project_id=p_project for update;
 if not found or not q.enabled then raise exception 'quota_not_configured'; end if;
 select * into u from public.large_data_uploads where project_id=p_project and created_by=p_owner and request_id=p_request;
 if found then
   if u.expected_bytes<>p_bytes or u.expected_sha256<>p_sha256 or u.data_format<>p_format
      or u.original_filename<>p_filename or u.storage_identity<>p_storage then raise exception 'idempotency_conflict'; end if;
   return to_jsonb(u);
 end if;
 if p_bytes<1 or p_bytes>q.max_file_bytes or p_bytes>107374182400 then raise exception 'file_size_limit'; end if;
 if p_bytes>q.capacity_bytes-q.charged_bytes then raise exception 'quota_exceeded'; end if;
 if (select count(*) from public.large_data_uploads where project_id=p_project and created_by=p_owner
   and state not in ('ready','rejected','verification_error','aborted'))>=3 then raise exception 'too_many_active_uploads'; end if;
 if not exists(select 1 from public.large_data_worker_heartbeats where storage_identity=p_storage
   and last_seen>clock_timestamp()-interval '120 seconds') then raise exception 'verifier_not_ready'; end if;
 select organization_id into org from public.projects where id=p_project;
 insert into public.large_data_uploads(id,organization_id,project_id,created_by,request_id,original_filename,
   expected_bytes,expected_sha256,data_format,storage_identity,object_key)
 values(new_id,org,p_project,p_owner,p_request,p_filename,p_bytes,p_sha256,p_format,p_storage,
   'quarantine/'||org||'/'||p_project||'/'||new_id||'/input') returning * into u;
 update public.large_data_project_limits set charged_bytes=charged_bytes+p_bytes,updated_at=clock_timestamp() where project_id=p_project;
 return to_jsonb(u);
end $$;

create function public.large_data_get(p_owner uuid,p_id uuid,p_write boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads;
begin
 select * into u from public.large_data_uploads where id=p_id and created_by=p_owner;
 if not found or not app_private.large_data_access(p_owner,u.project_id,p_write) then raise exception 'not_found' using errcode='42501'; end if;
 return to_jsonb(u);
end $$;

create function public.large_data_list(p_owner uuid,p_project uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not app_private.large_data_access(p_owner,p_project,false) then raise exception 'not_found' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r)) from (select id,project_id,original_filename,expected_bytes,
 expected_sha256,data_format,state,checked_bytes,summary,error_code,created_at,updated_at
 from public.large_data_uploads where project_id=p_project and created_by=p_owner order by created_at desc limit 30) r),'[]'::jsonb);
end $$;

create function public.large_data_acquire(p_owner uuid,p_id uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads; target text;
begin
 select * into u from public.large_data_uploads where id=p_id and created_by=p_owner for update;
 if not found or not app_private.large_data_access(p_owner,u.project_id,true) then raise exception 'not_found' using errcode='42501'; end if;
 if p_operation='initialize' then
   if u.state<>'reserved' then raise exception 'operation_in_progress'; end if; target:='initializing';
 elsif p_operation='complete' then
   if u.state<>'uploading' and not (u.state='completing' and u.operation_started_at<clock_timestamp()-interval '15 minutes')
     then raise exception 'operation_in_progress'; end if; target:='completing';
 elsif p_operation='abort' then
   if u.state in ('completing','verifying') then raise exception 'operation_in_progress'; end if;
   if u.state='initializing' and u.operation_started_at>clock_timestamp()-interval '15 minutes' then raise exception 'operation_in_progress'; end if;
   if u.state='aborted' then return to_jsonb(u); end if;
   if u.signed_until is not null and u.signed_until>clock_timestamp()-interval '120 seconds' then raise exception 'upload_links_still_active'; end if;
   if u.state='aborting' and u.operation_started_at>clock_timestamp()-interval '15 minutes' then raise exception 'operation_in_progress'; end if;
   target:='aborting';
 else raise exception 'invalid_operation'; end if;
 update public.large_data_uploads set state=target,operation_token=gen_random_uuid(),operation_started_at=clock_timestamp(),
 updated_at=clock_timestamp() where id=p_id returning * into u;
 return to_jsonb(u);
end $$;

create function public.large_data_finish_operation(p_id uuid,p_token uuid,p_operation text,
 p_provider_id text default null,p_etag text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads;
begin
 select * into u from public.large_data_uploads where id=p_id for update;
 if not found or u.operation_token is distinct from p_token then raise exception 'lease_lost'; end if;
 if p_operation='initialize' and u.state='initializing' then
   if p_provider_id is null or length(p_provider_id) not between 1 and 2048 then raise exception 'provider_state_invalid'; end if;
   update public.large_data_uploads set state='uploading',provider_upload_id=p_provider_id,operation_token=null,
     updated_at=clock_timestamp() where id=p_id returning * into u;
 elsif p_operation='complete' and u.state='completing' then
   if p_etag is null or length(p_etag) not between 1 and 256 then raise exception 'provider_state_invalid'; end if;
   update public.large_data_uploads set state='uploaded',object_etag=p_etag,operation_token=null,
     updated_at=clock_timestamp() where id=p_id returning * into u;
 elsif p_operation='abort' and u.state='aborting' then
   -- The caller must have confirmed both object and multipart cleanup before this transition.
   update public.large_data_project_limits set charged_bytes=charged_bytes-u.expected_bytes,
     updated_at=clock_timestamp() where project_id=u.project_id;
   update public.large_data_uploads set state='aborted',operation_token=null,summary=null,
     updated_at=clock_timestamp() where id=p_id returning * into u;
 else raise exception 'invalid_state_transition'; end if;
 return to_jsonb(u);
end $$;

create function public.large_data_sign_part(p_owner uuid,p_id uuid,p_number integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads;
begin
 select * into u from public.large_data_uploads where id=p_id and created_by=p_owner for update;
 if not found or not app_private.large_data_access(p_owner,u.project_id,true) then raise exception 'not_found' using errcode='42501'; end if;
 if u.state<>'uploading' then raise exception 'operation_in_progress'; end if;
 if p_number<1 or p_number>((u.expected_bytes+u.part_bytes-1)/u.part_bytes) then raise exception 'invalid_part'; end if;
 update public.large_data_uploads set signed_until=greatest(coalesce(signed_until,clock_timestamp()),clock_timestamp()+interval '300 seconds'),
 updated_at=clock_timestamp() where id=p_id returning * into u;
 return to_jsonb(u);
end $$;

create function public.large_data_heartbeat(p_worker uuid,p_storage text)
returns void language sql security definer set search_path='' as $$
 insert into public.large_data_worker_heartbeats(worker_id,last_seen,version,storage_identity)
 values(p_worker,clock_timestamp(),'genithm-large-data/1.0.0',p_storage)
 on conflict(worker_id) do update set last_seen=excluded.last_seen,storage_identity=excluded.storage_identity;
$$;

create function public.large_data_claim(p_worker uuid,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads;
begin
 update public.large_data_uploads set state='verification_error',error_code='verification_attempts_exhausted',operation_token=null
 where state='verifying' and lease_until<clock_timestamp() and verification_attempts>=3 and storage_identity=p_storage;
 select * into u from public.large_data_uploads where storage_identity=p_storage and verification_attempts<3
 and app_private.large_data_access(created_by,project_id,true)
 and (state='uploaded' or (state='verifying' and lease_until<clock_timestamp()))
 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.large_data_uploads set state='verifying',verification_attempts=verification_attempts+1,
 operation_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '300 seconds',checked_bytes=0,
 updated_at=clock_timestamp() where id=u.id returning * into u;
 return to_jsonb(u);
end $$;

create function public.large_data_progress(p_id uuid,p_token uuid,p_bytes bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.large_data_uploads set checked_bytes=p_bytes,lease_until=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp()
 where id=p_id and state='verifying' and operation_token=p_token and lease_until>clock_timestamp()
 and p_bytes>=checked_bytes and p_bytes<=expected_bytes;
 return found;
end $$;

create function public.large_data_finish_verification(p_id uuid,p_token uuid,p_sha256 text,p_summary jsonb,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads;
begin
 select * into u from public.large_data_uploads where id=p_id and state='verifying' and operation_token=p_token
 and lease_until>clock_timestamp() for update;
 if not found then return false; end if;
 if p_error is null then
   if p_sha256 is distinct from u.expected_sha256 or jsonb_typeof(p_summary) is distinct from 'object'
     or p_summary->>'schema' is distinct from 'genithm-large-data-result/1'
     or p_summary->>'source_bytes' is distinct from u.expected_bytes::text
     or p_summary->>'format' is distinct from u.data_format then raise exception 'verification_contract_failed'; end if;
   update public.large_data_uploads set state='ready',actual_sha256=p_sha256,summary=p_summary,checked_bytes=expected_bytes,
     operation_token=null,error_code=null,updated_at=clock_timestamp() where id=p_id;
 else
   if p_error not in ('checksum_mismatch','format_invalid','source_changed','resource_limit','transfer_error') then raise exception 'invalid_error_code'; end if;
   update public.large_data_uploads set state=case when p_error='transfer_error' then 'verification_error' else 'rejected' end,
     actual_sha256=null,summary=null,error_code=p_error,operation_token=null,updated_at=clock_timestamp() where id=p_id;
 end if;
 return true;
end $$;

-- Pin all privileges explicitly: functions are inaccessible to anonymous/user JWTs.
revoke all on function app_private.large_data_access(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function app_private.large_data_access(uuid,uuid,boolean) to service_role;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('large_data_limits','large_data_reserve','large_data_get','large_data_list',
 'large_data_acquire','large_data_finish_operation','large_data_sign_part','large_data_heartbeat','large_data_claim',
 'large_data_progress','large_data_finish_verification') loop
 execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end $$;
comment on table public.large_data_uploads is 'Private multipart quarantine. Ready means server-checked bytes and the declared format only; not completion of arbitrary scientific workflows.';
