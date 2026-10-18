-- V45: owner/project-scoped pairing of two previously verified managed FASTQ objects.
-- No new data copies, storage quotas, compute instances, or enabled workers are provisioned.
create table public.large_data_pairs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  project_id uuid not null references public.projects(id),
  created_by uuid not null references auth.users(id),
  request_id uuid not null,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  r1_id uuid not null references public.large_data_uploads(id),
  r2_id uuid not null references public.large_data_uploads(id),
  storage_identity text not null check (storage_identity ~ '^[0-9a-f]{64}$'),
  state text not null default 'queued' check (state in ('queued','verifying','ready','rejected','verification_error','cancelled')),
  operation_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  expected_bytes bigint not null check (expected_bytes between 2 and 214748364800),
  checked_bytes bigint not null default 0 check (checked_bytes between 0 and expected_bytes),
  checked_pairs bigint not null default 0 check (checked_pairs >= 0),
  summary jsonb check (summary is null or (jsonb_typeof(summary)='object' and pg_column_size(summary)<=65536)),
  error_code text check (error_code is null or error_code in (
    'pair_count_mismatch','pair_identifier_mismatch','pair_orientation_mismatch','pair_source_invalid',
    'source_changed','checksum_mismatch','format_invalid','resource_limit','transfer_error','verification_attempts_exhausted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,created_by,request_id),
  check (r1_id <> r2_id),
  check (state <> 'ready' or (checked_bytes=expected_bytes and checked_pairs>0 and summary is not null))
);
create index large_data_pairs_owner on public.large_data_pairs(created_by,project_id,created_at desc);
create index large_data_pairs_queue on public.large_data_pairs(state,lease_until,created_at);
create index large_data_pairs_r1 on public.large_data_pairs(r1_id,state);
create index large_data_pairs_r2 on public.large_data_pairs(r2_id,state);
create table public.large_data_pair_workers (
  worker_id uuid primary key,
  last_seen timestamptz not null,
  storage_identity text not null check (storage_identity ~ '^[0-9a-f]{64}$'),
  version text not null check (version='genithm-large-pair/1.0.0')
);
alter table public.large_data_pairs enable row level security;
alter table public.large_data_pair_workers enable row level security;
create policy large_data_pairs_owner_read on public.large_data_pairs for select to authenticated
using (created_by=(select auth.uid()) and (select app_private.is_org_member(organization_id)));
revoke all on public.large_data_pairs,public.large_data_pair_workers from public,anon,authenticated;
grant select,insert,update on public.large_data_pairs,public.large_data_pair_workers to service_role;

create function app_private.large_data_pair_sources(p public.large_data_pairs)
returns boolean language sql stable security definer set search_path='' as $$
 select count(*)=2 from public.large_data_uploads u where u.id in (p.r1_id,p.r2_id)
 and u.created_by=p.created_by and u.project_id=p.project_id and u.organization_id=p.organization_id
 and u.storage_identity=p.storage_identity and u.state='ready' and u.data_format in ('fastq','fastq.gz')
 and u.actual_sha256=u.expected_sha256 and u.object_etag is not null;
$$;

create function public.large_data_pair_heartbeat(p_worker uuid,p_storage text)
returns void language sql security definer set search_path='' as $$
 insert into public.large_data_pair_workers(worker_id,last_seen,storage_identity,version)
 values(p_worker,clock_timestamp(),p_storage,'genithm-large-pair/1.0.0')
 on conflict(worker_id) do update set last_seen=excluded.last_seen,storage_identity=excluded.storage_identity;
$$;

create function public.large_data_pair_overview(p_owner uuid,p_project uuid,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not app_private.large_data_access(p_owner,p_project,false) then raise exception 'not_found' using errcode='42501'; end if;
 return jsonb_build_object('worker_ready',exists(select 1 from public.large_data_pair_workers
   where storage_identity=p_storage and last_seen>clock_timestamp()-interval '120 seconds'),
   'pairs',coalesce((select jsonb_agg(to_jsonb(r)) from (select p.id,p.project_id,p.title,p.r1_id,p.r2_id,p.state,
    p.expected_bytes,p.checked_bytes,p.checked_pairs,p.summary,p.error_code,p.created_at,p.updated_at,
    app_private.large_data_pair_sources(p) as sources_available from public.large_data_pairs p
    where p.created_by=p_owner and p.project_id=p_project order by p.created_at desc limit 30) r),'[]'::jsonb));
end $$;

create function public.large_data_pair_enqueue(p_owner uuid,p_project uuid,p_request uuid,p_title text,
 p_r1 uuid,p_r2 uuid,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.large_data_project_limits; p public.large_data_pairs; a public.large_data_uploads; b public.large_data_uploads;
begin
 if not app_private.large_data_access(p_owner,p_project,true) then raise exception 'not_found' using errcode='42501'; end if;
 -- Serialize per-project idempotency/queue admission without charging stored source files twice.
 select * into q from public.large_data_project_limits where project_id=p_project for update;
 if not found or not q.enabled then raise exception 'quota_not_configured'; end if;
 select * into p from public.large_data_pairs where project_id=p_project and created_by=p_owner and request_id=p_request;
 if found then
  if p.r1_id<>p_r1 or p.r2_id<>p_r2 or p.title<>p_title or p.storage_identity<>p_storage then raise exception 'idempotency_conflict'; end if;
  return to_jsonb(p);
 end if;
 if p_r1 is null or p_r2 is null or p_r1=p_r2 or p_title is null or char_length(btrim(p_title)) not between 3 and 160
  then raise exception 'pair_source_invalid'; end if;
 -- Source locks serialize pair admission with object-cleanup state changes.
 perform id from public.large_data_uploads where id in (p_r1,p_r2) order by id for update;
 select * into a from public.large_data_uploads where id=p_r1 and created_by=p_owner and project_id=p_project;
 select * into b from public.large_data_uploads where id=p_r2 and created_by=p_owner and project_id=p_project;
 if a.id is null or b.id is null then raise exception 'not_found' using errcode='42501'; end if;
 if a.organization_id<>b.organization_id or a.storage_identity<>p_storage or b.storage_identity<>p_storage
   or a.state<>'ready' or b.state<>'ready' or a.data_format not in ('fastq','fastq.gz') or b.data_format not in ('fastq','fastq.gz')
   or a.actual_sha256 is distinct from a.expected_sha256 or b.actual_sha256 is distinct from b.expected_sha256
   or a.object_etag is null or b.object_etag is null then raise exception 'pair_source_invalid'; end if;
 if (select count(*) from public.large_data_pairs where created_by=p_owner and project_id=p_project and state in ('queued','verifying'))>=2
  then raise exception 'pair_queue_full'; end if;
 if not exists(select 1 from public.large_data_pair_workers where storage_identity=p_storage and last_seen>clock_timestamp()-interval '120 seconds')
  then raise exception 'pair_worker_not_ready'; end if;
 insert into public.large_data_pairs(organization_id,project_id,created_by,request_id,title,r1_id,r2_id,storage_identity,expected_bytes)
 values(a.organization_id,p_project,p_owner,p_request,p_title,p_r1,p_r2,p_storage,a.expected_bytes+b.expected_bytes) returning * into p;
 return to_jsonb(p);
end $$;

create function public.large_data_pair_get(p_owner uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.large_data_pairs;
begin
 select * into p from public.large_data_pairs where id=p_id and created_by=p_owner;
 if not found or not app_private.large_data_access(p_owner,p.project_id,false) then raise exception 'not_found' using errcode='42501'; end if;
 return to_jsonb(p)||jsonb_build_object('sources_available',app_private.large_data_pair_sources(p));
end $$;

create function public.large_data_pair_cancel(p_owner uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.large_data_pairs;
begin
 select * into p from public.large_data_pairs where id=p_id and created_by=p_owner for update;
 if not found or not app_private.large_data_access(p_owner,p.project_id,true) then raise exception 'not_found' using errcode='42501'; end if;
 if p.state in ('queued','verifying') then
  update public.large_data_pairs set state='cancelled',operation_token=null,lease_until=null,summary=null,updated_at=clock_timestamp()
   where id=p_id returning * into p;
 end if;
 return to_jsonb(p);
end $$;

create function public.large_data_pair_claim(p_worker uuid,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.large_data_pairs; a public.large_data_uploads; b public.large_data_uploads;
begin
 update public.large_data_pairs set state='verification_error',error_code='verification_attempts_exhausted',operation_token=null,updated_at=clock_timestamp()
  where storage_identity=p_storage and state='verifying' and lease_until<clock_timestamp() and attempts>=3;
 select * into p from public.large_data_pairs where storage_identity=p_storage and attempts<3
  and app_private.large_data_access(created_by,project_id,true)
  and (state='queued' or (state='verifying' and lease_until<clock_timestamp())) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 if not app_private.large_data_pair_sources(p) then
  update public.large_data_pairs set state='rejected',error_code='source_changed',summary=null,operation_token=null,updated_at=clock_timestamp() where id=p.id;
  return null;
 end if;
 select * into a from public.large_data_uploads where id=p.r1_id;
 select * into b from public.large_data_uploads where id=p.r2_id;
 update public.large_data_pairs set state='verifying',attempts=attempts+1,operation_token=gen_random_uuid(),
  lease_until=clock_timestamp()+interval '300 seconds',checked_bytes=0,checked_pairs=0,updated_at=clock_timestamp()
  where id=p.id returning * into p;
 return to_jsonb(p)||jsonb_build_object('sources',jsonb_build_array(to_jsonb(a),to_jsonb(b)));
end $$;

create function public.large_data_pair_progress(p_id uuid,p_token uuid,p_bytes bigint,p_pairs bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.large_data_pairs set checked_bytes=p_bytes,checked_pairs=p_pairs,lease_until=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp()
  where id=p_id and state='verifying' and operation_token=p_token and lease_until>clock_timestamp()
   and app_private.large_data_access(created_by,project_id,true) and p_bytes>=checked_bytes and p_bytes<=expected_bytes and p_pairs>=checked_pairs;
 return found;
end $$;

create function public.large_data_pair_finish(p_id uuid,p_token uuid,p_summary jsonb,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare p public.large_data_pairs; a public.large_data_uploads; b public.large_data_uploads;
begin
 select * into p from public.large_data_pairs where id=p_id and state='verifying' and operation_token=p_token
  and lease_until>clock_timestamp() for update;
 if not found or not app_private.large_data_access(p.created_by,p.project_id,true) then return false; end if;
 if p_error is null then
  if not app_private.large_data_pair_sources(p) then raise exception 'pair_source_invalid'; end if;
  select * into a from public.large_data_uploads where id=p.r1_id;
  select * into b from public.large_data_uploads where id=p.r2_id;
  if jsonb_typeof(p_summary) is distinct from 'object' or p_summary->>'schema' is distinct from 'genithm-large-pair-result/1'
    or p_summary->>'verifier_version' is distinct from 'genithm-large-pair/1.0.0'
    or p_summary->>'verification' is distinct from 'both_whole_object_sha256'
    or p_summary->'source_ids' is distinct from jsonb_build_array(a.id,b.id)
    or p_summary->'source_sha256' is distinct from jsonb_build_array(a.expected_sha256,b.expected_sha256)
    or p_summary->'source_bytes' is distinct from jsonb_build_array(a.expected_bytes,b.expected_bytes)
    or p_summary->>'pair_count' is distinct from p.checked_pairs::text or p.checked_pairs<1 or p.checked_bytes<>p.expected_bytes
    or p_summary->'mates'->0->>'read_count' is distinct from p.checked_pairs::text
    or p_summary->'mates'->1->>'read_count' is distinct from p.checked_pairs::text
    or p_summary->>'sampling' is distinct from 'false' then raise exception 'verification_contract_failed'; end if;
  update public.large_data_pairs set state='ready',summary=p_summary,operation_token=null,error_code=null,updated_at=clock_timestamp() where id=p_id;
 else
  if p_error not in ('pair_count_mismatch','pair_identifier_mismatch','pair_orientation_mismatch','pair_source_invalid',
    'source_changed','checksum_mismatch','format_invalid','resource_limit','transfer_error') then raise exception 'invalid_error_code'; end if;
  update public.large_data_pairs set state=case when p_error='transfer_error' then 'verification_error' else 'rejected' end,
    summary=null,operation_token=null,error_code=p_error,updated_at=clock_timestamp() where id=p_id;
 end if;
 return true;
end $$;

create function app_private.large_data_pair_cleanup_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='aborting' and old.state is distinct from new.state and exists(
  select 1 from public.large_data_pairs where (r1_id=old.id or r2_id=old.id) and state in ('queued','verifying')) then
  raise exception 'pair_source_in_use';
 end if;
 return new;
end $$;
create trigger large_data_pair_cleanup_guard before update of state on public.large_data_uploads
 for each row execute function app_private.large_data_pair_cleanup_guard();

revoke all on function app_private.large_data_pair_sources(public.large_data_pairs),app_private.large_data_pair_cleanup_guard() from public,anon,authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('large_data_pair_heartbeat','large_data_pair_overview','large_data_pair_enqueue',
   'large_data_pair_get','large_data_pair_cancel','large_data_pair_claim','large_data_pair_progress','large_data_pair_finish') loop
  execute 'revoke all on function '||f.sig||' from public,anon,authenticated';
  execute 'grant execute on function '||f.sig||' to service_role';
 end loop;
end $$;
comment on table public.large_data_pairs is 'Complete ordered paired FASTQ integrity and QC. No identifier uniqueness, molecular pairing or alignment is inferred. Historical results survive source cleanup and expose sources_available=false.';
