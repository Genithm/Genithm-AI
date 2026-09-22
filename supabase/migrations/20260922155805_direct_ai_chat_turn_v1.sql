-- Separate ordinary AI chat turns from scientific planning tasks.
alter table public.ai_messages
  add column if not exists attachment_upload_ids uuid[] not null default '{}'::uuid[];

alter table public.ai_messages
  drop constraint if exists ai_messages_attachment_count;

alter table public.ai_messages
  add constraint ai_messages_attachment_count
  check (cardinality(attachment_upload_ids) between 0 and 10);

CREATE OR REPLACE FUNCTION app_private.request_ai_chat_turn(p_project_id uuid, p_conversation_id uuid, p_user_message text, p_attachment_upload_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(conversation_id uuid, user_message_id uuid, user_message text, authorized_context jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  convo public.ai_conversations%rowtype;
  message_id uuid;
  normalized_message text := trim(coalesce(p_user_message,''));
  attachment_ids uuid[] := coalesce(p_attachment_upload_ids,'{}'::uuid[]);
  attachment_count integer;
  unique_attachment_count integer;
  context jsonb;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if char_length(normalized_message)>8000 then raise exception 'AI chat message must be at most 8000 characters'; end if;
  if cardinality(attachment_ids)>10 then raise exception 'AI chat supports at most 10 attachments per message'; end if;

  select count(*) into unique_attachment_count from (select distinct unnest(attachment_ids) as id) x;
  if unique_attachment_count<>cardinality(attachment_ids) then raise exception 'duplicate AI chat attachments are not allowed'; end if;
  if normalized_message='' and cardinality(attachment_ids)=0 then raise exception 'AI chat requires a message or attachment'; end if;

  select organization_id into org_id from public.projects where id=p_project_id;
  if not found then raise exception 'project not found' using errcode='P0002'; end if;
  if not app_private.can_write_org(org_id) then raise exception 'project write access denied' using errcode='42501'; end if;
  perform app_private.consume_scientific_rate_limit('ai_chat',caller_id,org_id);

  if cardinality(attachment_ids)>0 then
    select count(*) into attachment_count
    from public.sequence_uploads u
    where u.id=any(attachment_ids)
      and u.project_id=p_project_id
      and u.organization_id=org_id
      and u.created_by=caller_id
      and u.status in ('pending_validation','ready','rejected','error');
    if attachment_count<>cardinality(attachment_ids) then
      raise exception 'one or more AI chat attachments are invalid or inaccessible' using errcode='42501';
    end if;
  end if;

  if p_conversation_id is null then
    insert into public.ai_conversations(organization_id,project_id,created_by,title)
    values(org_id,p_project_id,caller_id,left(case when normalized_message<>'' then normalized_message else 'Attached biological data' end,160))
    returning * into convo;
  else
    select * into convo from public.ai_conversations
    where id=p_conversation_id and project_id=p_project_id and organization_id=org_id
      and created_by=caller_id and status='active';
    if not found then raise exception 'AI conversation not found' using errcode='P0002'; end if;
  end if;

  insert into public.ai_messages(
    conversation_id,organization_id,project_id,conversation_owner_id,role,content,message_kind,attachment_upload_ids
  )
  values(
    convo.id,org_id,p_project_id,caller_id,'user',
    case when normalized_message='' then 'Attached biological data for analysis.' else normalized_message end,
    'text',attachment_ids
  )
  returning id into message_id;

  select jsonb_build_object(
    'project',jsonb_build_object('id',p_project_id),
    'conversation_history',coalesce((
      select jsonb_agg(jsonb_build_object('role',h.role,'kind',h.message_kind,'content',left(h.content,4000)) order by h.created_at asc)
      from (
        select m.role,m.message_kind,m.content,m.created_at from public.ai_messages m
        where m.conversation_id=convo.id and m.id<>message_id
        order by created_at desc limit 12
      ) h
    ),'[]'::jsonb),
    'current_attachments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,'filename',left(u.original_filename,255),'status',u.status,
        'sequence_type',u.sequence_type,'sequence_count',u.sequence_count,
        'residue_count',u.residue_count,'sha256',u.sha256
      ) order by u.created_at asc)
      from public.sequence_uploads u where u.id=any(attachment_ids)
    ),'[]'::jsonb),
    'sequences',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,'filename',left(u.original_filename,255),'sequence_type',u.sequence_type,
        'residue_count',u.residue_count,'sha256',u.sha256
      ) order by u.created_at desc)
      from (
        select id,original_filename,sequence_type,residue_count,sha256,created_at
        from public.sequence_uploads
        where project_id=p_project_id and organization_id=org_id
          and status='ready' and sequence_count=1 and sha256 is not null
        order by created_at desc limit 100
      ) u
    ),'[]'::jsonb),
    'scientific_jobs',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,'job_type',s.job_type,'status',s.status,'tool_id',s.tool_id,
        'tool_version',s.tool_version,'result_sha256',s.result_sha256,'result_summary',s.result_summary
      ) order by s.created_at desc)
      from (
        select id,job_type,status,tool_id,tool_version,result_sha256,result_summary,created_at
        from public.scientific_jobs where project_id=p_project_id and organization_id=org_id
        order by created_at desc limit 30
      ) s
    ),'[]'::jsonb),
    'ncbi_retrievals',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'source_database',r.source_database,'resolved_accession',r.resolved_accession,
        'status',r.status,'sequence_upload_id',r.sequence_upload_id
      ) order by r.created_at desc)
      from (
        select id,source_database,resolved_accession,status,sequence_upload_id,created_at
        from public.sequence_retrievals where project_id=p_project_id and organization_id=org_id
        order by created_at desc limit 30
      ) r
    ),'[]'::jsonb),
    'protein_annotations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',a.id,'sequence_upload_id',a.sequence_upload_id,'status',a.status,
        'refseq_accession',a.refseq_accession,'uniprot_accession',a.uniprot_accession
      ) order by a.created_at desc)
      from (
        select id,sequence_upload_id,status,refseq_accession,uniprot_accession,created_at
        from public.protein_annotation_jobs where project_id=p_project_id and organization_id=org_id
        order by created_at desc limit 20
      ) a
    ),'[]'::jsonb)
  ) into context;

  return query select convo.id,message_id,
    case when normalized_message='' then 'Attached biological data for analysis.' else normalized_message end,
    context;
