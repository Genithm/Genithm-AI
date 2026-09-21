-- Bounded AI multi-step workflow: MSA -> phylogenetic tree.
-- One user approval authorizes exactly these two pre-defined scientific steps.
-- The second step is dispatched only after the authoritative MSA job completes.

alter table public.ai_plan_requests
  drop constraint if exists ai_plan_requests_action;

alter table public.ai_plan_requests
  add constraint ai_plan_requests_action
  check (
    action_type is null
    or action_type in (
      'ncbi_sequence_retrieval',
      'blast',
      'pairwise_alignment',
      'multiple_sequence_alignment',
      'phylogenetic_tree',
      'protein_properties',
      'protein_annotation',
      'msa_phylogeny_workflow'
    )
  );

create table public.ai_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  plan_request_id uuid not null unique references public.ai_plan_requests(id) on delete cascade,
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  workflow_type text not null,
  status text not null default 'running',
  msa_job_id uuid not null references public.scientific_jobs(id) on delete restrict,
  phylogeny_job_id uuid references public.scientific_jobs(id) on delete restrict,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint ai_workflow_runs_plan_scope_fkey
    foreign key (conversation_id,project_id,organization_id,requested_by)
    references public.ai_conversations(id,project_id,organization_id,created_by)
    on delete cascade,
  constraint ai_workflow_runs_type check (workflow_type='msa_phylogeny'),
  constraint ai_workflow_runs_status check (status in ('running','completed','error','cancelled')),
  constraint ai_workflow_runs_error check (processing_error is null or char_length(processing_error)<=2000),
  constraint ai_workflow_runs_lifecycle check (
    (status='running' and finished_at is null)
    or (status in ('completed','error','cancelled') and finished_at is not null)
  )
);

create index ai_workflow_runs_owner_created_idx
  on public.ai_workflow_runs(requested_by,created_at desc);
create index ai_workflow_runs_project_created_idx
  on public.ai_workflow_runs(project_id,created_at desc);
create index ai_workflow_runs_msa_job_idx
  on public.ai_workflow_runs(msa_job_id)
  where status='running';
create index ai_workflow_runs_phylogeny_job_idx
  on public.ai_workflow_runs(phylogeny_job_id)
  where status='running' and phylogeny_job_id is not null;

create trigger ai_workflow_runs_set_updated_at
before update on public.ai_workflow_runs
for each row execute function app_private.set_updated_at();

alter table public.ai_workflow_runs enable row level security;
alter table public.ai_workflow_runs force row level security;

create policy ai_workflow_runs_select_owner
on public.ai_workflow_runs
for select
to authenticated
using (
  (select auth.uid())=requested_by
  and (select app_private.is_org_member(organization_id))
);

revoke all on table public.ai_workflow_runs from public,anon,authenticated,service_role;
grant select on table public.ai_workflow_runs to authenticated;

