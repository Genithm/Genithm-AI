-- Science V16: second fixed autonomous research template on the V14 lifecycle.
-- NCBI nucleotide -> strict validated DNA/RNA FASTA -> approved ORF scan (min 30 aa).
-- Apply after V14; production rollout requires separate explicit approval.
-- Existing V14 protein execution remains unchanged in behavior.

alter table public.research_pipeline_runs
  drop constraint research_pipeline_template_ck;
alter table public.research_pipeline_runs
  add constraint research_pipeline_template_ck check (
    template in ('ncbi_protein_profile_v1','ncbi_nucleotide_orf_v1')
  );

-- Upgrade the EXISTING lock-serialized engine, rather than creating a parallel
-- dispatcher or direct queue-writing path. Only two explicitly audited templates
-- are allowed. Actor claims still restore through the original guarded block.
create or replace function app_private.advance_research_protein_pipeline(p_run_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  run public.research_pipeline_runs%rowtype;
  source public.sequence_retrievals%rowtype;
  seq public.sequence_uploads%rowtype;
  created_job uuid;
  downstream public.scientific_jobs%rowtype;
  original_sub text;
  original_role text;
begin
  select * into run from public.research_pipeline_runs where id=p_run_id for update;
  if not found or run.status not in ('awaiting_source','awaiting_validation') then return; end if;

  select * into source from public.sequence_retrievals
  where id=run.retrieval_id and project_id=run.project_id
    and organization_id=run.organization_id and requested_by=run.requested_by
    and source_database=case when run.template='ncbi_protein_profile_v1' then 'protein' when run.template='ncbi_nucleotide_orf_v1' then 'nucleotide' else 'UNSUPPORTED' end
    and requested_accession=run.requested_accession;
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

  if seq.sequence_count<>1 or
     seq.sha256 is null or seq.sha256 !~ '^[0-9a-f]{64}$' or
     coalesce(seq.file_size_bytes,0) not between 1 and 2097152 or
     coalesce(seq.validation_warnings,'[]'::jsonb) ? 'gap_characters_present' or
     not (
       (run.template='ncbi_protein_profile_v1' and seq.sequence_type='protein'
         and coalesce(seq.residue_count,0) between 1 and 200000)
       or
       (run.template='ncbi_nucleotide_orf_v1' and seq.sequence_type in ('dna','rna')
         and coalesce(seq.residue_count,0) between 1 and 50000)
     ) then
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
    if run.template='ncbi_protein_profile_v1' then
      created_job := app_private.request_protein_properties(run.project_id,seq.id);
    elsif run.template='ncbi_nucleotide_orf_v1' then
      created_job := app_private.request_sequence_insights(run.project_id,seq.id,'orf_scan',null,30);
    else
      raise exception 'unapproved pipeline template' using errcode='23514';
    end if;
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

  -- Lock a deduplicated active scientific job before recording the link.
  -- Its worker cannot complete until this transaction commits.
  select * into downstream from public.scientific_jobs
  where id=created_job for share;
  if not found or downstream.organization_id<>run.organization_id
    or downstream.project_id<>run.project_id
    or downstream.requested_by<>run.requested_by
    or not (
      (run.template='ncbi_protein_profile_v1' and downstream.job_type='protein_properties')
      or (run.template='ncbi_nucleotide_orf_v1' and downstream.job_type='sequence_insights'
        and downstream.parameters->>'operation'='orf_scan'
        and downstream.parameters->>'min_aa'='30'
        and coalesce(downstream.parameters->>'motif','')='')
    )
    or not exists (
      select 1 from public.scientific_job_inputs i
      where i.job_id=created_job and i.sequence_upload_id=seq.id
        and i.input_sha256=seq.sha256 and i.project_id=run.project_id
        and i.input_position=1
    ) then
    raise exception 'scientific job provenance mismatch' using errcode='23514';
  end if;

  if downstream.status='completed' and downstream.result_sha256 ~ '^[0-9a-f]{64}$' then
    update public.research_pipeline_runs
    set status='completed',sequence_upload_id=seq.id,
      sequence_sha256=seq.sha256,scientific_job_id=created_job,finished_at=now()
    where id=run.id and status='awaiting_validation';
  elsif downstream.status in ('queued','running','validating_result') then
    update public.research_pipeline_runs
    set status='running',sequence_upload_id=seq.id,
      sequence_sha256=seq.sha256,scientific_job_id=created_job
    where id=run.id and status='awaiting_validation';
  else
    update public.research_pipeline_runs set status='error',
      failure_stage='analysis',failure_code='analysis_failed',
      sequence_upload_id=seq.id,sequence_sha256=seq.sha256,
      scientific_job_id=created_job,finished_at=now()
    where id=run.id and status='awaiting_validation';
  end if;
end;
$$;

-- Legacy V14 grant boundary is retained; no browser access to internal advancement.
revoke all on function app_private.advance_research_protein_pipeline(uuid)
  from public,anon,authenticated,service_role;

-- Fixed, user-authorized nucleotide workflow. Actor and organization are
-- verified by the V14 request function pattern; concurrent launches serialize
-- before the NCBI retrieval deduplication.
create or replace function app_private.request_research_nucleotide_pipeline(
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
    raise exception 'invalid nucleotide accession' using errcode='22023';
  end if;
  select organization_id into org from public.projects
  where id=p_project_id and status='active';
  if not found or not app_private.can_write_org(org) then
    raise exception 'project not found or access denied' using errcode='42501';
  end if;
  -- Serialize duplicate launch requests before the NCBI retrieval deduplication.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'v16:nucleotide:'||p_project_id::text||':'||acc,48521
    )
  );
  retrieval := app_private.request_ncbi_sequence_retrieval(p_project_id,'nucleotide',acc);

  -- The private NCBI requester may deduplicate a concurrent accession request
  -- inside the whole project. A separate user's active retrieval must never be
  -- silently used under this user's pipeline.
  select * into source from public.sequence_retrievals where id=retrieval for share;
  if not found or source.project_id<>p_project_id or
     source.organization_id<>org or source.requested_by<>actor or
     source.source_database<>'nucleotide' or source.requested_accession<>acc then
    raise exception 'active retrieval belongs to another requester or scope'
      using errcode='42501';
  end if;
  select id into prior from public.research_pipeline_runs
  where retrieval_id=retrieval;
  if prior is not null then return prior; end if;
  insert into public.research_pipeline_runs(
    organization_id,project_id,requested_by,template,requested_accession,retrieval_id
  ) values (
    org,p_project_id,actor,'ncbi_nucleotide_orf_v1',acc,retrieval
  ) returning id into run_id;

  perform app_private.advance_research_protein_pipeline(run_id);
  return run_id;