end;
$function$


revoke all on function app_private.request_ai_chat_turn(uuid,uuid,text,uuid[])
from public,anon,authenticated,service_role;
grant execute on function app_private.request_ai_chat_turn(uuid,uuid,text,uuid[])
to authenticated;

create or replace function public.request_ai_chat_turn(
  project_id uuid,
  conversation_id uuid,
  user_message text,
  attachment_upload_ids uuid[] default '{}'::uuid[]
)
returns table(
  conversation_id uuid,
  user_message_id uuid,
  user_message text,
  authorized_context jsonb
)
language sql
security invoker
set search_path=''
as $$
  select * from app_private.request_ai_chat_turn(
    project_id,conversation_id,user_message,attachment_upload_ids
  );
$$;

revoke all on function public.request_ai_chat_turn(uuid,uuid,text,uuid[])
from public,anon,service_role;
grant execute on function public.request_ai_chat_turn(uuid,uuid,text,uuid[])
to authenticated;

CREATE OR REPLACE FUNCTION app_private.finish_ai_chat_turn(p_user_message_id uuid, p_expected_user_id uuid, p_assistant_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  source public.ai_messages%rowtype;
  assistant_id uuid;
  response_text text := trim(coalesce(p_assistant_message,''));
begin
  if response_text='' or char_length(response_text)>16000 then raise exception 'assistant chat response is invalid'; end if;
  select * into source from public.ai_messages where id=p_user_message_id and role='user' for update;
  if not found or source.conversation_owner_id<>p_expected_user_id then raise exception 'AI chat turn not found' using errcode='P0002'; end if;
  insert into public.ai_messages(conversation_id,organization_id,project_id,conversation_owner_id,role,content,message_kind)
  values(source.conversation_id,source.organization_id,source.project_id,source.conversation_owner_id,'assistant',response_text,'text')
  returning id into assistant_id;
  return assistant_id;
end;
$function$


revoke all on function app_private.finish_ai_chat_turn(uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function app_private.finish_ai_chat_turn(uuid,uuid,text)
to service_role;

create or replace function public.finish_ai_chat_turn(
  user_message_id uuid,
  expected_user_id uuid,
  assistant_message text
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select app_private.finish_ai_chat_turn(
    user_message_id,expected_user_id,assistant_message
  );
$$;

revoke all on function public.finish_ai_chat_turn(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.finish_ai_chat_turn(uuid,uuid,text)
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
  select * into source from public.ai_messages where id=p_user_message_id and role='user' for update;
  if not found or source.conversation_owner_id<>p_expected_user_id then raise exception 'AI chat turn not found' using errcode='P0002'; end if;
  if source.plan_request_id is not null then raise exception 'AI chat turn already has a scientific plan'; end if;

  if trim(p_provider)!~'^[a-z0-9_-]{2,64}$' or nullif(trim(p_model),'') is null or char_length(trim(p_model))>128
     or nullif(trim(p_prompt_version),'') is null or char_length(trim(p_prompt_version))>128
     or p_policy_version is distinct from 'ai-policy-v1' then
    raise exception 'AI planner provenance is invalid';
  end if;

  if p_plan->>'intent' is distinct from 'scientific_action'
     or char_length(coalesce(p_plan->>'summary',''))<1 or char_length(p_plan->>'summary')>2000
     or jsonb_typeof(coalesce(p_plan->'limitations','[]'::jsonb))<>'array' then
    raise exception 'AI scientific plan is invalid';
  end if;

  insert into public.ai_plan_requests(
    conversation_id,user_message_id,organization_id,project_id,requested_by,
    status,processing_attempts,processing_started_at,attachment_upload_ids
  )
  values(
    source.conversation_id,source.id,source.organization_id,source.project_id,source.conversation_owner_id,
    'planning',1,now(),source.attachment_upload_ids
  )
  returning id into request_id;

  select app_private.validate_ai_plan_for_request_v2(r,p_plan) into action
  from public.ai_plan_requests r where r.id=request_id;

  canonical := p_plan::text;
  plan_hash := encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex');
  summary := left(p_plan->>'summary',2000);

  update public.ai_plan_requests
  set status='ready',provider=trim(p_provider),model=trim(p_model),prompt_version=trim(p_prompt_version),
      policy_version=p_policy_version,plan_schema_version='ai-plan-v1',plan=p_plan,plan_sha256=plan_hash,
      action_type=action,requires_confirmation=true,processing_finished_at=now(),processing_error=null,updated_at=now()
  where id=request_id;

  update public.ai_messages set plan_request_id=request_id where id=source.id;

  insert into public.ai_messages(
    conversation_id,organization_id,project_id,conversation_owner_id,role,content,message_kind,plan_request_id
  )
  values(
    source.conversation_id,source.organization_id,source.project_id,source.conversation_owner_id,
    'assistant',summary,'plan_summary',request_id
  );

  return query select request_id,'ready'::text;
end;
$function$


revoke all on function app_private.create_ai_plan_from_chat(uuid,uuid,text,text,text,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function app_private.create_ai_plan_from_chat(uuid,uuid,text,text,text,text,jsonb)
to service_role;

create or replace function public.create_ai_plan_from_chat(
  user_message_id uuid,
  expected_user_id uuid,
  provider text,
  model text,
  prompt_version text,
  policy_version text,
  plan jsonb
)
returns table(plan_request_id uuid,status text)
language sql
security invoker
set search_path=''
as $$
  select * from app_private.create_ai_plan_from_chat(
    user_message_id,expected_user_id,provider,model,prompt_version,policy_version,plan
  );
$$;

revoke all on function public.create_ai_plan_from_chat(uuid,uuid,text,text,text,text,jsonb)
from public,anon,authenticated;
grant execute on function public.create_ai_plan_from_chat(uuid,uuid,text,text,text,text,jsonb)
to service_role;
