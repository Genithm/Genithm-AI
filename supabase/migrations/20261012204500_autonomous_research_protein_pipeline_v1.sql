-- Science V14: explicitly approved, once-only NCBI protein -> validation -> protein properties.
-- Source-controlled migration: NOT applied to the live Supabase project by this PR.
-- No general-purpose executable DAGs or retry/resubmission endpoints are introduced.

create table public.research_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  template text not null default 'ncbi_protein_profile_v1',
  requested_accession text not null,
  retrieval_id uuid not null unique references public.sequence_retrievals(id) on delete restrict,
  sequence_upload_id uuid references public.sequence_uploads(id) on delete restrict,
  sequence_sha256 text,
  scientific_job_id uuid unique references public.scientific_jobs(id) on delete restrict,
  status text not null default 'awaiting_source',
  failure_stage text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint research_pipeline_project_scope_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete restrict,
  constraint research_pipeline_template_ck check (template = 'ncbi_protein_profile_v1'),
  constraint research_pipeline_accession_ck check (
    char_length(requested_accession) between 1 and 64
    and requested_accession ~ '^[A-Z0-9_]+(\.[0-9]+)?$'
    and requested_accession ~ '[A-Z]'
  ),
  constraint research_pipeline_state_ck check
    (status in ('awaiting_source','awaiting_validation','running','completed','error')),
  constraint research_pipeline_sha_ck check
    (sequence_sha256 is null or sequence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint research_pipeline_status_job_ck check
    (status not in ('running','completed') or
      (scientific_job_id is not null and sequence_upload_id is not null and sequence_sha256 is not null)),
  constraint research_pipeline_finish_ck check
    ((status in ('awaiting_source','awaiting_validation','running') and finished_at is null) or
     (status in ('completed','error') and finished_at is not null)),
  constraint research_pipeline_failure_ck check (
    (failure_stage is null and failure_code is null) or
    (status='error' and failure_stage in ('source','validation','dispatch','analysis','integrity')
      and failure_code in ('source_failed','validation_failed','input_scope_invalid',
        'dispatch_rejected','analysis_failed','result_metadata_invalid'))
  )
);

create index research_pipeline_owner_recent_idx
  on public.research_pipeline_runs(requested_by,created_at desc);
create index research_pipeline_project_recent_idx
  on public.research_pipeline_runs(project_id,created_at desc);
create index research_pipeline_waiting_upload_idx
  on public.research_pipeline_runs(sequence_upload_id)
  where status='awaiting_validation';
create trigger research_pipeline_updated_at
before update on public.research_pipeline_runs
for each row execute function app_private.set_updated_at();

alter table public.research_pipeline_runs enable row level security;
alter table public.research_pipeline_runs force row level security;

create policy research_pipeline_select_owner on public.research_pipeline_runs
  for select to authenticated
  using ((select auth.uid())=requested_by
         and (select app_private.is_org_member(organization_id)));

revoke all on public.research_pipeline_runs from public, anon, authenticated, service_role;
grant select on public.research_pipeline_runs to authenticated;

