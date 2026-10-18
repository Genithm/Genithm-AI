-- V47 universal inert-file intake. No quota, bucket or compute is provisioned.
-- Existing files retain legacy behavior; new jobs require a V47 worker heartbeat.
alter table public.large_data_uploads
 add column intake_mode text not null default 'legacy' check (intake_mode in ('legacy','auto','preserve')),
 add column relative_path text,
 add column batch_id uuid;
alter table public.large_data_uploads add constraint large_data_relative_path_v47 check (
 intake_mode='legacy' or (relative_path is not null and char_length(relative_path) between 1 and 1024
 and relative_path !~ '(^/|//|/$|(^|/)\.\.?(/|$)|[[:cntrl:]])'
 and position(chr(92) in relative_path)=0 and position(':' in relative_path)=0));
create unique index large_data_batch_path_v47 on public.large_data_uploads(project_id,created_by,batch_id,relative_path)
 where batch_id is not null and state<>'aborted';
create index large_data_file_page_v47 on public.large_data_uploads(created_by,project_id,created_at desc,id desc);
alter table public.large_data_worker_heartbeats
 add column intake_version integer not null default 0 check (intake_version in (0,47));

create function public.large_data_reserve_file_v47(p_owner uuid,p_project uuid,p_request uuid,p_filename text,
 p_bytes bigint,p_sha256 text,p_format text,p_storage text,p_path text,p_batch uuid,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads; result jsonb; part text;
begin
 if not app_private.large_data_access(p_owner,p_project,true) then raise exception 'not_found' using errcode='42501'; end if;
 if p_mode is null or p_mode not in ('auto','preserve') or (p_mode='preserve' and p_format<>'opaque')
   then raise exception 'invalid_intake_mode'; end if;
 if p_filename is null or char_length(p_filename) not between 1 and 255 or p_filename<>btrim(p_filename)
   or p_filename in ('.','..') or p_filename ~ '[/[:cntrl:]]' or position(chr(92) in p_filename)>0 or position(':' in p_filename)>0
   then raise exception 'invalid_filename'; end if;
 if p_path is null or char_length(p_path) not between 1 and 1024 or p_path<>btrim(p_path)
   or p_path ~ '(^/|//|/$|(^|/)\.\.?(/|$)|[[:cntrl:]])'
   or position(chr(92) in p_path)>0 or position(':' in p_path)>0
   or reverse(split_part(reverse(p_path),'/',1))<>p_filename then raise exception 'invalid_relative_path'; end if;
 foreach part in array string_to_array(p_path,'/') loop
   if char_length(part) not between 1 and 255 or part<>btrim(part) then raise exception 'invalid_relative_path'; end if;
 end loop;
 -- Same lock order as V44 reservations: project allowance, then source metadata.
 perform 1 from public.large_data_project_limits where project_id=p_project for update;
 select * into u from public.large_data_uploads where project_id=p_project and created_by=p_owner and request_id=p_request;
 if found then
   if u.intake_mode is distinct from p_mode or u.relative_path is distinct from p_path or u.batch_id is distinct from p_batch
     then raise exception 'idempotency_conflict'; end if;
   return public.large_data_reserve(p_owner,p_project,p_request,p_filename,p_bytes,p_sha256,p_format,p_storage);
 end if;
 if not exists(select 1 from public.large_data_worker_heartbeats where intake_version=47 and storage_identity=p_storage
   and last_seen>clock_timestamp()-interval '120 seconds') then raise exception 'file_verifier_not_ready'; end if;
 if p_batch is not null and exists(select 1 from public.large_data_uploads where project_id=p_project and created_by=p_owner
   and batch_id=p_batch and relative_path=p_path and state<>'aborted') then raise exception 'batch_path_conflict'; end if;
 result:=public.large_data_reserve(p_owner,p_project,p_request,p_filename,p_bytes,p_sha256,p_format,p_storage);
 update public.large_data_uploads set intake_mode=p_mode,relative_path=p_path,batch_id=p_batch
 where id=(result->>'id')::uuid returning * into u;
 return to_jsonb(u);
end $$;

create function public.large_data_files_page_v47(p_owner uuid,p_project uuid,p_before uuid default null,
 p_batch uuid default null,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cursor_row public.large_data_uploads; rows jsonb; more boolean; last_id uuid;
begin
 if not app_private.large_data_access(p_owner,p_project,false) then raise exception 'not_found' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_cursor'; end if;
 if p_before is not null then
   select * into cursor_row from public.large_data_uploads where id=p_before and created_by=p_owner and project_id=p_project
     and (p_batch is null or batch_id=p_batch);
   if not found then raise exception 'invalid_cursor'; end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc),'[]'::jsonb) into rows from (
   select id,project_id,original_filename,relative_path,batch_id,intake_mode,expected_bytes,expected_sha256,
     actual_sha256,data_format,state,part_bytes,checked_bytes,summary,error_code,created_at,updated_at
   from public.large_data_uploads where created_by=p_owner and project_id=p_project
     and (p_batch is null or batch_id=p_batch)
     and (p_before is null or (created_at,id)<(cursor_row.created_at,cursor_row.id))
   order by created_at desc,id desc limit p_limit+1
 ) r;
 more:=jsonb_array_length(rows)>p_limit;
 if more then rows:=rows-p_limit; last_id:=(rows->(p_limit-1)->>'id')::uuid; end if;
 return jsonb_build_object('files',rows,'next',last_id,'project_id',p_project,'batch_id',p_batch);
end $$;

