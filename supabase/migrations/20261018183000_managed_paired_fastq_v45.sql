-- V45: queued, owner-scoped, complete R1/R2 reconciliation over already verified objects.
-- No raw reads, cloud bucket, project allowance, or execution enablement is created.
create table public.large_data_pairs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 project_id uuid not null references public.projects(id),
 created_by uuid not null references auth.users(id),
 request_id uuid not null,
 title text not null check(char_length(btrim(title)) between 3 and 160),
 read1_id uuid not null references public.large_data_uploads(id),
 read2_id uuid not null references public.large_data_uploads(id),
 read1_sha256 text not null check(read1_sha256 ~ '^[a-f0-9]{64}$'),
 read2_sha256 text not null check(read2_sha256 ~ '^[a-f0-9]{64}$'),
 read1_bytes bigint not null check(read1_bytes between 1 and 107374182400),
 read2_bytes bigint not null check(read2_bytes between 1 and 107374182400),
 read1_etag text not null,
 read2_etag text not null,
 storage_identity text not null check(storage_identity ~ '^[a-f0-9]{64}$'),
 state text not null default 'queued' check(state in ('queued','running','ready','rejected','error','cancelled')),
 checked_read1_bytes bigint not null default 0 check(checked_read1_bytes between 0 and read1_bytes),
 checked_read2_bytes bigint not null default 0 check(checked_read2_bytes between 0 and read2_bytes),
 attempts integer not null default 0 check(attempts between 0 and 3),
 operation_token uuid,
 lease_until timestamptz,
 result jsonb check(result is null or (jsonb_typeof(result)='object' and pg_column_size(result)<=32768)),
 result_sha256 text check(result_sha256 is null or result_sha256 ~ '^[a-f0-9]{64}$'),
 error_code text check(error_code is null or error_code in ('pair_count_mismatch','pair_identifier_mismatch',
   'mate_orientation_mismatch','checksum_mismatch','format_invalid','source_changed','resource_limit',
   'transfer_error','attempts_exhausted','access_revoked')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(project_id,created_by,request_id),
 check(read1_id<>read2_id),
 check(state<>'ready' or (result is not null and result_sha256 is not null and
   checked_read1_bytes=read1_bytes and checked_read2_bytes=read2_bytes))
);
create index large_data_pairs_owner_recent on public.large_data_pairs(created_by,project_id,created_at desc);
create index large_data_pairs_queue on public.large_data_pairs(storage_identity,state,lease_until,created_at);
create index large_data_pairs_source1 on public.large_data_pairs(read1_id) where state in ('queued','running');
create index large_data_pairs_source2 on public.large_data_pairs(read2_id) where state in ('queued','running');
create table public.large_data_pair_workers (
 worker_id uuid primary key, last_seen timestamptz not null,
 storage_identity text not null check(storage_identity ~ '^[a-f0-9]{64}$'),
 version text not null check(version='genithm-large-data-pair/1.0.0')
);
alter table public.large_data_pairs enable row level security;
alter table public.large_data_pair_workers enable row level security;
revoke all on public.large_data_pairs,public.large_data_pair_workers from public,anon,authenticated;
grant select,insert,update on public.large_data_pairs,public.large_data_pair_workers to service_role;

create function app_private.large_data_pair_sources_valid(p public.large_data_pairs)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.large_data_uploads a,public.large_data_uploads b
 where a.id=p.read1_id and b.id=p.read2_id and a.state='ready' and b.state='ready'
 and a.created_by=p.created_by and b.created_by=p.created_by
 and a.project_id=p.project_id and b.project_id=p.project_id
 and a.organization_id=p.organization_id and b.organization_id=p.organization_id
 and a.storage_identity=p.storage_identity and b.storage_identity=p.storage_identity
 and a.actual_sha256=p.read1_sha256 and b.actual_sha256=p.read2_sha256
 and a.expected_sha256=p.read1_sha256 and b.expected_sha256=p.read2_sha256
 and a.expected_bytes=p.read1_bytes and b.expected_bytes=p.read2_bytes
 and a.object_etag=p.read1_etag and b.object_etag=p.read2_etag
 and a.data_format in ('fastq','fastq.gz') and b.data_format in ('fastq','fastq.gz'));