-- Internal advancement is restricted to system triggers and creation RPC below.
-- A row-level lock serializes competing source/validation callbacks.
create or replace function app_private.advance_research_protein_pipeline(p_run_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  run public.research_pipeline_runs%rowtype;
  source public.sequence_retrievals%rowtype;
  seq public.sequence_uploads%rowtype;
  created_job uuid;
  original_sub text;
  original_role text;
begin
  select * into run from public.research_pipeline_runs where id=p_run_id for update;
  if not found or run.status not in ('awaiting_source','awaiting_validation') then return; end if;

  select * into source from public.sequence_retrievals
  where id=run.retrieval_id and project_id=run.project_id
    and organization_id=run.organization_id and requested_by=run.requested_by
    and source_database='protein' and requested_accession=run.requested_accession;
  if not found then
    update public.research_pipeline_runs set
      status='error',failure_stage='integrity',failure_code='input_scope_invalid',
      finished_at=now() where id=run.id;
    return;
  end if;

  if source.status in ('error','rejected','not_found') then
    update public.research_pipeline_runs set
      status='error',failure_stage='source',failure_code='source_failed',
      finished_at=now() where id=run.id;
    return;
  end if;
  if source.status in ('queued','retrieving') then return; end if;
  if source.status<>'retrieved' or source.sequence_upload_id is null then
    update public.research_pipeline_runs set
      status='error',failure_stage='integrity',failure_code='input_scope_invalid',
      finished_at=now() where id=run.id;
    return;
  end if;

  select * into seq from public.sequence_uploads
  where id=source.sequence_upload_id and project_id=run.project_id
    and organization_id=run.organization_id and created_by=run.requested_by;
  if not found then
    update public.research_pipeline_runs set status='error',
      failure_stage='integrity',failure_code='input_scope_invalid',
      finished_at=now() where id=run.id;
    return;
  end if;
  if run.sequence_upload_id is not null and run.sequence_upload_id<>seq.id then
    update public.research_pipeline_runs set status='error',
      failure_stage='integrity',failure_code='input_scope_invalid',
      finished_at=now() where id=run.id;
    return;
  end if;
  if run.status='awaiting_source' then
    update public.research_pipeline_runs
    set status='awaiting_validation',sequence_upload_id=seq.id where id=run.id;
  end if;
  if seq.status in ('rejected','error') then
    update public.research_pipeline_runs set status='error',
      failure_stage='validation',failure_code='validation_failed',
      finished_at=now() where id=run.id;
    return;
  end if;
  if seq.status<>'ready' then return; end if;

  if seq.sequence_type<>'protein' or seq.sequence_count<>1 or
     seq.sha256 is null or seq.sha256 !~ '^[0-9a-f]{64}$' or
     seq.residue_count not between 1 and 200000 or
     seq.file_size_bytes not between 1 and 2097152 or
     coalesce(seq.validation_warnings,'[]'::jsonb) ? 'gap_characters_present' then
    update public.research_pipeline_runs set status='error',
      failure_stage='validation',failure_code='validation_failed',
      finished_at=now() where id=run.id;
    return;
  end if;

  -- Existing actor-bound scientific RPC is reused, rather than writing
  -- scientific_jobs or the PGMQ queue directly. The claim is restored after
  -- the call; the actor comes solely from a protected workflow/source row.
  original_sub := current_setting('request.jwt.claim.sub',true);
  original_role := current_setting('request.jwt.claim.role',true);
  begin
    perform pg_catalog.set_config('request.jwt.claim.sub',run.requested_by::text,true);
    perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
    created_job := app_private.request_protein_properties(run.project_id,seq.id);
  exception when others then
    perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
    perform pg_catalog.set_config('request.jwt.claim.role',coalesce(original_role,''),true);
    update public.research_pipeline_runs set status='error',
      failure_stage='dispatch',failure_code='dispatch_rejected',
      finished_at=now() where id=run.id;
    return;
  end;
  perform pg_catalog.set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  perform pg_catalog.set_config('request.jwt.claim.role',coalesce(original_role,''),true);

  -- Fail closed if an existing deduplicated active job belongs to another user.
  if not exists (
    select 1 from public.scientific_jobs s
    where s.id=created_job and s.organization_id=run.organization_id
      and s.project_id=run.project_id and s.requested_by=run.requested_by
      and s.job_type='protein_properties' and s.status in ('queued','running','validating_result')
      and exists (
        select 1 from public.scientific_job_inputs i
        where i.job_id=s.id and i.sequence_upload_id=seq.id
          and i.input_sha256=seq.sha256 and i.project_id=run.project_id
      )
  ) then
    -- Raise to roll back the entire dispatch transaction, including any
    -- new worker job. Never leave an unauthorized job linked.
    raise exception 'scientific job provenance mismatch' using errcode='23514';
  end if;

  update public.research_pipeline_runs
  set status='running',sequence_upload_id=seq.id,
      sequence_sha256=seq.sha256,scientific_job_id=created_job
  where id=run.id and status='awaiting_validation';
end;
$$;
revoke all on function app_private.advance_research_protein_pipeline(uuid)
  from public,anon,authenticated,service_role;

-- Explicit user intent creates one pipeline, linked to one immutable source.
create or replace function app_private.request_research_protein_pipeline(
  p_project_id uuid, p_accession text
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  org uuid;
  acc text := upper(trim(p_accession));
  retrieval uuid;
  source public.sequence_retrievals%rowtype;
  prior uuid;
  run_id uuid;
begin
  if actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if acc is null or char_length(acc) not between 1 and 64 or
     acc !~ '^[A-Z0-9_]+(\.[0-9]+)?$' or acc !~ '[A-Z]' then
    raise exception 'invalid protein accession' using errcode='22023';
  end if;
  select organization_id into org from public.projects
  where id=p_project_id and status='active';
  if not found or not app_private.can_write_org(org) then
    raise exception 'project not found or access denied' using errcode='42501';
  end if;
  retrieval := app_private.request_ncbi_sequence_retrieval(p_project_id,'protein',acc);

  -- The private NCBI requester may deduplicate a concurrent accession request
  -- inside the whole project. A separate user's active retrieval must never be
  -- silently used under this user's pipeline.
  select * into source from public.sequence_retrievals where id=retrieval for share;
  if not found or source.project_id<>p_project_id or
     source.organization_id<>org or source.requested_by<>actor or
     source.source_database<>'protein' or source.requested_accession<>acc then
    raise exception 'active retrieval belongs to another requester or scope'
      using errcode='42501';
  end if;
  select id into prior from public.research_pipeline_runs
  where retrieval_id=retrieval;
  if prior is not null then return prior; end if;
  insert into public.research_pipeline_runs(
    organization_id,project_id,requested_by,template,requested_accession,retrieval_id
  ) values (
    org,p_project_id,actor,'ncbi_protein_profile_v1',acc,retrieval
  ) returning id into run_id;

  perform app_private.advance_research_protein_pipeline(run_id);
  return run_id;
end;
$$;

-- This wrapper runs under invoker permission checks but executes only the
-- narrowly-scoped internal function. Never grant raw table INSERT/UPDATE.
create or replace function public.request_research_protein_pipeline(
  project_id uuid, accession text
) returns uuid language sql security invoker set search_path=''
as $$ select app_private.request_research_protein_pipeline(project_id,accession); $$;

revoke all on function app_private.request_research_protein_pipeline(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function app_private.request_research_protein_pipeline(uuid,text)
  to authenticated;
revoke all on function public.request_research_protein_pipeline(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.request_research_protein_pipeline(uuid,text)
  to authenticated;

-- Source completion and validation completion are independent events. Both
-- call the same lock-serialized idempotent advancement function.
create or replace function app_private.on_protein_pipeline_source_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('retrieved','not_found','rejected','error') then return new; end if;
  for target in
    select id from public.research_pipeline_runs
    where retrieval_id=new.id and status in ('awaiting_source','awaiting_validation')
  loop
    perform app_private.advance_research_protein_pipeline(target);
  end loop;
  return new;
end;
$$;
revoke all on function app_private.on_protein_pipeline_source_change()
  from public,anon,authenticated,service_role;
create trigger research_pipeline_source_completed
after update of status on public.sequence_retrievals for each row
execute function app_private.on_protein_pipeline_source_change();

create or replace function app_private.on_protein_pipeline_validation_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('ready','rejected','error') then return new; end if;
  for target in
    select id from public.research_pipeline_runs
    where sequence_upload_id=new.id and status='awaiting_validation'
  loop
    perform app_private.advance_research_protein_pipeline(target);
  end loop;
  return new;
end;
$$;
revoke all on function app_private.on_protein_pipeline_validation_change()
  from public,anon,authenticated,service_role;
create trigger research_pipeline_fasta_validated
after update of status on public.sequence_uploads for each row
execute function app_private.on_protein_pipeline_validation_change();

create or replace function app_private.on_protein_pipeline_scientific_finished()
returns trigger language plpgsql security definer set search_path='' as $$
declare target public.research_pipeline_runs%rowtype;
begin
  if new.status is not distinct from old.status or
    new.status not in ('completed','error','cancelled') then return new; end if;
  for target in
    select * from public.research_pipeline_runs
    where scientific_job_id=new.id and status='running' for update
  loop
    if new.status='completed' and
       new.organization_id=target.organization_id and
       new.project_id=target.project_id and
       new.requested_by=target.requested_by and
       new.job_type='protein_properties' and
       new.result_sha256 ~ '^[0-9a-f]{64}$' and
       exists(
         select 1 from public.scientific_job_inputs i
         where i.job_id=new.id and i.sequence_upload_id=target.sequence_upload_id
           and i.input_sha256=target.sequence_sha256
       ) then
      update public.research_pipeline_runs set
        status='completed',finished_at=now()
      where id=target.id and status='running';
    else
      update public.research_pipeline_runs set status='error',
        failure_stage=case when new.status='completed' then 'integrity' else 'analysis' end,
        failure_code=case when new.status='completed'
          then 'result_metadata_invalid' else 'analysis_failed' end,
        finished_at=now()
      where id=target.id and status='running';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function app_private.on_protein_pipeline_scientific_finished()
  from public,anon,authenticated,service_role;
create trigger research_pipeline_scientific_finished
after update of status on public.scientific_jobs for each row
execute function app_private.on_protein_pipeline_scientific_finished();