create function public.large_data_heartbeat_file_v47(p_worker uuid,p_storage text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.large_data_heartbeat(p_worker,p_storage);
 update public.large_data_worker_heartbeats set intake_version=47 where worker_id=p_worker;
end $$;

create function public.large_data_claim_file_v47(p_worker uuid,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads; legacy jsonb;
begin
 if not exists(select 1 from public.large_data_worker_heartbeats where worker_id=p_worker and storage_identity=p_storage
   and intake_version=47 and last_seen>clock_timestamp()-interval '120 seconds') then raise exception 'file_verifier_not_ready'; end if;
 legacy:=public.large_data_claim(p_worker,p_storage);
 if legacy is not null then return legacy; end if;
 update public.large_data_uploads set state='verification_error',error_code='verification_attempts_exhausted',operation_token=null
 where intake_mode<>'legacy' and state='verifying' and lease_until<clock_timestamp() and verification_attempts>=3 and storage_identity=p_storage;
 select * into u from public.large_data_uploads where intake_mode<>'legacy' and storage_identity=p_storage and verification_attempts<3
   and app_private.large_data_access(created_by,project_id,true)
   and (state='uploaded' or (state='verifying' and lease_until<clock_timestamp()))
   order by created_at,id for update skip locked limit 1;
 if not found then return null; end if;
 update public.large_data_uploads set state='verifying',verification_attempts=verification_attempts+1,
   operation_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '300 seconds',checked_bytes=0,
   updated_at=clock_timestamp() where id=u.id returning * into u;
 return to_jsonb(u);
end $$;


create or replace function public.large_data_limits(p_owner uuid, p_project uuid, p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.large_data_project_limits;
begin
 if not app_private.large_data_access(p_owner,p_project,false) then raise exception 'not_found' using errcode='42501'; end if;
 select * into q from public.large_data_project_limits where project_id=p_project;
 return jsonb_build_object('enabled',coalesce(q.enabled,false),'capacity_bytes',coalesce(q.capacity_bytes,0),
 'charged_bytes',coalesce(q.charged_bytes,0),'max_file_bytes',coalesce(q.max_file_bytes,0),
 'file_uploads_version',47,
 'file_verifier_ready',exists(select 1 from public.large_data_worker_heartbeats where intake_version=47 and storage_identity=p_storage
 and last_seen>clock_timestamp()-interval '120 seconds'),
 'verifier_ready',exists(select 1 from public.large_data_worker_heartbeats where storage_identity=p_storage
 and last_seen>clock_timestamp()-interval '120 seconds'));
end $$;

create or replace function public.large_data_heartbeat(p_worker uuid,p_storage text)
returns void language sql security definer set search_path='' as $$
 insert into public.large_data_worker_heartbeats(worker_id,last_seen,version,storage_identity)
 values(p_worker,clock_timestamp(),'genithm-large-data/1.0.0',p_storage)
 on conflict(worker_id) do update set last_seen=excluded.last_seen,storage_identity=excluded.storage_identity,intake_version=0;
$$;

create or replace function public.large_data_claim(p_worker uuid,p_storage text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads;
begin
 update public.large_data_uploads set state='verification_error',error_code='verification_attempts_exhausted',operation_token=null
 where intake_mode='legacy' and state='verifying' and lease_until<clock_timestamp() and verification_attempts>=3 and storage_identity=p_storage;
 select * into u from public.large_data_uploads where intake_mode='legacy' and storage_identity=p_storage and verification_attempts<3
 and app_private.large_data_access(created_by,project_id,true)
 and (state='uploaded' or (state='verifying' and lease_until<clock_timestamp()))
 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.large_data_uploads set state='verifying',verification_attempts=verification_attempts+1,
 operation_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '300 seconds',checked_bytes=0,
 updated_at=clock_timestamp() where id=u.id returning * into u;
 return to_jsonb(u);
end $$;

create or replace function public.large_data_finish_verification(p_id uuid,p_token uuid,p_sha256 text,p_summary jsonb,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare u public.large_data_uploads;
begin
 select * into u from public.large_data_uploads where id=p_id and state='verifying' and operation_token=p_token
 and lease_until>clock_timestamp() for update;
 if not found then return false; end if;
 if p_error is null then
   if u.intake_mode<>'legacy' then
     if not app_private.large_data_access(u.created_by,u.project_id,true) then return false; end if;
     if p_summary->>'verifier_version' is distinct from 'genithm-large-data/1.2.0'
       or p_summary->'intake'->>'schema' is distinct from 'genithm-file-intake/1'
       or p_summary->'intake'->>'mode' is distinct from u.intake_mode
       or p_summary->>'source_sha256' is distinct from u.expected_sha256
       or p_summary->>'report_sha256' is null then raise exception 'verification_contract_failed'; end if;
   end if;
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

-- Existing RLS and grants stay in force. No browser can invoke these service RPCs.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('large_data_reserve_file_v47','large_data_files_page_v47',
 'large_data_heartbeat_file_v47','large_data_claim_file_v47','large_data_limits','large_data_heartbeat',
 'large_data_claim','large_data_finish_verification') loop
 execute 'revoke all on function '||f.signature||' from public,anon,authenticated';
 execute 'grant execute on function '||f.signature||' to service_role';
 end loop;
end $$;
comment on column public.large_data_uploads.relative_path is 'Validated display-only source path. Never used as a storage key or extraction destination.';
comment on column public.large_data_uploads.intake_mode is 'legacy: V44-V46; auto: full FASTQ/FASTA inspection where available; preserve: integrity only, never execute or extract.';
