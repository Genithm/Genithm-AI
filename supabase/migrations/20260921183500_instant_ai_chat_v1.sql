alter table public.ai_plan_requests
  add column if not exists attachment_upload_ids uuid[] not null default '{}'::uuid[];

alter table public.ai_plan_requests
  drop constraint if exists ai_plan_requests_status_check;

alter table public.ai_plan_requests
  add constraint ai_plan_requests_status_check
  check (status in ('queued','planning','conversation','ready','clarification_required','unsupported','error','dispatched'));

alter table public.ai_plan_requests
  drop constraint if exists ai_plan_requests_attachment_count;

alter table public.ai_plan_requests
  add constraint ai_plan_requests_attachment_count
  check (cardinality(attachment_upload_ids) between 0 and 10);

create or replace function app_private.request_ai_plan_inline(
  p_project_id uuid,
  p_conversation_id uuid,
  p_user_message text,
  p_attachment_upload_ids uuid[] default '{}'::uuid[]
)
returns table(
  conversation_id uuid,
  plan_request_id uuid,
  user_message text,
  authorized_context jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  convo public.ai_conversations%rowtype;
  message_id uuid;
  request_id uuid;
  normalized_message text := trim(coalesce(p_user_message,''));
  attachment_ids uuid[] := coalesce(p_attachment_upload_ids,'{}'::uuid[]);
  attachment_count integer;
  unique_attachment_count integer;
  context jsonb;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  if char_length(normalized_message) > 8000 then
    raise exception 'AI request must be at most 8000 characters';
  end if;

  if cardinality(attachment_ids) > 10 then
    raise exception 'AI chat supports at most 10 attachments per message';
  end if;

  select count(*) into unique_attachment_count
  from (select distinct unnest(attachment_ids) as id) x;

  if unique_attachment_count <> cardinality(attachment_ids) then
    raise exception 'duplicate AI chat attachments are not allowed';
  end if;

  if normalized_message = '' and cardinality(attachment_ids) = 0 then
    raise exception 'AI request requires a message or attachment';
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

  perform app_private.consume_scientific_rate_limit('ai_planning',caller_id,org_id);

  if cardinality(attachment_ids) > 0 then
    select count(*) into attachment_count
    from public.sequence_uploads u
    where u.id = any(attachment_ids)
      and u.project_id = p_project_id
      and u.organization_id = org_id
      and u.created_by = caller_id
      and u.status in ('pending_validation','ready','rejected','error');

    if attachment_count <> cardinality(attachment_ids) then
      raise exception 'one or more AI chat attachments are invalid or inaccessible' using errcode='42501';
    end if;
  end if;

  if p_conversation_id is null then
    insert into public.ai_conversations(organization_id,project_id,created_by,title)
    values(
      org_id,
      p_project_id,
      caller_id,
      left(
        case
          when normalized_message <> '' then normalized_message
          else 'Attached biological data'
        end,
        160
      )
    )
    returning * into convo;
  else
    select * into convo
    from public.ai_conversations
    where id=p_conversation_id
      and project_id=p_project_id
      and organization_id=org_id
      and created_by=caller_id
      and status='active';

    if not found then
      raise exception 'AI conversation not found' using errcode='P0002';
    end if;
  end if;

  insert into public.ai_messages(
    conversation_id,
    organization_id,
    project_id,
    conversation_owner_id,
    role,
    content
  )
  values(
    convo.id,
    org_id,
    p_project_id,
    caller_id,
    case when normalized_message='' then 'user' else 'user' end,
    case when normalized_message='' then 'Attached biological data for analysis.' else normalized_message end
  )
  returning id into message_id;

  insert into public.ai_plan_requests(
    conversation_id,
    user_message_id,
    organization_id,
    project_id,
    requested_by,
    status,
    processing_attempts,
    processing_started_at,
    attachment_upload_ids
  )
  values(
    convo.id,
    message_id,
    org_id,
    p_project_id,
    caller_id,
    'planning',
    1,
    now(),
    attachment_ids
  )
  returning id into request_id;

  update public.ai_messages
  set plan_request_id=request_id
  where id=message_id;

  select jsonb_build_object(
    'project',jsonb_build_object('id',p_project_id),
    'conversation_history',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'role',h.role,
          'kind',h.message_kind,
          'content',left(h.content,4000)
        )
        order by h.created_at asc
      )
      from (
        select role,message_kind,content,created_at
        from public.ai_messages
        where conversation_id=convo.id
          and id<>message_id
        order by created_at desc
        limit 12
      ) h
    ),'[]'::jsonb),
    'current_attachments',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',u.id,
          'filename',left(u.original_filename,255),
          'status',u.status,
          'sequence_type',u.sequence_type,
          'sequence_count',u.sequence_count,
          'residue_count',u.residue_count,
          'sha256',u.sha256
        )
        order by u.created_at asc
      )
      from public.sequence_uploads u
      where u.id=any(attachment_ids)
    ),'[]'::jsonb),
    'sequences',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',u.id,
          'filename',left(u.original_filename,255),
          'sequence_type',u.sequence_type,
          'residue_count',u.residue_count,
          'sha256',u.sha256
        )
        order by u.created_at desc
      )
      from (
        select id,original_filename,sequence_type,residue_count,sha256,created_at
        from public.sequence_uploads
        where project_id=p_project_id
          and organization_id=org_id
          and status='ready'
          and sequence_count=1
          and sha256 is not null
        order by created_at desc
        limit 100
      ) u
    ),'[]'::jsonb),
    'scientific_jobs',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',s.id,
          'job_type',s.job_type,
          'status',s.status,
          'tool_id',s.tool_id,
          'tool_version',s.tool_version,
          'result_sha256',s.result_sha256,
          'result_summary',s.result_summary
        )
        order by s.created_at desc
      )
      from (
        select id,job_type,status,tool_id,tool_version,result_sha256,result_summary,created_at
        from public.scientific_jobs
        where project_id=p_project_id and organization_id=org_id
        order by created_at desc
        limit 30
      ) s
    ),'[]'::jsonb),
    'ncbi_retrievals',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',r.id,
          'source_database',r.source_database,
          'resolved_accession',r.resolved_accession,
          'status',r.status,
          'sequence_upload_id',r.sequence_upload_id
        )
        order by r.created_at desc
      )
      from (
        select id,source_database,resolved_accession,status,sequence_upload_id,created_at
        from public.sequence_retrievals
        where project_id=p_project_id and organization_id=org_id
        order by created_at desc
        limit 30
      ) r
    ),'[]'::jsonb),
    'protein_annotations',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',a.id,
          'sequence_upload_id',a.sequence_upload_id,
          'status',a.status,
          'refseq_accession',a.refseq_accession,
          'uniprot_accession',a.uniprot_accession
        )
        order by a.created_at desc
      )
      from (
        select id,sequence_upload_id,status,refseq_accession,uniprot_accession,created_at
        from public.protein_annotation_jobs
        where project_id=p_project_id and organization_id=org_id
        order by created_at desc
        limit 20
      ) a
    ),'[]'::jsonb)
  ) into context;

  return query
  select convo.id,request_id,
    case when normalized_message='' then 'Attached biological data for analysis.' else normalized_message end,
    context;
