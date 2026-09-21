alter table public.ai_plan_requests
  drop constraint if exists ai_plan_requests_status_check;

alter table public.ai_plan_requests
  add constraint ai_plan_requests_status_check
  check (status in ('queued','planning','ready','clarification_required','unsupported','error','dispatched'));

create or replace function app_private.validate_ai_plan_for_request(
  p_request public.ai_plan_requests,
  p_plan jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  action text;
  params jsonb;
  ids uuid[];
  expected integer;
  actual integer;
  limitation jsonb;
begin
  if p_plan is null
     or jsonb_typeof(p_plan) <> 'object'
     or not app_private.jsonb_has_exact_keys(p_plan,array['schema_version','intent','summary','limitations','action'])
     or p_plan->>'schema_version' is distinct from 'ai-plan-v1' then
    raise exception 'AI plan schema is invalid';
  end if;

  if char_length(coalesce(p_plan->>'summary','')) < 1
     or char_length(p_plan->>'summary') > 2000
     or jsonb_typeof(p_plan->'limitations') <> 'array'
     or jsonb_array_length(p_plan->'limitations') > 10 then
    raise exception 'AI plan summary or limitations are invalid';
  end if;

  for limitation in select value from jsonb_array_elements(p_plan->'limitations') loop
    if jsonb_typeof(limitation) <> 'string'
       or char_length(trim(both '"' from limitation::text)) < 1
       or char_length(limitation#>>'{}') > 500 then
      raise exception 'AI plan limitation is invalid';
    end if;
  end loop;

  if p_plan->>'intent' in ('clarification_required','unsupported') then
    if p_plan->'action' is not null and p_plan->'action' <> 'null'::jsonb then
      raise exception 'non-executable AI plan cannot contain an action';
    end if;
    return null;
  end if;

  if p_plan->>'intent' <> 'scientific_action' then
    raise exception 'AI plan intent is invalid';
  end if;

  if not app_private.jsonb_has_exact_keys(p_plan->'action',array['type','parameters']) then
    raise exception 'AI scientific plan action shape is invalid';
  end if;

  action := p_plan->'action'->>'type';
  params := p_plan->'action'->'parameters';

  if action not in (
    'ncbi_sequence_retrieval',
    'blast',
    'pairwise_alignment',
    'multiple_sequence_alignment',
    'phylogenetic_tree',
    'protein_properties',
    'protein_annotation'
  ) or jsonb_typeof(params) <> 'object' then
    raise exception 'AI plan action is not allowlisted';
  end if;

  if action='ncbi_sequence_retrieval' then
    if not app_private.jsonb_has_exact_keys(params,array['database_name','accession'])
       or params->>'database_name' not in ('nucleotide','protein')
       or coalesce(params->>'accession','') !~ '^(?=.*[A-Z])[A-Z0-9_]+(\.[0-9]+)?$'
       or char_length(params->>'accession') > 64 then
      raise exception 'AI NCBI plan parameters are invalid';
    end if;
  elsif action='blast' then
    if not app_private.jsonb_has_exact_keys(params,array['query_upload_id','program','expect_value','max_targets','low_complexity_filter'])
       or jsonb_typeof(params->'expect_value') <> 'number'
       or jsonb_typeof(params->'max_targets') <> 'number'
       or jsonb_typeof(params->'low_complexity_filter') <> 'boolean'
       or (params->>'expect_value')::numeric < 1e-180
       or (params->>'expect_value')::numeric > 1000
       or (params->>'max_targets')::integer < 1
       or (params->>'max_targets')::integer > 20
       or params->>'program' not in ('blastn','blastp') then
      raise exception 'AI BLAST parameters are invalid';
    end if;
    if not exists(
      select 1 from public.sequence_uploads u
      where u.id=(params->>'query_upload_id')::uuid
        and u.project_id=p_request.project_id
        and u.organization_id=p_request.organization_id
        and u.status='ready'
        and u.sequence_count=1
        and u.sha256 is not null
    ) then
      raise exception 'AI BLAST input is not authorized or ready';
    end if;
  elsif action='pairwise_alignment' then
    if not app_private.jsonb_has_exact_keys(params,array['sequence_a_id','sequence_b_id','algorithm','match_score','mismatch_score','gap_score'])
       or jsonb_typeof(params->'match_score') <> 'number'
       or jsonb_typeof(params->'mismatch_score') <> 'number'
       or jsonb_typeof(params->'gap_score') <> 'number'
       or (params->>'match_score')::integer not between 1 and 10
       or (params->>'mismatch_score')::integer not between -10 and 0
       or (params->>'gap_score')::integer not between -20 and -1
       or params->>'algorithm' not in ('global','local') then
      raise exception 'AI pairwise parameters are invalid';
    end if;
    select array[(params->>'sequence_a_id')::uuid,(params->>'sequence_b_id')::uuid] into ids;
    select count(*) into actual from public.sequence_uploads u
    where u.id=any(ids)
      and u.project_id=p_request.project_id
      and u.organization_id=p_request.organization_id
      and u.status='ready'
      and u.sequence_count=1
      and u.sha256 is not null;
    if actual <> 2 or ids[1]=ids[2] then
      raise exception 'AI pairwise inputs are invalid';
    end if;
  elsif action='multiple_sequence_alignment' then
    if not app_private.jsonb_has_exact_keys(params,array['sequence_upload_ids'])
       or jsonb_typeof(params->'sequence_upload_ids') <> 'array' then
      raise exception 'AI MSA inputs are invalid';
    end if;
    select array_agg(value::uuid) into ids from jsonb_array_elements_text(params->'sequence_upload_ids');
    expected := coalesce(array_length(ids,1),0);
    if expected < 3 or expected > 50 or (select count(distinct x) from unnest(ids) x) <> expected then
      raise exception 'AI MSA input count is invalid';
    end if;
    select count(*) into actual from public.sequence_uploads u
    where u.id=any(ids)
      and u.project_id=p_request.project_id
      and u.organization_id=p_request.organization_id
      and u.status='ready'
      and u.sequence_count=1
      and u.sha256 is not null;
    if actual <> expected then
      raise exception 'AI MSA inputs are not authorized or ready';
    end if;
  elsif action='phylogenetic_tree' then
    if not app_private.jsonb_has_exact_keys(params,array['msa_job_id']) then
      raise exception 'AI phylogeny parameters are invalid';
    end if;
    if not exists(
      select 1 from public.scientific_jobs s
      where s.id=(params->>'msa_job_id')::uuid
        and s.project_id=p_request.project_id
        and s.organization_id=p_request.organization_id
        and s.job_type='multiple_sequence_alignment'
        and s.status='completed'
        and s.result_sha256 is not null
    ) then
      raise exception 'AI phylogeny source MSA is invalid';
    end if;
  elsif action='protein_properties' then
    if not app_private.jsonb_has_exact_keys(params,array['sequence_upload_id']) then
      raise exception 'AI protein properties parameters are invalid';
    end if;
    if not exists(
      select 1 from public.sequence_uploads u
      where u.id=(params->>'sequence_upload_id')::uuid
        and u.project_id=p_request.project_id
        and u.organization_id=p_request.organization_id
        and u.status='ready'
        and u.sequence_count=1
        and u.sequence_type='protein'
        and u.sha256 is not null
    ) then
      raise exception 'AI protein properties input is invalid';
    end if;
  elsif action='protein_annotation' then
    if not app_private.jsonb_has_exact_keys(params,array['sequence_upload_id']) then
      raise exception 'AI protein annotation parameters are invalid';
    end if;
    if not exists(
      select 1
      from public.sequence_uploads u
      join public.sequence_retrievals r on r.sequence_upload_id=u.id
      where u.id=(params->>'sequence_upload_id')::uuid
        and u.project_id=p_request.project_id
        and u.organization_id=p_request.organization_id
        and u.status='ready'
        and u.sequence_count=1
        and u.sequence_type='protein'
        and u.sha256 is not null
        and r.source_database='protein'
        and r.status='retrieved'
    ) then
      raise exception 'AI protein annotation input is invalid';
    end if;
  end if;

  return action;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'AI plan contains an invalid typed parameter';
end;
$$;

revoke all on function app_private.validate_ai_plan_for_request(public.ai_plan_requests,jsonb)
from public, anon, authenticated, service_role;

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
set search_path = ''
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

  if not found or target.status <> 'planning' then
    raise exception 'AI planning request is not active' using errcode='P0002';
  end if;

  if trim(p_provider) !~ '^[a-z0-9_-]{2,64}$'
     or nullif(trim(p_model),'') is null
     or char_length(trim(p_model)) > 128
     or nullif(trim(p_prompt_version),'') is null
     or char_length(trim(p_prompt_version)) > 128
     or p_policy_version is distinct from 'ai-policy-v1' then
    raise exception 'AI planner provenance is invalid';
  end if;

  if char_length(coalesce(p_plan->>'summary','')) < 1
     or char_length(p_plan->>'summary') > 2000
     or jsonb_typeof(coalesce(p_plan->'limitations','[]'::jsonb)) <> 'array' then
    raise exception 'AI plan summary is invalid';
  end if;

  action := app_private.validate_ai_plan_for_request(target,p_plan);

  final_status := case p_plan->>'intent'
    when 'clarification_required' then 'clarification_required'
    when 'unsupported' then 'unsupported'
    else 'ready'
  end;

  canonical := p_plan::text;
  plan_hash := encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex');
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
    'plan_summary',
    target.id
  );

  if not pgmq.delete('ai_planning',p_message_id) then
    raise exception 'AI planning queue message delete failed';
  end if;
end;
$$;

revoke all on function app_private.finish_ai_plan_success(bigint,uuid,text,text,text,text,jsonb)
from public, anon, authenticated;
grant execute on function app_private.finish_ai_plan_success(bigint,uuid,text,text,text,text,jsonb)
to service_role;
