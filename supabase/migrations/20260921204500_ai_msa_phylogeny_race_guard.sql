-- Close the approval/completion race for bounded MSA -> phylogeny workflows.
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

    -- Hold a row lock until the workflow checkpoint is committed. A worker
    -- finishing a deduplicated active MSA must wait, so its status trigger can
    -- observe the committed workflow row and cannot miss the downstream step.
    perform 1
    from public.scientific_jobs
    where id=msa_job
      and project_id=target.project_id
      and organization_id=target.organization_id
    for share;

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