end;
$$;


create or replace function public.request_research_nucleotide_pipeline(
  project_id uuid, accession text
) returns uuid language sql security invoker set search_path=''
as $$ select app_private.request_research_nucleotide_pipeline(project_id,accession); $$;

revoke all on function app_private.request_research_nucleotide_pipeline(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function app_private.request_research_nucleotide_pipeline(uuid,text)
  to authenticated;
revoke all on function public.request_research_nucleotide_pipeline(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.request_research_nucleotide_pipeline(uuid,text)
  to authenticated;

-- The V14 scientific terminal trigger remains attached to scientific_jobs.
-- It now enforces job type AND exact ORF parameters for the new template.
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
       (
         (target.template='ncbi_protein_profile_v1' and new.job_type='protein_properties')
         or (target.template='ncbi_nucleotide_orf_v1' and new.job_type='sequence_insights'
           and new.parameters->>'operation'='orf_scan'
           and new.parameters->>'min_aa'='30'
           and coalesce(new.parameters->>'motif','')='')
       ) and
       new.result_sha256 ~ '^[0-9a-f]{64}$' and
       exists(
         select 1 from public.scientific_job_inputs i
         where i.job_id=new.id and i.sequence_upload_id=target.sequence_upload_id
           and i.input_sha256=target.sequence_sha256 and i.input_position=1
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
