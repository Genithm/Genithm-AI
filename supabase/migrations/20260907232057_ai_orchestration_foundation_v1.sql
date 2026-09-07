select pgmq.create('ai_planning');

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_conversations_project_org_fkey foreign key (project_id,organization_id) references public.projects(id,organization_id) on delete cascade,
  constraint ai_conversations_title check (char_length(title) between 1 and 160),
  constraint ai_conversations_status check (status in ('active','archived')),
  constraint ai_conversations_scope_key unique (id,project_id,organization_id,created_by)
);
create index ai_conversations_owner_created_idx on public.ai_conversations(created_by,created_at desc);
create index ai_conversations_project_owner_idx on public.ai_conversations(project_id,created_by,created_at desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_conversations force row level security;
create policy ai_conversations_select_owner on public.ai_conversations for select to authenticated
using ((select auth.uid())=created_by and (select app_private.is_org_member(organization_id)));
revoke all on table public.ai_conversations from public,anon,authenticated,service_role;
grant select on table public.ai_conversations to authenticated;

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  conversation_owner_id uuid not null,
  role text not null,
  content text not null,
  message_kind text not null default 'text',
  plan_request_id uuid,
  created_at timestamptz not null default now(),
  constraint ai_messages_conversation_fkey foreign key (conversation_id,project_id,organization_id,conversation_owner_id)
    references public.ai_conversations(id,project_id,organization_id,created_by) on delete cascade,
  constraint ai_messages_role check (role in ('user','assistant')),
  constraint ai_messages_kind check (message_kind in ('text','plan_summary','execution_status')),
  constraint ai_messages_content check (char_length(content) between 1 and 16000)
);
create index ai_messages_conversation_created_idx on public.ai_messages(conversation_id,created_at);
create index ai_messages_owner_created_idx on public.ai_messages(conversation_owner_id,created_at desc);

alter table public.ai_messages enable row level security;
alter table public.ai_messages force row level security;
create policy ai_messages_select_owner on public.ai_messages for select to authenticated
using ((select auth.uid())=conversation_owner_id and (select app_private.is_org_member(organization_id)));
revoke all on table public.ai_messages from public,anon,authenticated,service_role;
grant select on table public.ai_messages to authenticated;

create table public.ai_plan_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_message_id uuid not null unique,
  organization_id uuid not null,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'queued',
  provider text,
  model text,
  prompt_version text,
  policy_version text not null default 'ai-policy-v1',
  plan_schema_version text,
  plan jsonb,
  plan_sha256 text,
  action_type text,
  requires_confirmation boolean not null default true,
  dispatched_resource_type text,
  dispatched_resource_id uuid,
  processing_attempts integer not null default 0,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_plan_requests_conversation_fkey foreign key (conversation_id,project_id,organization_id,requested_by)
    references public.ai_conversations(id,project_id,organization_id,created_by) on delete cascade,
  constraint ai_plan_requests_user_message_fkey foreign key (user_message_id) references public.ai_messages(id) on delete cascade,
  constraint ai_plan_requests_status check (status in ('queued','planning','ready','unsupported','error','dispatched')),
  constraint ai_plan_requests_provider check (provider is null or provider ~ '^[a-z0-9_-]{2,64}$'),
  constraint ai_plan_requests_model check (model is null or char_length(model) between 1 and 128),
  constraint ai_plan_requests_prompt_version check (prompt_version is null or char_length(prompt_version) between 1 and 128),
  constraint ai_plan_requests_policy_version check (char_length(policy_version) between 1 and 128),
  constraint ai_plan_requests_schema_version check (plan_schema_version is null or plan_schema_version='ai-plan-v1'),
  constraint ai_plan_requests_plan_object check (plan is null or jsonb_typeof(plan)='object'),
  constraint ai_plan_requests_plan_sha check (plan_sha256 is null or plan_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_plan_requests_action check (action_type is null or action_type in ('ncbi_sequence_retrieval','blast','pairwise_alignment','multiple_sequence_alignment','phylogenetic_tree','protein_properties','protein_annotation')),
  constraint ai_plan_requests_attempts check (processing_attempts >= 0),
  constraint ai_plan_requests_error check (processing_error is null or char_length(processing_error)<=2000)
);
create index ai_plan_requests_owner_created_idx on public.ai_plan_requests(requested_by,created_at desc);
create index ai_plan_requests_conversation_created_idx on public.ai_plan_requests(conversation_id,created_at desc);
create index ai_plan_requests_project_created_idx on public.ai_plan_requests(project_id,created_at desc);
create index ai_plan_requests_status_idx on public.ai_plan_requests(status,created_at);

