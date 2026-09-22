-- Automatically dispatch validated scientific tasks once all prerequisites are present.
CREATE OR REPLACE FUNCTION app_private.dispatch_ai_plan_service(p_plan_request_id uuid, p_expected_user_id uuid)
 RETURNS TABLE(resource_type text, resource_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target public.ai_plan_requests%rowtype;
  params jsonb;
  action text;
  result_id uuid;
  r_type text;
  msa_job uuid;
begin
  if p_expected_user_id is null then
    raise exception 'expected user id is required' using errcode='22023';
  end if;

  select * into target
  from public.ai_plan_requests
  where id=p_plan_request_id
  for update;

  if not found
     or target.requested_by<>p_expected_user_id
     or target.status<>'ready'
     or target.plan is null then
    raise exception 'AI plan is not ready for dispatch' using errcode='P0002';
  end if;

  action := app_private.validate_ai_plan_for_request_v2(target,target.plan);
  params := target.plan->'action'->'parameters';

  if action='ncbi_sequence_retrieval' then
    result_id := app_private.request_ncbi_sequence_retrieval(target.project_id,params->>'database_name',upper(params->>'accession'));
    r_type := 'sequence_retrieval';
  elsif action='blast' then
    result_id := app_private.request_blast_job(
      target.project_id,(params->>'query_upload_id')::uuid,params->>'program',
      case when params->>'program'='blastp' then 'swissprot' else 'core_nt' end,
      coalesce((params->>'expect_value')::numeric,10),
      coalesce((params->>'max_targets')::integer,20),
      coalesce((params->>'low_complexity_filter')::boolean,true)
    );
    r_type := 'blast_job';
  elsif action='pairwise_alignment' then
    result_id := app_private.request_pairwise_alignment(
      target.project_id,(params->>'sequence_a_id')::uuid,(params->>'sequence_b_id')::uuid,
      coalesce(params->>'algorithm','global'),
      coalesce((params->>'match_score')::integer,2),
      coalesce((params->>'mismatch_score')::integer,-1),
      coalesce((params->>'gap_score')::integer,-2)
    );
    r_type := 'scientific_job';
  elsif action='multiple_sequence_alignment' then
    result_id := app_private.request_multiple_sequence_alignment(
      target.project_id,
      array(select value::uuid from jsonb_array_elements_text(params->'sequence_upload_ids'))
    );
    r_type := 'scientific_job';
  elsif action='phylogenetic_tree' then
    result_id := app_private.request_phylogenetic_tree(target.project_id,(params->>'msa_job_id')::uuid);
    r_type := 'scientific_job';
  elsif action='protein_properties' then
    result_id := app_private.request_protein_properties(target.project_id,(params->>'sequence_upload_id')::uuid);
    r_type := 'scientific_job';
  elsif action='protein_annotation' then
    result_id := app_private.request_protein_annotation(target.project_id,(params->>'sequence_upload_id')::uuid);
    r_type := 'protein_annotation_job';
  elsif action='msa_phylogeny_workflow' then
    msa_job := app_private.request_multiple_sequence_alignment(
      target.project_id,
      array(select value::uuid from jsonb_array_elements_text(params->'sequence_upload_ids'))
    );
    insert into public.ai_workflow_runs(
      plan_request_id,conversation_id,organization_id,project_id,requested_by,
      workflow_type,status,msa_job_id
    )
    values(
      target.id,target.conversation_id,target.organization_id,target.project_id,target.requested_by,
      'msa_phylogeny','running',msa_job
    )
    returning id into result_id;
    r_type := 'ai_workflow';
  else
    raise exception 'AI plan action is not dispatchable';
  end if;

  update public.ai_plan_requests
  set status='dispatched',
      requires_confirmation=false,
      dispatched_resource_type=r_type,
      dispatched_resource_id=result_id,
      updated_at=now()
  where id=target.id;

  insert into public.ai_messages(
    conversation_id,organization_id,project_id,conversation_owner_id,
    role,content,message_kind,plan_request_id
  )
  values(
    target.conversation_id,target.organization_id,target.project_id,target.requested_by,
    'assistant',
    case
      when action='msa_phylogeny_workflow'
        then 'I have everything needed. I started the MSA and will automatically start the phylogenetic tree after the MSA completes successfully.'
      else 'I have everything needed, so I started the requested scientific task.'
    end,
    'execution_status',
    target.id
  );

  return query select r_type,result_id;
end;
$function$;

revoke all on function app_private.dispatch_ai_plan_service(uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function app_private.dispatch_ai_plan_service(uuid,uuid)
to service_role;

create or replace function public.dispatch_ai_plan_service(
  plan_request_id uuid,
  expected_user_id uuid
)
returns table(resource_type text,resource_id uuid)
language sql
security invoker
set search_path=''
as $$
  select * from app_private.dispatch_ai_plan_service(plan_request_id,expected_user_id);
$$;

revoke all on function public.dispatch_ai_plan_service(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.dispatch_ai_plan_service(uuid,uuid)
to service_role;

CREATE OR REPLACE FUNCTION app_private.create_ai_plan_from_chat(p_user_message_id uuid, p_expected_user_id uuid, p_provider text, p_model text, p_prompt_version text, p_policy_version text, p_plan jsonb)
 RETURNS TABLE(plan_request_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source public.ai_messages%rowtype;
  request_id uuid;
  action text;
  canonical text;
  plan_hash text;
  summary text;
begin
  select * into source
  from public.ai_messages
  where id=p_user_message_id and role='user'
  for update;

  if not found or source.conversation_owner_id<>p_expected_user_id then
    raise exception 'AI chat turn not found' using errcode='P0002';
  end if;
  if source.plan_request_id is not null then
    raise exception 'AI chat turn already has a scientific plan';
  end if;

  if trim(p_provider)!~'^[a-z0-9_-]{2,64}$'
     or nullif(trim(p_model),'') is null
     or char_length(trim(p_model))>128
     or nullif(trim(p_prompt_version),'') is null
     or char_length(trim(p_prompt_version))>128
     or p_policy_version is distinct from 'ai-policy-v1' then
    raise exception 'AI planner provenance is invalid';
  end if;

  if p_plan->>'intent' is distinct from 'scientific_action'
     or char_length(coalesce(p_plan->>'summary',''))<1
     or char_length(p_plan->>'summary')>2000
     or jsonb_typeof(coalesce(p_plan->'limitations','[]'::jsonb))<>'array' then
    raise exception 'AI scientific plan is invalid';
  end if;

  insert into public.ai_plan_requests(
    conversation_id,user_message_id,organization_id,project_id,requested_by,
    status,processing_attempts,processing_started_at,attachment_upload_ids,
    requires_confirmation
  )
  values(
    source.conversation_id,source.id,source.organization_id,source.project_id,source.conversation_owner_id,
    'planning',1,now(),source.attachment_upload_ids,false
  )
  returning id into request_id;

  select app_private.validate_ai_plan_for_request_v2(r,p_plan)
    into action
  from public.ai_plan_requests r
  where r.id=request_id;

  canonical := p_plan::text;
  plan_hash := encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex');
  summary := left(p_plan->>'summary',2000);

  update public.ai_plan_requests
  set status='ready',
      provider=trim(p_provider),
      model=trim(p_model),
      prompt_version=trim(p_prompt_version),
      policy_version=p_policy_version,
      plan_schema_version='ai-plan-v1',
      plan=p_plan,
      plan_sha256=plan_hash,
      action_type=action,
      requires_confirmation=false,
      processing_finished_at=now(),
      processing_error=null,
      updated_at=now()
  where id=request_id;

  update public.ai_messages set plan_request_id=request_id where id=source.id;

  insert into public.ai_messages(
    conversation_id,organization_id,project_id,conversation_owner_id,
    role,content,message_kind,plan_request_id
  )
  values(
    source.conversation_id,source.organization_id,source.project_id,source.conversation_owner_id,
    'assistant',summary,'plan_summary',request_id
  );

  return query select request_id,'ready'::text;
end;
$function$

