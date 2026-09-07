select pgmq.create('protein_annotation');

create table public.protein_annotation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  sequence_upload_id uuid not null,
  ncbi_retrieval_id uuid not null references public.sequence_retrievals(id) on delete restrict,
  refseq_accession text not null,
  input_sha256 text not null,
  input_residue_count bigint not null,
  request_fingerprint text not null,
  status text not null default 'queued',
  freshness_policy text not null default 'live_source_no_cache',
  source_checked_at timestamptz,
  mapping_provider text not null default 'uniprot',
  mapping_candidate_count integer,
  mapping_response_sha256 text,
  mapping_response_bytes bigint,
  uniprot_accession text,
  uniprot_entry_id text,
  uniprot_reviewed boolean,
  uniprot_release text,
  uniprot_release_date text,
  uniprot_sequence_sha256 text,
  uniprot_response_sha256 text,
  uniprot_response_bytes bigint,
  protein_name text,
  gene_names jsonb,
  organism_name text,
  interpro_entries jsonb,
  interpro_response_sha256 text,
  interpro_response_bytes bigint,
  pfam_entries jsonb,
  pfam_response_sha256 text,
  pfam_response_bytes bigint,
  annotation_summary jsonb,
  connector_version text,
  result_message text,
  processing_attempts integer not null default 0,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint protein_annotation_jobs_project_org_fkey foreign key (project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
  constraint protein_annotation_jobs_upload_project_org_fkey foreign key (sequence_upload_id,project_id,organization_id) references public.sequence_uploads(id,project_id,organization_id) on delete restrict,
  constraint protein_annotation_jobs_refseq check (char_length(refseq_accession) between 3 and 64 and refseq_accession ~ '^[A-Z0-9_]+(\.[0-9]+)?$'),
  constraint protein_annotation_jobs_input_sha check (input_sha256 ~ '^[0-9a-f]{64}$'),
  constraint protein_annotation_jobs_input_residues check (input_residue_count between 1 and 200000),
  constraint protein_annotation_jobs_fingerprint check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint protein_annotation_jobs_status check (status in ('queued','retrieving','completed','no_mapping','rejected','error')),
  constraint protein_annotation_jobs_freshness check (freshness_policy='live_source_no_cache'),
  constraint protein_annotation_jobs_provider check (mapping_provider='uniprot'),
  constraint protein_annotation_jobs_candidate_count check (mapping_candidate_count is null or mapping_candidate_count between 0 and 100),
  constraint protein_annotation_jobs_mapping_sha check (mapping_response_sha256 is null or mapping_response_sha256 ~ '^[0-9a-f]{64}$'),
  constraint protein_annotation_jobs_mapping_bytes check (mapping_response_bytes is null or mapping_response_bytes between 1 and 10485760),
  constraint protein_annotation_jobs_uniprot_accession check (uniprot_accession is null or (char_length(uniprot_accession) between 6 and 20 and uniprot_accession ~ '^[A-Z0-9-]+$')),
  constraint protein_annotation_jobs_uniprot_seq_sha check (uniprot_sequence_sha256 is null or uniprot_sequence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint protein_annotation_jobs_uniprot_sha check (uniprot_response_sha256 is null or uniprot_response_sha256 ~ '^[0-9a-f]{64}$'),
  constraint protein_annotation_jobs_uniprot_bytes check (uniprot_response_bytes is null or uniprot_response_bytes between 1 and 10485760),
  constraint protein_annotation_jobs_interpro_sha check (interpro_response_sha256 is null or interpro_response_sha256 ~ '^[0-9a-f]{64}$'),
  constraint protein_annotation_jobs_interpro_bytes check (interpro_response_bytes is null or interpro_response_bytes between 1 and 20971520),
  constraint protein_annotation_jobs_pfam_sha check (pfam_response_sha256 is null or pfam_response_sha256 ~ '^[0-9a-f]{64}$'),
  constraint protein_annotation_jobs_pfam_bytes check (pfam_response_bytes is null or pfam_response_bytes between 1 and 20971520),
  constraint protein_annotation_jobs_gene_names check (gene_names is null or jsonb_typeof(gene_names)='array'),
  constraint protein_annotation_jobs_interpro check (interpro_entries is null or jsonb_typeof(interpro_entries)='array'),
  constraint protein_annotation_jobs_pfam check (pfam_entries is null or jsonb_typeof(pfam_entries)='array'),
  constraint protein_annotation_jobs_summary check (annotation_summary is null or jsonb_typeof(annotation_summary)='object'),
  constraint protein_annotation_jobs_attempts check (processing_attempts >= 0),
  constraint protein_annotation_jobs_error_length check (processing_error is null or char_length(processing_error) <= 2000),
  constraint protein_annotation_jobs_message_length check (result_message is null or char_length(result_message) <= 2000)
);

create unique index protein_annotation_jobs_active_fingerprint_idx on public.protein_annotation_jobs(organization_id,request_fingerprint) where status in ('queued','retrieving');
create index protein_annotation_jobs_org_created_idx on public.protein_annotation_jobs(organization_id,created_at desc);
create index protein_annotation_jobs_project_created_idx on public.protein_annotation_jobs(project_id,created_at desc);
create index protein_annotation_jobs_requested_by_idx on public.protein_annotation_jobs(requested_by,created_at desc);
create index protein_annotation_jobs_upload_idx on public.protein_annotation_jobs(sequence_upload_id,created_at desc);
create index protein_annotation_jobs_retrieval_idx on public.protein_annotation_jobs(ncbi_retrieval_id);
create index protein_annotation_jobs_project_org_fk_idx on public.protein_annotation_jobs(project_id,organization_id);
create index protein_annotation_jobs_upload_project_org_fk_idx on public.protein_annotation_jobs(sequence_upload_id,project_id,organization_id);
create index protein_annotation_jobs_status_idx on public.protein_annotation_jobs(status,created_at);

alter table public.protein_annotation_jobs enable row level security;
alter table public.protein_annotation_jobs force row level security;
create policy protein_annotation_jobs_select_org_member on public.protein_annotation_jobs for select to authenticated using ((select app_private.is_org_member(organization_id)));
revoke all on table public.protein_annotation_jobs from public,anon,authenticated,service_role;
grant select on table public.protein_annotation_jobs to authenticated;

insert into app_private.scientific_rate_limit_policies(action,window_seconds,user_limit,organization_limit)
values ('protein_annotation',3600,20,80)
on conflict (action) do update set window_seconds=excluded.window_seconds,user_limit=excluded.user_limit,organization_limit=excluded.organization_limit;

create or replace function app_private.request_protein_annotation(p_project_id uuid,p_sequence_upload_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller_id uuid := auth.uid(); org_id uuid; input public.sequence_uploads%rowtype; retrieval public.sequence_retrievals%rowtype; fingerprint text; existing_id uuid; new_id uuid; queue_message_id bigint; user_active integer; org_active integer;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  select organization_id into org_id from public.projects where id=p_project_id;
  if not found then raise exception 'project not found' using errcode='P0002'; end if;
  if not app_private.can_write_org(org_id) then raise exception 'project write access denied' using errcode='42501'; end if;
  select * into input from public.sequence_uploads where id=p_sequence_upload_id and project_id=p_project_id and organization_id=org_id;
  if not found then raise exception 'protein sequence not found' using errcode='P0002'; end if;
  if input.status<>'ready' or input.sha256 is null or input.sequence_count<>1 or input.sequence_type<>'protein' or input.residue_count is null or input.residue_count<1 or input.residue_count>200000 then raise exception 'protein annotation requires one validated ready protein sequence within V1 bounds'; end if;
  if input.file_size_bytes<1 or input.file_size_bytes>2097152 then raise exception 'protein annotation input exceeds worker read limit'; end if;
  select * into retrieval from public.sequence_retrievals where sequence_upload_id=input.id and project_id=p_project_id and organization_id=org_id and source_provider='ncbi' and source_database='protein' and status='retrieved' and resolved_accession is not null order by created_at desc limit 1;
  if not found then raise exception 'protein annotation V1 requires a successful NCBI protein retrieval source'; end if;
  fingerprint := encode(extensions.digest(convert_to(concat_ws(E'\x1f','protein_annotation',p_project_id::text,input.id::text,input.sha256,retrieval.id::text,retrieval.resolved_accession),'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,17321));
  select id into existing_id from public.protein_annotation_jobs where organization_id=org_id and request_fingerprint=fingerprint and status in ('queued','retrieving') order by created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;
  perform app_private.consume_scientific_rate_limit('protein_annotation',caller_id,org_id);
  select count(*) into user_active from public.protein_annotation_jobs where requested_by=caller_id and status in ('queued','retrieving');
  select count(*) into org_active from public.protein_annotation_jobs where organization_id=org_id and status in ('queued','retrieving');
  if user_active>=3 or org_active>=15 then raise sqlstate 'PGRST' using message=jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active protein annotation requests. Wait for current source checks to finish.')::text,detail=jsonb_build_object('status',429)::text; end if;
  insert into public.protein_annotation_jobs(organization_id,project_id,requested_by,sequence_upload_id,ncbi_retrieval_id,refseq_accession,input_sha256,input_residue_count,request_fingerprint) values(org_id,p_project_id,caller_id,input.id,retrieval.id,retrieval.resolved_accession,input.sha256,input.residue_count,fingerprint) returning id into new_id;
  select pgmq.send(queue_name=>'protein_annotation',msg=>jsonb_build_object('job_id',new_id)) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue protein annotation'; end if;
  return new_id;
end;$$;

create or replace function public.request_protein_annotation(project_id uuid,sequence_upload_id uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.request_protein_annotation(project_id,sequence_upload_id); $$;
revoke all on function app_private.request_protein_annotation(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.request_protein_annotation(uuid,uuid) to authenticated;
revoke all on function public.request_protein_annotation(uuid,uuid) from public,anon,service_role;
grant execute on function public.request_protein_annotation(uuid,uuid) to authenticated;

create or replace function app_private.claim_protein_annotation_job(p_visibility_seconds integer default 300)
returns table(message_id bigint,job_id uuid,organization_id uuid,project_id uuid,requested_by uuid,sequence_upload_id uuid,refseq_accession text,input_object_path text,input_file_size_bytes bigint,input_sha256 text,input_residue_count bigint)
language plpgsql security definer set search_path='' as $$
declare q record; target public.protein_annotation_jobs%rowtype; upload public.sequence_uploads%rowtype; target_id uuid;
begin
  if p_visibility_seconds<60 or p_visibility_seconds>900 then raise exception 'visibility timeout must be between 60 and 900 seconds'; end if;
  select * into q from pgmq.read(queue_name=>'protein_annotation',vt=>p_visibility_seconds,qty=>1) limit 1;
  if not found then return; end if;
  begin target_id := (q.message->>'job_id')::uuid; exception when others then perform pgmq.delete('protein_annotation',q.msg_id); return; end;
  select * into target from public.protein_annotation_jobs where id=target_id for update;
  if not found or target.status<>'queued' then perform pgmq.delete('protein_annotation',q.msg_id); return; end if;
  select * into upload from public.sequence_uploads where id=target.sequence_upload_id and project_id=target.project_id and organization_id=target.organization_id;
  if not found or upload.status<>'ready' or upload.sequence_count<>1 or upload.sequence_type<>'protein' or upload.sha256 is distinct from target.input_sha256 or upload.residue_count is distinct from target.input_residue_count or upload.file_size_bytes<1 or upload.file_size_bytes>2097152 then update public.protein_annotation_jobs set status='rejected',source_checked_at=now(),result_message='Input provenance changed or no longer satisfies protein annotation requirements.',processing_finished_at=now(),updated_at=now() where id=target.id; perform pgmq.delete('protein_annotation',q.msg_id); return; end if;
  update public.protein_annotation_jobs set status='retrieving',processing_attempts=processing_attempts+1,processing_started_at=coalesce(processing_started_at,now()),processing_error=null,updated_at=now() where id=target.id returning * into target;
  return query select q.msg_id::bigint,target.id,target.organization_id,target.project_id,target.requested_by,target.sequence_upload_id,target.refseq_accession,upload.object_path,upload.file_size_bytes,target.input_sha256,target.input_residue_count;
end;$$;

create or replace function public.claim_protein_annotation_job(visibility_seconds integer default 300)
returns table(message_id bigint,job_id uuid,organization_id uuid,project_id uuid,requested_by uuid,sequence_upload_id uuid,refseq_accession text,input_object_path text,input_file_size_bytes bigint,input_sha256 text,input_residue_count bigint)
language sql security invoker set search_path='' as $$ select * from app_private.claim_protein_annotation_job(visibility_seconds); $$;
revoke all on function app_private.claim_protein_annotation_job(integer) from public,anon,authenticated;
grant execute on function app_private.claim_protein_annotation_job(integer) to service_role;
revoke all on function public.claim_protein_annotation_job(integer) from public,anon,authenticated;
grant execute on function public.claim_protein_annotation_job(integer) to service_role;

create or replace function app_private.finish_protein_annotation_no_mapping(p_message_id bigint,p_job_id uuid,p_connector_version text,p_mapping_response_sha256 text,p_mapping_response_bytes bigint)
returns void language plpgsql security definer set search_path='' as $$
declare target public.protein_annotation_jobs%rowtype;
begin
  select * into target from public.protein_annotation_jobs where id=p_job_id for update;
  if not found or target.status<>'retrieving' then raise exception 'protein annotation job is not active' using errcode='P0002'; end if;
  if nullif(trim(p_connector_version),'') is null or char_length(trim(p_connector_version))>128 then raise exception 'connector version is invalid'; end if;
  if p_mapping_response_sha256 !~ '^[0-9a-f]{64}$' or p_mapping_response_bytes<1 or p_mapping_response_bytes>10485760 then raise exception 'mapping response provenance is invalid'; end if;
  update public.protein_annotation_jobs set status='no_mapping',freshness_policy='live_source_no_cache',source_checked_at=now(),mapping_candidate_count=0,mapping_response_sha256=p_mapping_response_sha256,mapping_response_bytes=p_mapping_response_bytes,connector_version=trim(p_connector_version),result_message='No UniProtKB mapping was returned for this exact RefSeq protein accession at request time.',processing_finished_at=now(),processing_error=null,updated_at=now() where id=target.id;
  if not pgmq.delete('protein_annotation',p_message_id) then raise exception 'protein annotation queue message delete failed'; end if;
end;$$;

create or replace function public.finish_protein_annotation_no_mapping(message_id bigint,job_id uuid,connector_version text,mapping_response_sha256 text,mapping_response_bytes bigint) returns void language sql security invoker set search_path='' as $$ select app_private.finish_protein_annotation_no_mapping(message_id,job_id,connector_version,mapping_response_sha256,mapping_response_bytes); $$;
revoke all on function app_private.finish_protein_annotation_no_mapping(bigint,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function app_private.finish_protein_annotation_no_mapping(bigint,uuid,text,text,bigint) to service_role;
revoke all on function public.finish_protein_annotation_no_mapping(bigint,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.finish_protein_annotation_no_mapping(bigint,uuid,text,text,bigint) to service_role;

-- Success and error completion functions are intentionally narrow service-role RPCs.
create or replace function app_private.finish_protein_annotation_error(p_message_id bigint,p_job_id uuid,p_processing_error text,p_retryable boolean default true,p_max_attempts integer default 3)
returns text language plpgsql security definer set search_path='' as $$
declare target public.protein_annotation_jobs%rowtype;
begin
  select * into target from public.protein_annotation_jobs where id=p_job_id for update;
  if not found or target.status<>'retrieving' then raise exception 'protein annotation job is not active' using errcode='P0002'; end if;
  if p_max_attempts<1 or p_max_attempts>10 then raise exception 'max attempts is invalid'; end if;
  if p_retryable and target.processing_attempts<p_max_attempts then update public.protein_annotation_jobs set status='queued',processing_error=left(p_processing_error,2000),updated_at=now() where id=target.id; return 'queued'; end if;
  update public.protein_annotation_jobs set status='error',source_checked_at=coalesce(source_checked_at,now()),processing_error=left(p_processing_error,2000),processing_finished_at=now(),updated_at=now() where id=target.id;
  if not pgmq.delete('protein_annotation',p_message_id) then raise exception 'protein annotation queue message delete failed'; end if;
  return 'error';
end;$$;

create or replace function public.finish_protein_annotation_error(message_id bigint,job_id uuid,processing_error text,retryable boolean default true,max_attempts integer default 3) returns text language sql security invoker set search_path='' as $$ select app_private.finish_protein_annotation_error(message_id,job_id,processing_error,retryable,max_attempts); $$;
revoke all on function app_private.finish_protein_annotation_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function app_private.finish_protein_annotation_error(bigint,uuid,text,boolean,integer) to service_role;
revoke all on function public.finish_protein_annotation_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.finish_protein_annotation_error(bigint,uuid,text,boolean,integer) to service_role;