alter table public.ai_plan_requests enable row level security;
alter table public.ai_plan_requests force row level security;
create policy ai_plan_requests_select_owner on public.ai_plan_requests for select to authenticated
using ((select auth.uid())=requested_by and (select app_private.is_org_member(organization_id)));
revoke all on table public.ai_plan_requests from public,anon,authenticated,service_role;
grant select on table public.ai_plan_requests to authenticated;

alter table public.ai_messages add constraint ai_messages_plan_request_fkey foreign key (plan_request_id) references public.ai_plan_requests(id) on delete set null;

insert into app_private.scientific_rate_limit_policies(action,window_seconds,user_limit,organization_limit)
values ('ai_planning',60,10,50)
on conflict (action) do update set window_seconds=excluded.window_seconds,user_limit=excluded.user_limit,organization_limit=excluded.organization_limit;

create or replace function app_private.request_ai_plan(p_project_id uuid,p_conversation_id uuid,p_user_message text)
returns table(conversation_id uuid,plan_request_id uuid)
language plpgsql security definer set search_path='' as $$
declare
  caller_id uuid:=auth.uid(); org_id uuid; convo public.ai_conversations%rowtype; message_id uuid; request_id uuid;
  normalized_message text:=trim(p_user_message); queue_id bigint; user_active integer; org_active integer;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if normalized_message='' or char_length(normalized_message)>8000 then raise exception 'AI request must be between 1 and 8000 characters'; end if;
  select organization_id into org_id from public.projects where id=p_project_id;
  if not found then raise exception 'project not found' using errcode='P0002'; end if;
  if not app_private.can_write_org(org_id) then raise exception 'project write access denied' using errcode='42501'; end if;

  perform app_private.consume_scientific_rate_limit('ai_planning',caller_id,org_id);
  select count(*) into user_active from public.ai_plan_requests where requested_by=caller_id and status in ('queued','planning');
  select count(*) into org_active from public.ai_plan_requests where organization_id=org_id and status in ('queued','planning');
  if user_active>=2 or org_active>=10 then
    raise sqlstate 'PGRST' using message=jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active AI planning requests. Wait for current planning to finish.')::text,detail=jsonb_build_object('status',429)::text;
  end if;

  if p_conversation_id is null then
    insert into public.ai_conversations(organization_id,project_id,created_by,title)
    values(org_id,p_project_id,caller_id,left(normalized_message,160)) returning * into convo;
  else
    select * into convo from public.ai_conversations where id=p_conversation_id and project_id=p_project_id and organization_id=org_id and created_by=caller_id and status='active';
    if not found then raise exception 'AI conversation not found' using errcode='P0002'; end if;
  end if;

  insert into public.ai_messages(conversation_id,organization_id,project_id,conversation_owner_id,role,content)
  values(convo.id,org_id,p_project_id,caller_id,'user',normalized_message) returning id into message_id;

  insert into public.ai_plan_requests(conversation_id,user_message_id,organization_id,project_id,requested_by)
  values(convo.id,message_id,org_id,p_project_id,caller_id) returning id into request_id;
  update public.ai_messages set plan_request_id=request_id where id=message_id;

  select pgmq.send(queue_name=>'ai_planning',msg=>jsonb_build_object('plan_request_id',request_id)) into queue_id;
  if queue_id is null then raise exception 'failed to enqueue AI planning request'; end if;
  return query select convo.id,request_id;
