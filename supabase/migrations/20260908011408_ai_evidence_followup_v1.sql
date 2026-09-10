select pgmq.create('ai_evidence_followup');

create table public.ai_evidence_followup_requests (
  id uuid primary key default gen_random_uuid(),
  interpretation_request_id uuid not null references public.ai_interpretation_requests(id) on delete cascade,
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  question text not null,
  question_sha256 text not null,
  evidence_schema_version text not null default 'ai-evidence-v1',
  evidence_snapshot jsonb not null,
  evidence_sha256 text not null,
  status text not null default 'queued',
  provider text,
  model text,
  prompt_version text,
  policy_version text not null default 'ai-evidence-followup-policy-v1',
  answer_schema_version text,
  answer jsonb,
  answer_sha256 text,
  processing_attempts integer not null default 0,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_evidence_followup_conversation_fkey foreign key (conversation_id,project_id,organization_id,requested_by)
    references public.ai_conversations(id,project_id,organization_id,created_by) on delete cascade,
  constraint ai_evidence_followup_question check (char_length(trim(question)) between 1 and 4000),
  constraint ai_evidence_followup_question_sha check (question_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_evidence_followup_evidence_schema check (evidence_schema_version='ai-evidence-v1'),
  constraint ai_evidence_followup_evidence_object check (jsonb_typeof(evidence_snapshot)='object'),
  constraint ai_evidence_followup_evidence_size check (octet_length(evidence_snapshot::text)<=65536),
  constraint ai_evidence_followup_evidence_sha check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_evidence_followup_status check (status in ('queued','answering','completed','error')),
  constraint ai_evidence_followup_provider check (provider is null or provider ~ '^[a-z0-9_-]{2,64}$'),
  constraint ai_evidence_followup_model check (model is null or char_length(model) between 1 and 128),
  constraint ai_evidence_followup_prompt_version check (prompt_version is null or char_length(prompt_version) between 1 and 128),
  constraint ai_evidence_followup_policy check (policy_version='ai-evidence-followup-policy-v1'),
  constraint ai_evidence_followup_answer_schema check (answer_schema_version is null or answer_schema_version='ai-evidence-answer-v1'),
  constraint ai_evidence_followup_answer_object check (answer is null or jsonb_typeof(answer)='object'),
  constraint ai_evidence_followup_answer_size check (answer is null or octet_length(answer::text)<=32768),
  constraint ai_evidence_followup_answer_sha check (answer_sha256 is null or answer_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_evidence_followup_attempts check (processing_attempts>=0),
  constraint ai_evidence_followup_error check (processing_error is null or char_length(processing_error)<=2000),
  constraint ai_evidence_followup_lifecycle check (
    (status='queued' and processing_finished_at is null and answer is null and answer_sha256 is null)
    or (status='answering' and processing_started_at is not null and processing_finished_at is null and answer is null and answer_sha256 is null)
    or (status='completed' and processing_finished_at is not null and answer is not null and answer_schema_version='ai-evidence-answer-v1' and answer_sha256 is not null and processing_error is null)
    or (status='error' and processing_finished_at is not null and answer is null and answer_sha256 is null and processing_error is not null)
  )
);

create unique index ai_evidence_followup_idempotent_idx
on public.ai_evidence_followup_requests(interpretation_request_id,question_sha256,evidence_sha256)
where status in ('queued','answering','completed');
create index ai_evidence_followup_owner_created_idx on public.ai_evidence_followup_requests(requested_by,created_at desc);
create index ai_evidence_followup_conversation_created_idx on public.ai_evidence_followup_requests(conversation_id,created_at desc);
create index ai_evidence_followup_interpretation_created_idx on public.ai_evidence_followup_requests(interpretation_request_id,created_at desc);
create index ai_evidence_followup_status_created_idx on public.ai_evidence_followup_requests(status,created_at);

create trigger ai_evidence_followup_set_updated_at before update on public.ai_evidence_followup_requests
for each row execute function app_private.set_updated_at();

alter table public.ai_evidence_followup_requests enable row level security;
alter table public.ai_evidence_followup_requests force row level security;
create policy ai_evidence_followup_select_owner on public.ai_evidence_followup_requests for select to authenticated
using ((select auth.uid())=requested_by and (select app_private.is_org_member(organization_id)));
revoke all on table public.ai_evidence_followup_requests from public,anon,authenticated,service_role;
grant select on table public.ai_evidence_followup_requests to authenticated;

insert into app_private.scientific_rate_limit_policies(action,window_seconds,user_limit,organization_limit)
values ('ai_evidence_followup',60,20,100)
on conflict (action) do update set window_seconds=excluded.window_seconds,user_limit=excluded.user_limit,organization_limit=excluded.organization_limit;

create or replace function app_private.request_ai_evidence_followup(p_interpretation_request_id uuid,p_question text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  caller_id uuid:=auth.uid(); target public.ai_interpretation_requests%rowtype; normalized_question text:=trim(p_question);
  question_hash text; current_evidence_hash text; existing_id uuid; request_id uuid; queue_id bigint;
  user_active integer; org_active integer;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if normalized_question is null or char_length(normalized_question)<1 or char_length(normalized_question)>4000 then
    raise exception 'follow-up question must be between 1 and 4000 characters';
  end if;
  select * into target from public.ai_interpretation_requests where id=p_interpretation_request_id and requested_by=caller_id;
  if not found then raise exception 'AI interpretation not found' using errcode='P0002'; end if;
  if target.status<>'completed' or target.interpretation is null then raise exception 'AI interpretation is not completed'; end if;
  if not app_private.can_write_org(target.organization_id) then raise exception 'project write access denied' using errcode='42501'; end if;
  current_evidence_hash:=encode(extensions.digest(convert_to(target.evidence_snapshot::text,'UTF8'),'sha256'),'hex');
  if current_evidence_hash<>target.evidence_sha256 then raise exception 'AI interpretation evidence integrity check failed'; end if;
  question_hash:=encode(extensions.digest(convert_to(normalized_question,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target.id::text || '|' || question_hash,29171));
  select id into existing_id from public.ai_evidence_followup_requests
    where interpretation_request_id=target.id and question_sha256=question_hash and evidence_sha256=target.evidence_sha256
      and status in ('queued','answering','completed') order by created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;
  perform app_private.consume_scientific_rate_limit('ai_evidence_followup',caller_id,target.organization_id);
  select count(*) into user_active from public.ai_evidence_followup_requests where requested_by=caller_id and status in ('queued','answering');
  select count(*) into org_active from public.ai_evidence_followup_requests where organization_id=target.organization_id and status in ('queued','answering');
  if user_active>=3 or org_active>=15 then
    raise sqlstate 'PGRST' using message=jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active evidence follow-up requests.')::text,detail=jsonb_build_object('status',429)::text;
  end if;
  insert into public.ai_evidence_followup_requests(
    interpretation_request_id,conversation_id,organization_id,project_id,requested_by,question,question_sha256,evidence_schema_version,evidence_snapshot,evidence_sha256
  ) values (
    target.id,target.conversation_id,target.organization_id,target.project_id,caller_id,normalized_question,question_hash,target.evidence_schema_version,target.evidence_snapshot,target.evidence_sha256
  ) returning id into request_id;
  select pgmq.send(queue_name=>'ai_evidence_followup',msg=>jsonb_build_object('followup_request_id',request_id)) into queue_id;
  if queue_id is null then raise exception 'failed to enqueue evidence follow-up request'; end if;
  return request_id;
end;$$;

create or replace function public.request_ai_evidence_followup(interpretation_request_id uuid,question text)
returns uuid language sql security invoker set search_path='' as $$ select app_private.request_ai_evidence_followup(interpretation_request_id,question); $$;
revoke all on function app_private.request_ai_evidence_followup(uuid,text) from public,anon,authenticated,service_role;
grant execute on function app_private.request_ai_evidence_followup(uuid,text) to authenticated;
revoke all on function public.request_ai_evidence_followup(uuid,text) from public,anon,service_role;
grant execute on function public.request_ai_evidence_followup(uuid,text) to authenticated;

create or replace function app_private.claim_ai_evidence_followup_request(p_visibility_seconds integer default 300)
returns table(message_id bigint,followup_request_id uuid,question text,evidence_snapshot jsonb,evidence_sha256 text)
language plpgsql security definer set search_path='' as $$
declare
  q record; target public.ai_evidence_followup_requests%rowtype; target_id uuid; current_evidence_hash text; current_question_hash text;
begin
  if p_visibility_seconds<60 or p_visibility_seconds>900 then raise exception 'visibility timeout must be between 60 and 900 seconds'; end if;
  select * into q from pgmq.read(queue_name=>'ai_evidence_followup',vt=>p_visibility_seconds,qty=>1) limit 1;
  if not found then return; end if;
  begin target_id:=(q.message->>'followup_request_id')::uuid; exception when others then perform pgmq.delete('ai_evidence_followup',q.msg_id); return; end;
  select * into target from public.ai_evidence_followup_requests where id=target_id for update;
  if not found or target.status<>'queued' then perform pgmq.delete('ai_evidence_followup',q.msg_id); return; end if;
  current_evidence_hash:=encode(extensions.digest(convert_to(target.evidence_snapshot::text,'UTF8'),'sha256'),'hex');
  current_question_hash:=encode(extensions.digest(convert_to(target.question,'UTF8'),'sha256'),'hex');
  if current_evidence_hash<>target.evidence_sha256 or current_question_hash<>target.question_sha256 then
    update public.ai_evidence_followup_requests set status='error',processing_error='Follow-up immutable input integrity check failed.',processing_finished_at=now(),updated_at=now() where id=target.id;
    perform pgmq.delete('ai_evidence_followup',q.msg_id); return;
  end if;
  update public.ai_evidence_followup_requests set status='answering',processing_attempts=processing_attempts+1,processing_started_at=coalesce(processing_started_at,now()),processing_error=null,updated_at=now()
    where id=target.id returning * into target;
  return query select q.msg_id::bigint,target.id,target.question,target.evidence_snapshot,target.evidence_sha256;
end;$$;

create or replace function public.claim_ai_evidence_followup_request(visibility_seconds integer default 300)
returns table(message_id bigint,followup_request_id uuid,question text,evidence_snapshot jsonb,evidence_sha256 text)
language sql security invoker set search_path='' as $$ select * from app_private.claim_ai_evidence_followup_request(visibility_seconds); $$;
revoke all on function app_private.claim_ai_evidence_followup_request(integer) from public,anon,authenticated;
grant execute on function app_private.claim_ai_evidence_followup_request(integer) to service_role;
revoke all on function public.claim_ai_evidence_followup_request(integer) from public,anon,authenticated;
grant execute on function public.claim_ai_evidence_followup_request(integer) to service_role;

create or replace function app_private.validate_ai_evidence_followup(p_request public.ai_evidence_followup_requests,p_answer jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  status_value text; direct_answer jsonb; point jsonb; limitation jsonb; evidence_id jsonb; known_ids text[];
  top_key_count integer; direct_key_count integer; point_key_count integer;
begin
  if p_answer is null or jsonb_typeof(p_answer)<>'object' then raise exception 'AI follow-up answer must be an object'; end if;
  select count(*) into top_key_count from jsonb_object_keys(p_answer);
  if top_key_count<>5 or not (p_answer ?& array['schema_version','status','direct_answer','supporting_points','limitations']) then raise exception 'AI follow-up answer fields are invalid'; end if;
  if p_answer->>'schema_version'<>'ai-evidence-answer-v1' then raise exception 'AI follow-up schema is invalid'; end if;
  status_value:=p_answer->>'status';
  if status_value not in ('answered','insufficient_evidence') then raise exception 'AI follow-up status is invalid'; end if;
  if jsonb_typeof(p_request.evidence_snapshot->'facts')<>'array' or jsonb_array_length(p_request.evidence_snapshot->'facts')<1 then raise exception 'AI follow-up evidence snapshot is invalid'; end if;
  select array_agg(f->>'id') into known_ids from jsonb_array_elements(p_request.evidence_snapshot->'facts') f;
  if known_ids is null then raise exception 'AI follow-up evidence identifiers are invalid'; end if;

  direct_answer:=p_answer->'direct_answer';
  if jsonb_typeof(direct_answer)<>'object' then raise exception 'AI follow-up direct answer is invalid'; end if;
  select count(*) into direct_key_count from jsonb_object_keys(direct_answer);
  if direct_key_count<>2 or not (direct_answer ?& array['statement','evidence_ids']) then raise exception 'AI follow-up direct answer fields are invalid'; end if;
  if char_length(coalesce(direct_answer->>'statement',''))<1 or char_length(direct_answer->>'statement')>1200 then raise exception 'AI follow-up direct answer text is invalid'; end if;
  if jsonb_typeof(direct_answer->'evidence_ids')<>'array' or jsonb_array_length(direct_answer->'evidence_ids')>6 then raise exception 'AI follow-up direct evidence references are invalid'; end if;
  if (select count(*) from jsonb_array_elements_text(direct_answer->'evidence_ids'))<>(select count(distinct value) from jsonb_array_elements_text(direct_answer->'evidence_ids')) then raise exception 'AI follow-up direct evidence references must be unique'; end if;
  for evidence_id in select value from jsonb_array_elements(direct_answer->'evidence_ids') loop
    if jsonb_typeof(evidence_id)<>'string' or not ((evidence_id #>> '{}')=any(known_ids)) then raise exception 'AI follow-up references unknown evidence'; end if;
  end loop;

  if jsonb_typeof(p_answer->'supporting_points')<>'array' or jsonb_array_length(p_answer->'supporting_points')>6 then raise exception 'AI follow-up supporting points are invalid'; end if;
  for point in select value from jsonb_array_elements(p_answer->'supporting_points') loop
    if jsonb_typeof(point)<>'object' then raise exception 'AI follow-up supporting point is invalid'; end if;
    select count(*) into point_key_count from jsonb_object_keys(point);
    if point_key_count<>2 or not (point ?& array['statement','evidence_ids']) then raise exception 'AI follow-up supporting point fields are invalid'; end if;
    if char_length(coalesce(point->>'statement',''))<1 or char_length(point->>'statement')>1200 then raise exception 'AI follow-up supporting point text is invalid'; end if;
    if jsonb_typeof(point->'evidence_ids')<>'array' or jsonb_array_length(point->'evidence_ids') not between 1 and 6 then raise exception 'AI follow-up supporting evidence references are invalid'; end if;
    if (select count(*) from jsonb_array_elements_text(point->'evidence_ids'))<>(select count(distinct value) from jsonb_array_elements_text(point->'evidence_ids')) then raise exception 'AI follow-up supporting evidence references must be unique'; end if;
    for evidence_id in select value from jsonb_array_elements(point->'evidence_ids') loop
      if jsonb_typeof(evidence_id)<>'string' or not ((evidence_id #>> '{}')=any(known_ids)) then raise exception 'AI follow-up references unknown evidence'; end if;
    end loop;
  end loop;

  if jsonb_typeof(p_answer->'limitations')<>'array' or jsonb_array_length(p_answer->'limitations')>8 then raise exception 'AI follow-up limitations are invalid'; end if;
  for limitation in select value from jsonb_array_elements(p_answer->'limitations') loop
    if jsonb_typeof(limitation)<>'string' or char_length(limitation #>> '{}')<1 or char_length(limitation #>> '{}')>500 then raise exception 'AI follow-up limitation is invalid'; end if;
  end loop;
  if status_value='answered' then
    if jsonb_array_length(direct_answer->'evidence_ids')<1 then raise exception 'answered AI follow-up requires evidence'; end if;
  else
    if jsonb_array_length(direct_answer->'evidence_ids')<>0 or jsonb_array_length(p_answer->'supporting_points')<>0 or jsonb_array_length(p_answer->'limitations')<1 then raise exception 'insufficient-evidence AI follow-up shape is invalid'; end if;
  end if;
end;$$;
revoke all on function app_private.validate_ai_evidence_followup(public.ai_evidence_followup_requests,jsonb) from public,anon,authenticated,service_role;

create or replace function app_private.finish_ai_evidence_followup_success(p_message_id bigint,p_followup_request_id uuid,p_provider text,p_model text,p_prompt_version text,p_policy_version text,p_answer jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare target public.ai_evidence_followup_requests%rowtype; answer_hash text;
begin
  select * into target from public.ai_evidence_followup_requests where id=p_followup_request_id for update;
  if not found or target.status<>'answering' then raise exception 'AI evidence follow-up request is not active' using errcode='P0002'; end if;
  if trim(p_provider) !~ '^[a-z0-9_-]{2,64}$' or nullif(trim(p_model),'') is null or char_length(trim(p_model))>128 or nullif(trim(p_prompt_version),'') is null or char_length(trim(p_prompt_version))>128 or p_policy_version<>'ai-evidence-followup-policy-v1' then raise exception 'AI evidence follow-up provenance is invalid'; end if;
  perform app_private.validate_ai_evidence_followup(target,p_answer);
  if octet_length(p_answer::text)>32768 then raise exception 'AI evidence follow-up answer exceeds size limit'; end if;
  answer_hash:=encode(extensions.digest(convert_to(p_answer::text,'UTF8'),'sha256'),'hex');
  update public.ai_evidence_followup_requests set status='completed',provider=trim(p_provider),model=trim(p_model),prompt_version=trim(p_prompt_version),policy_version=p_policy_version,
    answer_schema_version='ai-evidence-answer-v1',answer=p_answer,answer_sha256=answer_hash,processing_finished_at=now(),processing_error=null,updated_at=now() where id=target.id;
  if not pgmq.delete('ai_evidence_followup',p_message_id) then raise exception 'AI evidence follow-up queue message delete failed'; end if;
end;$$;

create or replace function public.finish_ai_evidence_followup_success(message_id bigint,followup_request_id uuid,provider text,model text,prompt_version text,policy_version text,answer jsonb)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_ai_evidence_followup_success(message_id,followup_request_id,provider,model,prompt_version,policy_version,answer); $$;
revoke all on function app_private.finish_ai_evidence_followup_success(bigint,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.finish_ai_evidence_followup_success(bigint,uuid,text,text,text,text,jsonb) to service_role;
revoke all on function public.finish_ai_evidence_followup_success(bigint,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_ai_evidence_followup_success(bigint,uuid,text,text,text,text,jsonb) to service_role;

create or replace function app_private.finish_ai_evidence_followup_error(p_message_id bigint,p_followup_request_id uuid,p_processing_error text,p_retryable boolean default true,p_max_attempts integer default 3)
returns text language plpgsql security definer set search_path='' as $$
declare target public.ai_evidence_followup_requests%rowtype; retry_id bigint; safe_error text:=left(coalesce(nullif(trim(p_processing_error),''),'AI evidence follow-up failed.'),2000);
begin
  if p_max_attempts<1 or p_max_attempts>5 then raise exception 'invalid AI evidence follow-up max attempts'; end if;
  select * into target from public.ai_evidence_followup_requests where id=p_followup_request_id for update;
  if not found then perform pgmq.delete('ai_evidence_followup',p_message_id); return 'discarded'; end if;
  if target.status<>'answering' then perform pgmq.delete('ai_evidence_followup',p_message_id); return 'discarded'; end if;
  if p_retryable and target.processing_attempts<p_max_attempts then
    update public.ai_evidence_followup_requests set status='queued',processing_error=safe_error,updated_at=now() where id=target.id;
    if not pgmq.delete('ai_evidence_followup',p_message_id) then raise exception 'AI evidence follow-up queue delete failed'; end if;
    select pgmq.send(queue_name=>'ai_evidence_followup',msg=>jsonb_build_object('followup_request_id',target.id),delay=>15) into retry_id;
    if retry_id is null then raise exception 'AI evidence follow-up retry enqueue failed'; end if;
    return 'retry';
  end if;
  update public.ai_evidence_followup_requests set status='error',processing_error=safe_error,processing_finished_at=now(),updated_at=now() where id=target.id;
  perform pgmq.delete('ai_evidence_followup',p_message_id); return 'error';
end;$$;

create or replace function public.finish_ai_evidence_followup_error(message_id bigint,followup_request_id uuid,processing_error text,retryable boolean default true,max_attempts integer default 3)
returns text language sql security invoker set search_path='' as $$ select app_private.finish_ai_evidence_followup_error(message_id,followup_request_id,processing_error,retryable,max_attempts); $$;
revoke all on function app_private.finish_ai_evidence_followup_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function app_private.finish_ai_evidence_followup_error(bigint,uuid,text,boolean,integer) to service_role;
revoke all on function public.finish_ai_evidence_followup_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.finish_ai_evidence_followup_error(bigint,uuid,text,boolean,integer) to service_role;

create or replace function app_private.audit_ai_evidence_followup_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_name text; event_outcome text;
begin
  if tg_op='INSERT' then event_name:='AI_EVIDENCE_FOLLOWUP_REQUEST_CREATED'; event_outcome:='created';
  elsif new.status is distinct from old.status then event_name:='AI_EVIDENCE_FOLLOWUP_STATUS_CHANGED'; event_outcome:=case when new.status='error' then 'failed' when new.status='completed' then 'completed' else 'state_change' end;
  else return new; end if;
  perform app_private.append_audit_event(new.organization_id,new.project_id,new.requested_by,case when auth.uid() is null then 'service' else 'user' end,
    event_name,'ai_evidence_followup_request',new.id::text,event_outcome,
    jsonb_strip_nulls(jsonb_build_object('status',new.status,'previous_status',case when tg_op='UPDATE' then old.status else null end,
      'interpretation_request_id',new.interpretation_request_id,'question_sha256',new.question_sha256,'evidence_sha256',new.evidence_sha256,
      'answer_sha256',new.answer_sha256,'provider',new.provider,'model',new.model,'prompt_version',new.prompt_version,'policy_version',new.policy_version)));
  return new;
end;$$;
create trigger ai_evidence_followup_audit_events after insert or update on public.ai_evidence_followup_requests
for each row execute function app_private.audit_ai_evidence_followup_change();
revoke all on function app_private.audit_ai_evidence_followup_change() from public,anon,authenticated,service_role;