create or replace function app_private.validate_ai_plan_for_request_v2(
  p_request public.ai_plan_requests,
  p_plan jsonb
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  action text;
  params jsonb;
  ids uuid[];
  expected integer;
  actual integer;
  limitation jsonb;
begin
  action := p_plan->'action'->>'type';

  if p_plan->>'intent'='scientific_action'
     and action='msa_phylogeny_workflow' then
    if p_plan is null
       or jsonb_typeof(p_plan)<>'object'
       or not app_private.jsonb_has_exact_keys(
         p_plan,
         array['schema_version','intent','summary','limitations','action']
       )
       or p_plan->>'schema_version' is distinct from 'ai-plan-v1'
       or char_length(coalesce(p_plan->>'summary',''))<1
       or char_length(p_plan->>'summary')>2000
       or jsonb_typeof(p_plan->'limitations')<>'array'
       or jsonb_array_length(p_plan->'limitations')>10
       or not app_private.jsonb_has_exact_keys(p_plan->'action',array['type','parameters'])
       or jsonb_typeof(p_plan->'action'->'parameters')<>'object' then
      raise exception 'AI workflow plan schema is invalid';
    end if;

    for limitation in select value from jsonb_array_elements(p_plan->'limitations') loop
      if jsonb_typeof(limitation)<>'string'
         or char_length(limitation#>>'{}')<1
         or char_length(limitation#>>'{}')>500 then
        raise exception 'AI workflow limitation is invalid';
      end if;
    end loop;

    params := p_plan->'action'->'parameters';
    if not app_private.jsonb_has_exact_keys(params,array['sequence_upload_ids'])
       or jsonb_typeof(params->'sequence_upload_ids')<>'array' then
      raise exception 'AI MSA + phylogeny workflow parameters are invalid';
    end if;

    begin
      select array_agg(value::uuid)
      into ids
      from jsonb_array_elements_text(params->'sequence_upload_ids');
    exception when others then
      raise exception 'AI workflow contains an invalid sequence identifier';
    end;

    expected := coalesce(array_length(ids,1),0);
    if expected<3 or expected>50
       or (select count(distinct x) from unnest(ids) x)<>expected then
      raise exception 'AI MSA + phylogeny workflow input count is invalid';
    end if;

    select count(*) into actual
    from public.sequence_uploads u
    where u.id=any(ids)
      and u.project_id=p_request.project_id
      and u.organization_id=p_request.organization_id
      and u.status='ready'
      and u.sequence_count=1
      and u.sha256 is not null;

    if actual<>expected then
      raise exception 'AI MSA + phylogeny workflow inputs are not authorized or ready';
    end if;

    return action;
  end if;

  return app_private.validate_ai_plan_for_request(p_request,p_plan);
end;
$$;

revoke all on function app_private.validate_ai_plan_for_request_v2(public.ai_plan_requests,jsonb)
from public,anon,authenticated,service_role;

create or replace function app_private.request_phylogenetic_tree_for_actor(
  p_project_id uuid,
  p_msa_job_id uuid,
  p_requested_by uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  org_id uuid;
  source_job public.scientific_jobs%rowtype;
  tool app_private.scientific_tools%rowtype;
  source_sequence_type text;
  source_type_count integer;
  source_input_count integer;
  source_sequence_count integer;
  source_aligned_length integer;
  selected_model text;
  normalized_params jsonb;
  fingerprint text;
  existing_id uuid;
  new_id uuid;
  queue_message_id bigint;
  user_active integer;
  org_active integer;
begin
  if p_requested_by is null then
    raise exception 'workflow actor is required' using errcode='42501';
  end if;

  select organization_id into org_id
  from public.projects
  where id=p_project_id and status='active';
  if not found then
    raise exception 'project not found or inactive' using errcode='P0002';
  end if;

  if not exists(
    select 1
    from public.organization_members om
    where om.organization_id=org_id
      and om.user_id=p_requested_by
      and om.role in ('owner','admin','member')
  ) then
    raise exception 'project write access denied' using errcode='42501';
  end if;

  select * into source_job
  from public.scientific_jobs
  where id=p_msa_job_id
    and project_id=p_project_id
    and organization_id=org_id
  for share;

  if not found then
    raise exception 'MSA job not found' using errcode='P0002';
  end if;
  if source_job.job_type<>'multiple_sequence_alignment' or source_job.status<>'completed' then
    raise exception 'phylogeny requires a completed MSA job';
  end if;
  if source_job.result_object_path is null
     or source_job.result_sha256 is null
     or source_job.result_bytes is null
     or source_job.result_sha256 !~ '^[0-9a-f]{64}$'
     or source_job.result_bytes<1
     or source_job.result_bytes>26214400 then
    raise exception 'MSA result artifact provenance is incomplete';
  end if;

  select count(*),count(distinct sequence_type),min(sequence_type)
  into source_input_count,source_type_count,source_sequence_type
  from public.scientific_job_inputs
  where job_id=source_job.id;

  if source_input_count<3
     or source_input_count>50
     or source_type_count<>1
     or source_sequence_type not in ('dna','rna','protein') then
    raise exception 'MSA input provenance is not eligible for phylogeny';
  end if;

  begin
    source_sequence_count := (source_job.result_summary->>'sequence_count')::integer;
    source_aligned_length := (source_job.result_summary->>'aligned_length')::integer;
  exception when others then
    raise exception 'MSA result summary is invalid';
  end;

  if source_sequence_count<>source_input_count
     or source_aligned_length<1
     or source_aligned_length>500000 then
    raise exception 'MSA result dimensions are invalid for phylogeny';
  end if;

  selected_model := case
    when source_sequence_type in ('dna','rna') then 'gtr_cat'
    else 'jtt_cat'
  end;

  select * into tool
  from app_private.scientific_tools
  where tool_id='fasttree'
    and tool_version='2.1.11-2'
    and status='approved';
  if not found then
    raise exception 'approved FastTree tool is unavailable';
  end if;

  normalized_params := jsonb_build_object(
    'model',selected_model,
    'source_msa_job_id',source_job.id,
    'source_result_object_path',source_job.result_object_path,
    'source_result_sha256',source_job.result_sha256,
    'source_result_bytes',source_job.result_bytes,
    'sequence_type',source_sequence_type,
    'sequence_count',source_sequence_count,
    'aligned_length',source_aligned_length
  );

  fingerprint := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\x1f',
          'phylogenetic_tree',
          p_project_id::text,
          source_job.id::text,
          source_job.result_sha256,
          tool.tool_id,
          tool.tool_version,
          normalized_params::text
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(fingerprint,13271)
  );

  select id into existing_id
  from public.scientific_jobs
  where organization_id=org_id
    and request_fingerprint=fingerprint
    and status in ('queued','running','validating_result')
  order by created_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  perform app_private.consume_scientific_rate_limit(
    'phylogenetic_tree',
    p_requested_by,
    org_id
  );

  select count(*) into user_active
  from public.scientific_jobs
  where requested_by=p_requested_by
    and status in ('queued','running','validating_result');

  select count(*) into org_active
  from public.scientific_jobs
  where organization_id=org_id
    and status in ('queued','running','validating_result');

  if user_active>=5 or org_active>=25 then
    raise exception 'scientific workflow concurrency limit reached';
  end if;

  insert into public.scientific_jobs(
    organization_id,
    project_id,
    requested_by,
    job_type,
    tool_id,
    tool_version,
    parameters,
    request_fingerprint
  )
  values(
    org_id,
    p_project_id,
    p_requested_by,
    'phylogenetic_tree',
    tool.tool_id,
    tool.tool_version,
    normalized_params,
    fingerprint
  )
  returning id into new_id;

  insert into public.scientific_job_dependencies(
    job_id,
    dependency_job_id,
    organization_id,
    project_id,
    dependency_role,
    dependency_result_sha256,
    dependency_result_object_path
  )
  values(
    new_id,
    source_job.id,
    org_id,
    p_project_id,
    'source_msa',
    source_job.result_sha256,
    source_job.result_object_path
  );

  select pgmq.send(
    queue_name=>'scientific_standard',
    msg=>jsonb_build_object(
      'job_id',new_id,
      'job_type','phylogenetic_tree'
    )
  )
  into queue_message_id;

  if queue_message_id is null then
    raise exception 'failed to enqueue phylogenetic job';
  end if;

  return new_id;
end;
$$;

revoke all on function app_private.request_phylogenetic_tree_for_actor(uuid,uuid,uuid)
from public,anon,authenticated,service_role;

create or replace function app_private.request_phylogenetic_tree(
  p_project_id uuid,
  p_msa_job_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  select organization_id into org_id
  from public.projects
  where id=p_project_id;
  if not found then
    raise exception 'project not found' using errcode='P0002';
  end if;

  if not app_private.can_write_org(org_id) then
    raise exception 'project write access denied' using errcode='42501';
  end if;

  return app_private.request_phylogenetic_tree_for_actor(
    p_project_id,
    p_msa_job_id,
    caller_id
  );
end;
$$;

revoke all on function app_private.request_phylogenetic_tree(uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function app_private.request_phylogenetic_tree(uuid,uuid)
to authenticated;

create or replace function app_private.advance_msa_phylogeny_workflow()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  workflow public.ai_workflow_runs%rowtype;
  next_job_id uuid;
begin
  if new.status is not distinct from old.status
     or new.status not in ('completed','error','cancelled') then
    return new;
  end if;

  for workflow in
    select *
    from public.ai_workflow_runs w
    where w.status='running'
      and (w.msa_job_id=new.id or w.phylogeny_job_id=new.id)
    for update
  loop
    if workflow.msa_job_id=new.id then
      if new.status='completed' then
        if workflow.phylogeny_job_id is null then
          begin
            next_job_id := app_private.request_phylogenetic_tree_for_actor(
              workflow.project_id,
              new.id,
              workflow.requested_by
            );

            update public.ai_workflow_runs
            set phylogeny_job_id=next_job_id
            where id=workflow.id
              and status='running'
              and phylogeny_job_id is null;
          exception when others then
            update public.ai_workflow_runs
            set status='error',
                processing_error='The MSA completed, but the phylogenetic step could not be dispatched safely.',
                finished_at=now()
            where id=workflow.id and status='running';
          end;
        end if;
      else
        update public.ai_workflow_runs
        set status='error',
            processing_error='The MSA prerequisite did not complete successfully, so phylogeny was not started.',
            finished_at=now()
        where id=workflow.id and status='running';
      end if;
    elsif workflow.phylogeny_job_id=new.id then
      if new.status='completed' then
        update public.ai_workflow_runs
        set status='completed',
            processing_error=null,
            finished_at=now()
        where id=workflow.id and status='running';
      else
        update public.ai_workflow_runs
        set status='error',
            processing_error='The phylogenetic step did not complete successfully.',
            finished_at=now()
        where id=workflow.id and status='running';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function app_private.advance_msa_phylogeny_workflow()
from public,anon,authenticated,service_role;

create trigger scientific_jobs_advance_ai_msa_phylogeny
after update of status on public.scientific_jobs
for each row execute function app_private.advance_msa_phylogeny_workflow();

create or replace function app_private.audit_ai_workflow_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  event_name text;
  event_outcome text;
  details jsonb;
begin
  if tg_op='INSERT' then
    event_name := 'AI_WORKFLOW_CREATED';
    event_outcome := 'created';
  elsif new.status is distinct from old.status
        or new.phylogeny_job_id is distinct from old.phylogeny_job_id then
    event_name := 'AI_WORKFLOW_STATUS_CHANGED';
    event_outcome := case
      when new.status='completed' then 'completed'
      when new.status in ('error','cancelled') then 'failed'
      else 'state_change'
    end;
  else
    return new;
  end if;

  details := jsonb_strip_nulls(
    jsonb_build_object(
      'workflow_type',new.workflow_type,
      'status',new.status,
      'previous_status',case when tg_op='UPDATE' then old.status else null end,
      'plan_request_id',new.plan_request_id,
      'msa_job_id',new.msa_job_id,
      'phylogeny_job_id',new.phylogeny_job_id
    )
  );

  perform app_private.append_audit_event(
    new.organization_id,
    new.project_id,
    new.requested_by,
    case when auth.uid() is null then 'service' else 'user' end,
    event_name,
    'ai_workflow',
    new.id::text,
    event_outcome,
    details
  );

  return new;
end;
$$;

revoke all on function app_private.audit_ai_workflow_change()
from public,anon,authenticated,service_role;

create trigger ai_workflow_runs_audit_events
after insert or update on public.ai_workflow_runs
for each row execute function app_private.audit_ai_workflow_change();

create or replace function app_private.finish_ai_plan_inline(
  p_plan_request_id uuid,
  p_expected_user_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_policy_version text,
  p_plan jsonb
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.ai_plan_requests%rowtype;
  action text;
  canonical text;
  plan_hash text;
  summary text;
  final_status text;
begin
  select * into target
  from public.ai_plan_requests
  where id=p_plan_request_id
  for update;

  if not found
     or target.requested_by<>p_expected_user_id
     or target.status<>'planning' then
    raise exception 'AI planning request is not active' using errcode='P0002';
  end if;

  if trim(p_provider) !~ '^[a-z0-9_-]{2,64}$'
     or nullif(trim(p_model),'') is null
     or char_length(trim(p_model))>128
     or nullif(trim(p_prompt_version),'') is null
     or char_length(trim(p_prompt_version))>128
     or p_policy_version is distinct from 'ai-policy-v1' then
    raise exception 'AI planner provenance is invalid';
  end if;

  if char_length(coalesce(p_plan->>'summary',''))<1
     or char_length(p_plan->>'summary')>2000
     or jsonb_typeof(coalesce(p_plan->'limitations','[]'::jsonb))<>'array' then
    raise exception 'AI plan summary is invalid';
  end if;

  action := app_private.validate_ai_plan_for_request_v2(target,p_plan);

  final_status := case p_plan->>'intent'
    when 'conversation' then 'conversation'
    when 'clarification_required' then 'clarification_required'
    when 'unsupported' then 'unsupported'
    else 'ready'
  end;

  canonical := p_plan::text;
  plan_hash := encode(
    extensions.digest(convert_to(canonical,'UTF8'),'sha256'),
    'hex'
  );
  summary := left(p_plan->>'summary',2000);

  update public.ai_plan_requests
  set status=final_status,
      provider=trim(p_provider),
      model=trim(p_model),
      prompt_version=trim(p_prompt_version),
      policy_version=p_policy_version,
      plan_schema_version='ai-plan-v1',
      plan=p_plan,
      plan_sha256=plan_hash,
      action_type=action,
      requires_confirmation=(final_status='ready'),
      processing_finished_at=now(),
      processing_error=null,
      updated_at=now()
  where id=target.id;

  insert into public.ai_messages(
    conversation_id,
    organization_id,
    project_id,
    conversation_owner_id,
    role,
    content,
    message_kind,
    plan_request_id
  )
  values(
    target.conversation_id,
    target.organization_id,
    target.project_id,
    target.requested_by,
    'assistant',
    summary,
    case when final_status='conversation' then 'text' else 'plan_summary' end,
    target.id
  );

  return final_status;
end;
$$;

revoke all on function app_private.finish_ai_plan_inline(uuid,uuid,text,text,text,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function app_private.finish_ai_plan_inline(uuid,uuid,text,text,text,text,jsonb)
to service_role;

create or replace function app_private.finish_ai_plan_success(
  p_message_id bigint,
  p_plan_request_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_policy_version text,
  p_plan jsonb
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.ai_plan_requests%rowtype;
  action text;
  canonical text;
  plan_hash text;
  summary text;
  final_status text;
begin
  select * into target
  from public.ai_plan_requests
  where id=p_plan_request_id
  for update;

  if not found or target.status<>'planning' then
    raise exception 'AI planning request is not active' using errcode='P0002';
  end if;

  if trim(p_provider) !~ '^[a-z0-9_-]{2,64}$'
     or nullif(trim(p_model),'') is null
     or char_length(trim(p_model))>128
     or nullif(trim(p_prompt_version),'') is null
     or char_length(trim(p_prompt_version))>128
     or p_policy_version is distinct from 'ai-policy-v1' then
    raise exception 'AI planner provenance is invalid';
  end if;

  if char_length(coalesce(p_plan->>'summary',''))<1
     or char_length(p_plan->>'summary')>2000
     or jsonb_typeof(coalesce(p_plan->'limitations','[]'::jsonb))<>'array' then
    raise exception 'AI plan summary is invalid';
  end if;

  action := app_private.validate_ai_plan_for_request_v2(target,p_plan);

  final_status := case p_plan->>'intent'
    when 'conversation' then 'conversation'
    when 'clarification_required' then 'clarification_required'
    when 'unsupported' then 'unsupported'
    else 'ready'
  end;

  canonical := p_plan::text;
  plan_hash := encode(
    extensions.digest(convert_to(canonical,'UTF8'),'sha256'),
    'hex'
  );
  summary := left(p_plan->>'summary',2000);

  update public.ai_plan_requests
  set status=final_status,
      provider=trim(p_provider),
      model=trim(p_model),
      prompt_version=trim(p_prompt_version),
      policy_version=p_policy_version,
      plan_schema_version='ai-plan-v1',
      plan=p_plan,
      plan_sha256=plan_hash,
      action_type=action,
      requires_confirmation=(final_status='ready'),
      processing_finished_at=now(),
      processing_error=null,
      updated_at=now()
  where id=target.id;

  insert into public.ai_messages(
    conversation_id,
    organization_id,
    project_id,
    conversation_owner_id,
    role,
    content,
    message_kind,
    plan_request_id
  )
  values(
    target.conversation_id,
    target.organization_id,
    target.project_id,
    target.requested_by,
    'assistant',
    summary,
    case when final_status='conversation' then 'text' else 'plan_summary' end,
    target.id
  );

  if not pgmq.delete('ai_planning',p_message_id) then
    raise exception 'AI planning queue message delete failed';
  end if;
end;
$$;

revoke all on function app_private.finish_ai_plan_success(bigint,uuid,text,text,text,text,jsonb)
from public,anon,authenticated;
grant execute on function app_private.finish_ai_plan_success(bigint,uuid,text,text,text,text,jsonb)
to service_role;

create or replace function app_private.approve_ai_plan(p_plan_request_id uuid)
returns table(resource_type text,resource_id uuid)
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_id uuid:=auth.uid();
  target public.ai_plan_requests%rowtype;
  params jsonb;
  action text;
  result_id uuid;
  r_type text;
  msa_job uuid;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  select * into target
  from public.ai_plan_requests
  where id=p_plan_request_id
  for update;

  if not found
     or target.requested_by<>caller_id
     or target.status<>'ready'
     or target.plan is null then
    raise exception 'AI plan is not ready for approval' using errcode='P0002';
  end if;

  if not app_private.can_write_org(target.organization_id) then
    raise exception 'project write access denied' using errcode='42501';
  end if;

  action := app_private.validate_ai_plan_for_request_v2(target,target.plan);
  params := target.plan->'action'->'parameters';

  if action='ncbi_sequence_retrieval' then
    result_id := app_private.request_ncbi_sequence_retrieval(
      target.project_id,
      params->>'database_name',
      upper(params->>'accession')
    );
    r_type := 'sequence_retrieval';
  elsif action='blast' then
    result_id := app_private.request_blast_job(
      target.project_id,
      (params->>'query_upload_id')::uuid,
      params->>'program',
      case when params->>'program'='blastp' then 'swissprot' else 'core_nt' end,
      coalesce((params->>'expect_value')::numeric,10),
      coalesce((params->>'max_targets')::integer,20),
      coalesce((params->>'low_complexity_filter')::boolean,true)
    );
    r_type := 'blast_job';
  elsif action='pairwise_alignment' then
    result_id := app_private.request_pairwise_alignment(
      target.project_id,
      (params->>'sequence_a_id')::uuid,
      (params->>'sequence_b_id')::uuid,
      coalesce(params->>'algorithm','global'),
      coalesce((params->>'match_score')::integer,2),
      coalesce((params->>'mismatch_score')::integer,-1),
      coalesce((params->>'gap_score')::integer,-2)
    );
    r_type := 'scientific_job';
  elsif action='multiple_sequence_alignment' then
    result_id := app_private.request_multiple_sequence_alignment(
      target.project_id,
      array(
        select value::uuid
        from jsonb_array_elements_text(params->'sequence_upload_ids')
      )
    );
    r_type := 'scientific_job';
  elsif action='phylogenetic_tree' then
    result_id := app_private.request_phylogenetic_tree(
      target.project_id,
      (params->>'msa_job_id')::uuid
    );
    r_type := 'scientific_job';
  elsif action='protein_properties' then
    result_id := app_private.request_protein_properties(
      target.project_id,
      (params->>'sequence_upload_id')::uuid
    );
    r_type := 'scientific_job';
  elsif action='protein_annotation' then
    result_id := app_private.request_protein_annotation(
      target.project_id,
      (params->>'sequence_upload_id')::uuid
    );
    r_type := 'protein_annotation_job';
  elsif action='msa_phylogeny_workflow' then
    msa_job := app_private.request_multiple_sequence_alignment(
      target.project_id,
      array(
        select value::uuid
        from jsonb_array_elements_text(params->'sequence_upload_ids')
      )
    );

    insert into public.ai_workflow_runs(
      plan_request_id,
      conversation_id,
      organization_id,
      project_id,
      requested_by,
      workflow_type,
      status,
      msa_job_id
    )
    values(
      target.id,
      target.conversation_id,
      target.organization_id,
      target.project_id,
      target.requested_by,
      'msa_phylogeny',
      'running',
      msa_job
    )
    returning id into result_id;

    r_type := 'ai_workflow';
  else
    raise exception 'AI plan action is not dispatchable';
  end if;

  update public.ai_plan_requests
  set status='dispatched',
      dispatched_resource_type=r_type,
      dispatched_resource_id=result_id,
      updated_at=now()
  where id=target.id;

  insert into public.ai_messages(
    conversation_id,
    organization_id,
    project_id,
    conversation_owner_id,
    role,
    content,
    message_kind,
    plan_request_id
  )
  values(
    target.conversation_id,
    target.organization_id,
    target.project_id,
    target.requested_by,
    'assistant',
    case
      when action='msa_phylogeny_workflow'
        then 'Approved workflow started. Genithm will run MSA first and automatically start phylogeny only after the MSA completes successfully.'
      else 'Approved plan dispatched to the authoritative Genithm execution layer.'
    end,
    'execution_status',
    target.id
  );

  return query select r_type,result_id;
end;
$$;

revoke all on function app_private.approve_ai_plan(uuid)
from public,anon,authenticated,service_role;
grant execute on function app_private.approve_ai_plan(uuid)
to authenticated;