end;$$;

create or replace function public.request_ai_plan(project_id uuid,conversation_id uuid,user_message text)
returns table(conversation_id uuid,plan_request_id uuid)
language sql security invoker set search_path='' as $$ select * from app_private.request_ai_plan(project_id,conversation_id,user_message); $$;
revoke all on function app_private.request_ai_plan(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.request_ai_plan(uuid,uuid,text) to authenticated;
revoke all on function public.request_ai_plan(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.request_ai_plan(uuid,uuid,text) to authenticated;

create or replace function app_private.claim_ai_plan_request(p_visibility_seconds integer default 300)
returns table(message_id bigint,plan_request_id uuid,conversation_id uuid,organization_id uuid,project_id uuid,requested_by uuid,user_message text,authorized_context jsonb)
language plpgsql security definer set search_path='' as $$
declare q record; target public.ai_plan_requests%rowtype; target_id uuid; msg text; context jsonb;
begin
  if p_visibility_seconds<60 or p_visibility_seconds>900 then raise exception 'visibility timeout must be between 60 and 900 seconds'; end if;
  select * into q from pgmq.read(queue_name=>'ai_planning',vt=>p_visibility_seconds,qty=>1) limit 1;
  if not found then return; end if;
  begin target_id:=(q.message->>'plan_request_id')::uuid; exception when others then perform pgmq.delete('ai_planning',q.msg_id); return; end;
  select * into target from public.ai_plan_requests where id=target_id for update;
  if not found or target.status<>'queued' then perform pgmq.delete('ai_planning',q.msg_id); return; end if;
  select content into msg from public.ai_messages where id=target.user_message_id and role='user';
  if msg is null then update public.ai_plan_requests set status='error',processing_error='User message is missing.',processing_finished_at=now(),updated_at=now() where id=target.id; perform pgmq.delete('ai_planning',q.msg_id); return; end if;

  select jsonb_build_object(
    'project',jsonb_build_object('id',target.project_id),
    'sequences',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'filename',u.original_filename,'sequence_type',u.sequence_type,'residue_count',u.residue_count,'sha256',u.sha256) order by u.created_at desc) from public.sequence_uploads u where u.project_id=target.project_id and u.organization_id=target.organization_id and u.status='ready' and u.sequence_count=1 and u.sha256 is not null limit 100),'[]'::jsonb),
    'scientific_jobs',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'job_type',s.job_type,'status',s.status,'tool_id',s.tool_id,'tool_version',s.tool_version,'result_sha256',s.result_sha256,'result_summary',s.result_summary) order by s.created_at desc) from (select * from public.scientific_jobs where project_id=target.project_id and organization_id=target.organization_id order by created_at desc limit 50) s),'[]'::jsonb),
    'ncbi_retrievals',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source_database',r.source_database,'resolved_accession',r.resolved_accession,'status',r.status,'sequence_upload_id',r.sequence_upload_id) order by r.created_at desc) from (select * from public.sequence_retrievals where project_id=target.project_id and organization_id=target.organization_id order by created_at desc limit 50) r),'[]'::jsonb),
    'protein_annotations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'sequence_upload_id',a.sequence_upload_id,'status',a.status,'refseq_accession',a.refseq_accession,'uniprot_accession',a.uniprot_accession) order by a.created_at desc) from (select * from public.protein_annotation_jobs where project_id=target.project_id and organization_id=target.organization_id order by created_at desc limit 20) a),'[]'::jsonb)
  ) into context;

  update public.ai_plan_requests set status='planning',processing_attempts=processing_attempts+1,processing_started_at=coalesce(processing_started_at,now()),processing_error=null,updated_at=now() where id=target.id;
  return query select q.msg_id::bigint,target.id,target.conversation_id,target.organization_id,target.project_id,target.requested_by,msg,context;