$$;

create function public.large_data_pair_heartbeat(p_worker uuid,p_storage text)
returns void language sql security definer set search_path='' as $$
 insert into public.large_data_pair_workers(worker_id,last_seen,storage_identity,version)
 values(p_worker,clock_timestamp(),p_storage,'genithm-large-data-pair/1.0.0')
 on conflict(worker_id) do update set last_seen=excluded.last_seen,storage_identity=excluded.storage_identity;
$$;

create function public.large_data_pair_list(p_owner uuid,p_project uuid,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not app_private.large_data_access(p_owner,p_project,false) then raise exception 'not_found' using errcode='42501'; end if;
 return jsonb_build_object('worker_ready',exists(select 1 from public.large_data_pair_workers
   where storage_identity=p_storage and last_seen>clock_timestamp()-interval '120 seconds'),
 'jobs',coalesce((select jsonb_agg(to_jsonb(r)) from (select id,project_id,title,read1_id,read2_id,
 state,checked_read1_bytes,checked_read2_bytes,read1_bytes,read2_bytes,error_code,created_at,updated_at
 from public.large_data_pairs where project_id=p_project and created_by=p_owner
 order by created_at desc limit 30) r),'[]'::jsonb));
end $$;

create function public.large_data_pair_get(p_owner uuid,p_id uuid,p_write boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.large_data_pairs;
begin
 select * into j from public.large_data_pairs where id=p_id and created_by=p_owner;
 if not found or not app_private.large_data_access(p_owner,j.project_id,p_write) then raise exception 'not_found' using errcode='42501'; end if;
 return to_jsonb(j);
end $$;

create function public.large_data_pair_create(p_owner uuid,p_project uuid,p_request uuid,
 p_read1 uuid,p_read2 uuid,p_title text,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.large_data_project_limits; a public.large_data_uploads; b public.large_data_uploads; j public.large_data_pairs;
begin
 if not app_private.large_data_access(p_owner,p_project,true) then raise exception 'not_found' using errcode='42501'; end if;
 -- Lock project allowance to serialize admission/rate checks, then source rows in canonical order.
 select * into q from public.large_data_project_limits where project_id=p_project for update;
 if not found or not q.enabled then raise exception 'quota_not_configured'; end if;
 select * into j from public.large_data_pairs where project_id=p_project and created_by=p_owner and request_id=p_request;
 if found then
   if j.read1_id<>p_read1 or j.read2_id<>p_read2 or j.title<>p_title or j.storage_identity<>p_storage
     then raise exception 'idempotency_conflict'; end if;
   return to_jsonb(j);
 end if;
 if p_read1=p_read2 then raise exception 'distinct_mates_required'; end if;
 perform id from public.large_data_uploads where id in (p_read1,p_read2) order by id for update;
 select * into a from public.large_data_uploads where id=p_read1;
 select * into b from public.large_data_uploads where id=p_read2;
 if a.id is null or b.id is null or a.created_by<>p_owner or b.created_by<>p_owner or
    a.project_id<>p_project or b.project_id<>p_project or a.state<>'ready' or b.state<>'ready' or
    a.storage_identity<>p_storage or b.storage_identity<>p_storage or
    a.actual_sha256 is distinct from a.expected_sha256 or b.actual_sha256 is distinct from b.expected_sha256 or
    a.data_format not in ('fastq','fastq.gz') or b.data_format not in ('fastq','fastq.gz')
 then raise exception 'pair_sources_unavailable'; end if;
 if (select count(*) from public.large_data_pairs where project_id=p_project and state in ('queued','running'))>=2
    or (select count(*) from public.large_data_pairs where project_id=p_project and created_by=p_owner
      and created_at>clock_timestamp()-interval '1 hour')>=10
 then raise exception 'pair_capacity_exceeded'; end if;
 if not exists(select 1 from public.large_data_pair_workers where storage_identity=p_storage
    and last_seen>clock_timestamp()-interval '120 seconds') then raise exception 'pair_worker_not_ready'; end if;
 insert into public.large_data_pairs(organization_id,project_id,created_by,request_id,title,read1_id,read2_id,
   read1_sha256,read2_sha256,read1_bytes,read2_bytes,read1_etag,read2_etag,storage_identity)
 values(a.organization_id,p_project,p_owner,p_request,p_title,p_read1,p_read2,a.expected_sha256,b.expected_sha256,
   a.expected_bytes,b.expected_bytes,a.object_etag,b.object_etag,p_storage) returning * into j;
 return to_jsonb(j);
end $$;

create function public.large_data_pair_claim(p_worker uuid,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.large_data_pairs; a public.large_data_uploads; b public.large_data_uploads;
begin
 update public.large_data_pairs set state='error',error_code='attempts_exhausted',operation_token=null,
 updated_at=clock_timestamp() where state='running' and lease_until<clock_timestamp() and attempts>=3 and storage_identity=p_storage;
 update public.large_data_pairs set state='cancelled',error_code='access_revoked',operation_token=null,updated_at=clock_timestamp()
 where state in ('queued','running') and storage_identity=p_storage and
 (not app_private.large_data_access(created_by,project_id,true) or not exists(
   select 1 from public.large_data_project_limits q where q.project_id=large_data_pairs.project_id and q.enabled));
 update public.large_data_pairs set state='rejected',error_code='source_changed',operation_token=null,updated_at=clock_timestamp()
 where state in ('queued','running') and storage_identity=p_storage and not app_private.large_data_pair_sources_valid(large_data_pairs);
 select * into j from public.large_data_pairs where storage_identity=p_storage and attempts<3
 and (state='queued' or (state='running' and lease_until<clock_timestamp()))
 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.large_data_pairs set state='running',attempts=attempts+1,operation_token=gen_random_uuid(),
 lease_until=clock_timestamp()+interval '300 seconds',checked_read1_bytes=0,checked_read2_bytes=0,updated_at=clock_timestamp()
 where id=j.id returning * into j;
 select * into a from public.large_data_uploads where id=j.read1_id;
 select * into b from public.large_data_uploads where id=j.read2_id;
 return jsonb_build_object('job',to_jsonb(j),'r1',to_jsonb(a),'r2',to_jsonb(b));
end $$;

create function public.large_data_pair_progress(p_id uuid,p_token uuid,p_read1_bytes bigint,p_read2_bytes bigint)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.large_data_pairs set checked_read1_bytes=p_read1_bytes,checked_read2_bytes=p_read2_bytes,
 lease_until=clock_timestamp()+interval '300 seconds',updated_at=clock_timestamp()
 where id=p_id and state='running' and operation_token=p_token and lease_until>clock_timestamp()
 and p_read1_bytes between checked_read1_bytes and read1_bytes and p_read2_bytes between checked_read2_bytes and read2_bytes
 and app_private.large_data_access(created_by,project_id,true)
 and app_private.large_data_pair_sources_valid(large_data_pairs)
 and exists(select 1 from public.large_data_project_limits q where q.project_id=large_data_pairs.project_id and q.enabled);
 return found;
end $$;

create function public.large_data_pair_finish(p_id uuid,p_token uuid,p_result jsonb,p_sha256 text,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.large_data_pairs;
begin
 select * into j from public.large_data_pairs where id=p_id and state='running' and operation_token=p_token
 and lease_until>clock_timestamp() for update;
 if not found then return false; end if;
 if not app_private.large_data_access(j.created_by,j.project_id,true) or not exists(
   select 1 from public.large_data_project_limits where project_id=j.project_id and enabled) then
   update public.large_data_pairs set state='cancelled',error_code='access_revoked',operation_token=null,updated_at=clock_timestamp() where id=p_id;
   return false;
 end if;
 if not app_private.large_data_pair_sources_valid(j) then p_error:='source_changed'; end if;
 if p_error is null then
   if p_result is null or jsonb_typeof(p_result) is distinct from 'object' or
      p_result->>'schema' is distinct from 'genithm-paired-fastq-result/1' or
      p_result->>'verifier_version' is distinct from 'genithm-large-data-pair/1.0.0' or
      p_result->>'verification' is distinct from 'whole_object_sha256_both' or
      p_result->>'sampling' is distinct from 'false' or
      p_result#>>'{r1,upload_id}' is distinct from j.read1_id::text or
      p_result#>>'{r2,upload_id}' is distinct from j.read2_id::text or
      p_result#>>'{r1,sha256}' is distinct from j.read1_sha256 or
      p_result#>>'{r2,sha256}' is distinct from j.read2_sha256 or
      p_result#>>'{r1,source_bytes}' is distinct from j.read1_bytes::text or
      p_result#>>'{r2,source_bytes}' is distinct from j.read2_bytes::text or
      coalesce(p_result->>'matched_pairs','') !~ '^[1-9][0-9]*$' or
      p_result#>>'{r1,metrics,read_count}' is distinct from p_result->>'matched_pairs' or
      p_result#>>'{r2,metrics,read_count}' is distinct from p_result->>'matched_pairs' or
      p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'pair_result_invalid'; end if;
   update public.large_data_pairs set state='ready',result=p_result,result_sha256=p_sha256,
     checked_read1_bytes=read1_bytes,checked_read2_bytes=read2_bytes,operation_token=null,error_code=null,
     updated_at=clock_timestamp() where id=p_id;
 else
   if p_error not in ('pair_count_mismatch','pair_identifier_mismatch','mate_orientation_mismatch',
      'checksum_mismatch','format_invalid','source_changed','resource_limit','transfer_error') then raise exception 'pair_result_invalid'; end if;
   update public.large_data_pairs set state=case when p_error='transfer_error' then 'error' else 'rejected' end,
     result=null,result_sha256=null,error_code=p_error,operation_token=null,updated_at=clock_timestamp() where id=p_id;
 end if;
 return true;
end $$;

create function public.large_data_pair_cancel(p_owner uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.large_data_pairs;
begin
 select * into j from public.large_data_pairs where id=p_id and created_by=p_owner for update;
 if not found or not app_private.large_data_access(p_owner,j.project_id,true) then raise exception 'not_found' using errcode='42501'; end if;
 if j.state in ('queued','running') then
   update public.large_data_pairs set state='cancelled',operation_token=null,result=null,result_sha256=null,
     updated_at=clock_timestamp() where id=p_id returning * into j;
 end if;
 return to_jsonb(j);
end $$;

-- Admission and removal both lock the source upload rows: no deletion while a job is active.
create function app_private.large_data_pair_source_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.state='ready' and (new.state is distinct from old.state or
   new.expected_sha256 is distinct from old.expected_sha256 or new.object_etag is distinct from old.object_etag) and
   exists(select 1 from public.large_data_pairs where (read1_id=old.id or read2_id=old.id) and state in ('queued','running'))
 then raise exception 'source_in_active_pair'; end if;
 return new;
end $$;
create trigger large_data_pair_protect_inputs before update on public.large_data_uploads
for each row execute function app_private.large_data_pair_source_guard();
revoke all on function app_private.large_data_pair_source_guard() from public,anon,authenticated,service_role;
revoke all on function app_private.large_data_pair_sources_valid(public.large_data_pairs) from public,anon,authenticated;
grant execute on function app_private.large_data_pair_sources_valid(public.large_data_pairs) to service_role;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('large_data_pair_heartbeat','large_data_pair_list','large_data_pair_get',
 'large_data_pair_create','large_data_pair_claim','large_data_pair_progress','large_data_pair_finish','large_data_pair_cancel') loop
 execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end $$;
comment on table public.large_data_pairs is 'Ordered full-object R1/R2 correspondence and QC. Does not assert read-name uniqueness, biological pairing, alignment or expression analysis.';