end;
$$;

revoke all on function app_private.request_ai_plan_inline(uuid,uuid,text,uuid[])
from public,anon,authenticated,service_role;
grant execute on function app_private.request_ai_plan_inline(uuid,uuid,text,uuid[])
to authenticated;

create or replace function public.request_ai_plan_inline(
  project_id uuid,
  conversation_id uuid,
  user_message text,
  attachment_upload_ids uuid[] default '{}'::uuid[]
)
returns table(
  conversation_id uuid,
  plan_request_id uuid,
  user_message text,
  authorized_context jsonb
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from app_private.request_ai_plan_inline(
    project_id,
    conversation_id,
    user_message,
    attachment_upload_ids
  );
$$;

revoke all on function public.request_ai_plan_inline(uuid,uuid,text,uuid[])
from public,anon,service_role;
grant execute on function public.request_ai_plan_inline(uuid,uuid,text,uuid[])
to authenticated;

create or replace function app_private.finish_ai_plan_inline(
  p_plan_request_id uuid,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_policy_version text,
  p_plan jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.ai_plan_requests%rowtype;
  action text;
  canonical text;
  plan_hash text;
  summary text;
  final_status text;
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

  action := app_private.validate_ai_plan_for_request(target,p_plan);

  final_status := case p_plan->>'intent'
    when 'conversation' then 'conversation'
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
    case
      when final_status='conversation' then 'text'
      else 'plan_summary'
    end,
    target.id
  );

  return final_status;
end;
$$;

revoke all on function app_private.finish_ai_plan_inline(uuid,text,text,text,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function app_private.finish_ai_plan_inline(uuid,text,text,text,text,jsonb)
to authenticated;

create or replace function public.finish_ai_plan_inline(
  plan_request_id uuid,
  provider text,
  model text,
  prompt_version text,
  policy_version text,
  plan jsonb
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_ai_plan_inline(
    plan_request_id,
    provider,
    model,
    prompt_version,
    policy_version,
    plan
  );
$$;

revoke all on function public.finish_ai_plan_inline(uuid,text,text,text,text,jsonb)
from public,anon,service_role;
grant execute on function public.finish_ai_plan_inline(uuid,text,text,text,text,jsonb)
to authenticated;

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

  if p_plan->>'intent' in ('conversation','clarification_required','unsupported') then
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
    when 'conversation' then 'conversation'
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
    case when final_status='conversation' then 'text' else 'plan_summary' end,
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


create or replace function app_private.finish_ai_plan_inline_error(
  p_plan_request_id uuid,
  p_processing_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target public.ai_plan_requests%rowtype;
  safe_error text := left(coalesce(nullif(trim(p_processing_error),''),'AI response failed.'),2000);
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  select * into target
  from public.ai_plan_requests
  where id=p_plan_request_id
  for update;

  if not found or target.requested_by<>caller_id then
    raise exception 'AI planning request not found' using errcode='P0002';
  end if;

  if target.status='planning' then
    update public.ai_plan_requests
    set status='error',
        processing_error=safe_error,
        processing_finished_at=now(),
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
      'I could not complete that response. Please try again.',
      'text',
      target.id
    );
  end if;
end;
$$;

revoke all on function app_private.finish_ai_plan_inline_error(uuid,text)
from public,anon,authenticated,service_role;
grant execute on function app_private.finish_ai_plan_inline_error(uuid,text)
to authenticated;

create or replace function public.finish_ai_plan_inline_error(
  plan_request_id uuid,
  processing_error text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_ai_plan_inline_error(plan_request_id,processing_error);
$$;

revoke all on function public.finish_ai_plan_inline_error(uuid,text)
from public,anon,service_role;
grant execute on function public.finish_ai_plan_inline_error(uuid,text)
to authenticated;