end;$$;

create or replace function public.claim_ai_plan_request(visibility_seconds integer default 300)
returns table(message_id bigint,plan_request_id uuid,conversation_id uuid,organization_id uuid,project_id uuid,requested_by uuid,user_message text,authorized_context jsonb)
language sql security invoker set search_path='' as $$ select * from app_private.claim_ai_plan_request(visibility_seconds); $$;
revoke all on function app_private.claim_ai_plan_request(integer) from public,anon,authenticated;
grant execute on function app_private.claim_ai_plan_request(integer) to service_role;
revoke all on function public.claim_ai_plan_request(integer) from public,anon,authenticated;
grant execute on function public.claim_ai_plan_request(integer) to service_role;

create or replace function app_private.validate_ai_plan_for_request(p_request public.ai_plan_requests,p_plan jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare action text; params jsonb; ids uuid[]; expected integer; actual integer;
begin
  if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_plan->>'schema_version' is distinct from 'ai-plan-v1' then raise exception 'AI plan schema version is invalid'; end if;
  if p_plan->>'intent'='unsupported' then
    if p_plan->'action' is not null and p_plan->'action'<>'null'::jsonb then raise exception 'unsupported AI plan cannot contain an action'; end if;
    return null;
  end if;
  if p_plan->>'intent'<>'scientific_action' then raise exception 'AI plan intent is invalid'; end if;
  if jsonb_typeof(p_plan->'action')<>'object' then raise exception 'AI scientific plan must contain one action'; end if;
  action:=p_plan->'action'->>'type'; params:=p_plan->'action'->'parameters';
  if action not in ('ncbi_sequence_retrieval','blast','pairwise_alignment','multiple_sequence_alignment','phylogenetic_tree','protein_properties','protein_annotation') or jsonb_typeof(params)<>'object' then raise exception 'AI plan action is not allowlisted'; end if;

  if action='ncbi_sequence_retrieval' then
    if params->>'database_name' not in ('nucleotide','protein') or coalesce(params->>'accession','') !~ '^(?=.*[A-Z])[A-Z0-9_]+(\.[0-9]+)?$' or char_length(params->>'accession')>64 then raise exception 'AI NCBI plan parameters are invalid'; end if;
  elsif action='blast' then
    if not exists(select 1 from public.sequence_uploads u where u.id=(params->>'query_upload_id')::uuid and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id and u.status='ready' and u.sequence_count=1 and u.sha256 is not null) then raise exception 'AI BLAST input is not authorized or ready'; end if;
    if params->>'program' not in ('blastn','blastp') then raise exception 'AI BLAST program is invalid'; end if;
  elsif action='pairwise_alignment' then
    select array[(params->>'sequence_a_id')::uuid,(params->>'sequence_b_id')::uuid] into ids;
    select count(*) into actual from public.sequence_uploads u where u.id=any(ids) and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id and u.status='ready' and u.sequence_count=1 and u.sha256 is not null;
    if actual<>2 or ids[1]=ids[2] or params->>'algorithm' not in ('global','local') then raise exception 'AI pairwise inputs are invalid'; end if;
  elsif action='multiple_sequence_alignment' then
    if jsonb_typeof(params->'sequence_upload_ids')<>'array' then raise exception 'AI MSA inputs are invalid'; end if;
    select array_agg(value::uuid) into ids from jsonb_array_elements_text(params->'sequence_upload_ids'); expected:=coalesce(array_length(ids,1),0);
    if expected<3 or expected>50 or (select count(distinct x) from unnest(ids) x)<>expected then raise exception 'AI MSA input count is invalid'; end if;
    select count(*) into actual from public.sequence_uploads u where u.id=any(ids) and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id and u.status='ready' and u.sequence_count=1 and u.sha256 is not null;
    if actual<>expected then raise exception 'AI MSA inputs are not authorized or ready'; end if;
  elsif action='phylogenetic_tree' then
    if not exists(select 1 from public.scientific_jobs s where s.id=(params->>'msa_job_id')::uuid and s.project_id=p_request.project_id and s.organization_id=p_request.organization_id and s.job_type='multiple_sequence_alignment' and s.status='completed' and s.result_sha256 is not null) then raise exception 'AI phylogeny source MSA is invalid'; end if;
  elsif action='protein_properties' then
    if not exists(select 1 from public.sequence_uploads u where u.id=(params->>'sequence_upload_id')::uuid and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id and u.status='ready' and u.sequence_count=1 and u.sequence_type='protein' and u.sha256 is not null) then raise exception 'AI protein properties input is invalid'; end if;
  elsif action='protein_annotation' then
    if not exists(select 1 from public.sequence_uploads u join public.sequence_retrievals r on r.sequence_upload_id=u.id where u.id=(params->>'sequence_upload_id')::uuid and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id and u.status='ready' and u.sequence_count=1 and u.sequence_type='protein' and u.sha256 is not null and r.source_database='protein' and r.status='retrieved') then raise exception 'AI protein annotation input is invalid'; end if;
  end if;
  return action;
exception when invalid_text_representation then raise exception 'AI plan contains an invalid resource identifier';
end;$$;

create or replace function app_private.finish_ai_plan_success(p_message_id bigint,p_plan_request_id uuid,p_provider text,p_model text,p_prompt_version text,p_policy_version text,p_plan jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare target public.ai_plan_requests%rowtype; action text; canonical text; plan_hash text; summary text; final_status text;
begin
  select * into target from public.ai_plan_requests where id=p_plan_request_id for update;
  if not found or target.status<>'planning' then raise exception 'AI planning request is not active' using errcode='P0002'; end if;
  if trim(p_provider) !~ '^[a-z0-9_-]{2,64}$' or nullif(trim(p_model),'') is null or char_length(trim(p_model))>128 or nullif(trim(p_prompt_version),'') is null or char_length(trim(p_prompt_version))>128 or p_policy_version is distinct from 'ai-policy-v1' then raise exception 'AI planner provenance is invalid'; end if;
  if char_length(coalesce(p_plan->>'summary',''))<1 or char_length(p_plan->>'summary')>2000 or jsonb_typeof(coalesce(p_plan->'limitations','[]'::jsonb))<>'array' then raise exception 'AI plan summary is invalid'; end if;
  action:=app_private.validate_ai_plan_for_request(target,p_plan);
  final_status:=case when p_plan->>'intent'='unsupported' then 'unsupported' else 'ready' end;
  canonical:=p_plan::text; plan_hash:=encode(extensions.digest(convert_to(canonical,'UTF8'),'sha256'),'hex'); summary:=left(p_plan->>'summary',2000);
  update public.ai_plan_requests set status=final_status,provider=trim(p_provider),model=trim(p_model),prompt_version=trim(p_prompt_version),policy_version=p_policy_version,plan_schema_version='ai-plan-v1',plan=p_plan,plan_sha256=plan_hash,action_type=action,requires_confirmation=(final_status='ready'),processing_finished_at=now(),processing_error=null,updated_at=now() where id=target.id;
  insert into public.ai_messages(conversation_id,organization_id,project_id,conversation_owner_id,role,content,message_kind,plan_request_id)
  values(target.conversation_id,target.organization_id,target.project_id,target.requested_by,'assistant',summary,'plan_summary',target.id);
  if not pgmq.delete('ai_planning',p_message_id) then raise exception 'AI planning queue message delete failed'; end if;
end;$$;

create or replace function public.finish_ai_plan_success(message_id bigint,plan_request_id uuid,provider text,model text,prompt_version text,policy_version text,plan jsonb)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_ai_plan_success(message_id,plan_request_id,provider,model,prompt_version,policy_version,plan); $$;
revoke all on function app_private.finish_ai_plan_success(bigint,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.finish_ai_plan_success(bigint,uuid,text,text,text,text,jsonb) to service_role;
revoke all on function public.finish_ai_plan_success(bigint,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_ai_plan_success(bigint,uuid,text,text,text,text,jsonb) to service_role;

create or replace function app_private.finish_ai_plan_error(p_message_id bigint,p_plan_request_id uuid,p_processing_error text,p_retryable boolean default true,p_max_attempts integer default 3)
returns text language plpgsql security definer set search_path='' as $$
declare target public.ai_plan_requests%rowtype; new_id bigint; safe_error text:=left(coalesce(nullif(trim(p_processing_error),''),'AI planning failed.'),2000);
begin
  if p_max_attempts<1 or p_max_attempts>5 then raise exception 'invalid AI max attempts'; end if;
  select * into target from public.ai_plan_requests where id=p_plan_request_id for update;
  if not found then perform pgmq.delete('ai_planning',p_message_id); return 'discarded'; end if;
  if target.status<>'planning' then perform pgmq.delete('ai_planning',p_message_id); return 'discarded'; end if;
  if p_retryable and target.processing_attempts<p_max_attempts then
    update public.ai_plan_requests set status='queued',processing_error=safe_error,updated_at=now() where id=target.id;
    if not pgmq.delete('ai_planning',p_message_id) then raise exception 'AI queue delete failed'; end if;
    select pgmq.send(queue_name=>'ai_planning',msg=>jsonb_build_object('plan_request_id',target.id),delay=>15) into new_id;
    if new_id is null then raise exception 'AI retry enqueue failed'; end if;
    return 'retry';
  end if;
  update public.ai_plan_requests set status='error',processing_error=safe_error,processing_finished_at=now(),updated_at=now() where id=target.id;
  perform pgmq.delete('ai_planning',p_message_id);
  return 'error';
end;$$;

create or replace function public.finish_ai_plan_error(message_id bigint,plan_request_id uuid,processing_error text,retryable boolean default true,max_attempts integer default 3)
returns text language sql security invoker set search_path='' as $$ select app_private.finish_ai_plan_error(message_id,plan_request_id,processing_error,retryable,max_attempts); $$;
revoke all on function app_private.finish_ai_plan_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function app_private.finish_ai_plan_error(bigint,uuid,text,boolean,integer) to service_role;
revoke all on function public.finish_ai_plan_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.finish_ai_plan_error(bigint,uuid,text,boolean,integer) to service_role;

create or replace function app_private.approve_ai_plan(p_plan_request_id uuid)
returns table(resource_type text,resource_id uuid)
language plpgsql security definer set search_path='' as $$
declare caller_id uuid:=auth.uid(); target public.ai_plan_requests%rowtype; params jsonb; action text; result_id uuid; r_type text;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into target from public.ai_plan_requests where id=p_plan_request_id for update;
  if not found or target.requested_by<>caller_id or target.status<>'ready' or target.plan is null then raise exception 'AI plan is not ready for approval' using errcode='P0002'; end if;
  if not app_private.can_write_org(target.organization_id) then raise exception 'project write access denied' using errcode='42501'; end if;
  action:=app_private.validate_ai_plan_for_request(target,target.plan); params:=target.plan->'action'->'parameters';

  if action='ncbi_sequence_retrieval' then result_id:=app_private.request_ncbi_sequence_retrieval(target.project_id,params->>'database_name',upper(params->>'accession')); r_type:='sequence_retrieval';
  elsif action='blast' then result_id:=app_private.request_blast_job(target.project_id,(params->>'query_upload_id')::uuid,params->>'program',case when params->>'program'='blastp' then 'swissprot' else 'core_nt' end,coalesce((params->>'expect_value')::numeric,10),coalesce((params->>'max_targets')::integer,20),coalesce((params->>'low_complexity_filter')::boolean,true)); r_type:='blast_job';
  elsif action='pairwise_alignment' then result_id:=app_private.request_pairwise_alignment(target.project_id,(params->>'sequence_a_id')::uuid,(params->>'sequence_b_id')::uuid,coalesce(params->>'algorithm','global'),coalesce((params->>'match_score')::integer,2),coalesce((params->>'mismatch_score')::integer,-1),coalesce((params->>'gap_score')::integer,-2)); r_type:='scientific_job';
  elsif action='multiple_sequence_alignment' then result_id:=app_private.request_multiple_sequence_alignment(target.project_id,array(select value::uuid from jsonb_array_elements_text(params->'sequence_upload_ids'))); r_type:='scientific_job';
  elsif action='phylogenetic_tree' then result_id:=app_private.request_phylogenetic_tree(target.project_id,(params->>'msa_job_id')::uuid); r_type:='scientific_job';
  elsif action='protein_properties' then result_id:=app_private.request_protein_properties(target.project_id,(params->>'sequence_upload_id')::uuid); r_type:='scientific_job';
  elsif action='protein_annotation' then result_id:=app_private.request_protein_annotation(target.project_id,(params->>'sequence_upload_id')::uuid); r_type:='protein_annotation_job';
  else raise exception 'AI plan action is not dispatchable'; end if;

  update public.ai_plan_requests set status='dispatched',dispatched_resource_type=r_type,dispatched_resource_id=result_id,updated_at=now() where id=target.id;
  insert into public.ai_messages(conversation_id,organization_id,project_id,conversation_owner_id,role,content,message_kind,plan_request_id)
  values(target.conversation_id,target.organization_id,target.project_id,target.requested_by,'assistant','Approved plan dispatched to the authoritative Genithm execution layer.','execution_status',target.id);
  return query select r_type,result_id;
end;$$;

create or replace function public.approve_ai_plan(plan_request_id uuid)
returns table(resource_type text,resource_id uuid)
language sql security invoker set search_path='' as $$ select * from app_private.approve_ai_plan(plan_request_id); $$;
revoke all on function app_private.approve_ai_plan(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.approve_ai_plan(uuid) to authenticated;
revoke all on function public.approve_ai_plan(uuid) from public,anon,service_role;
grant execute on function public.approve_ai_plan(uuid) to authenticated;

create or replace function app_private.audit_ai_plan_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_name text; event_outcome text; details jsonb;
begin
  if tg_op='INSERT' then event_name:='AI_PLAN_REQUEST_CREATED'; event_outcome:='created';
  elsif new.status is distinct from old.status then event_name:='AI_PLAN_STATUS_CHANGED'; event_outcome:=case when new.status='error' then 'failed' when new.status='dispatched' then 'completed' else 'state_change' end;
  else return new; end if;
  details:=jsonb_strip_nulls(jsonb_build_object('status',new.status,'previous_status',case when tg_op='UPDATE' then old.status else null end,'provider',new.provider,'model',new.model,'prompt_version',new.prompt_version,'policy_version',new.policy_version,'plan_sha256',new.plan_sha256,'action_type',new.action_type,'dispatched_resource_type',new.dispatched_resource_type,'dispatched_resource_id',new.dispatched_resource_id));
  perform app_private.append_audit_event(new.organization_id,new.project_id,new.requested_by,case when auth.uid() is null then 'service' else 'user' end,event_name,'ai_plan_request',new.id::text,event_outcome,details);
  return new;
end;$$;
create trigger ai_plan_requests_audit_events after insert or update on public.ai_plan_requests for each row execute function app_private.audit_ai_plan_change();

revoke all on function app_private.validate_ai_plan_for_request(public.ai_plan_requests,jsonb) from public,anon,authenticated,service_role;
revoke all on function app_private.audit_ai_plan_change() from public,anon,authenticated,service_role;
