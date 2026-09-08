select pgmq.create('ai_interpretation');

alter table public.ai_messages drop constraint ai_messages_kind;
alter table public.ai_messages add constraint ai_messages_kind
  check (message_kind in ('text','plan_summary','execution_status','interpretation_summary'));

create table public.ai_interpretation_requests (
  id uuid primary key default gen_random_uuid(),
  plan_request_id uuid not null unique references public.ai_plan_requests(id) on delete cascade,
  conversation_id uuid not null,
  organization_id uuid not null,
  project_id uuid not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  resource_type text not null,
  resource_id uuid not null,
  evidence_schema_version text not null default 'ai-evidence-v1',
  evidence_snapshot jsonb not null,
  evidence_sha256 text not null,
  status text not null default 'queued',
  provider text,
  model text,
  prompt_version text,
  policy_version text not null default 'ai-interpretation-policy-v1',
  interpretation_schema_version text,
  interpretation jsonb,
  interpretation_sha256 text,
  processing_attempts integer not null default 0,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_interpretation_requests_conversation_fkey
    foreign key (conversation_id,project_id,organization_id,requested_by)
    references public.ai_conversations(id,project_id,organization_id,created_by) on delete cascade,
  constraint ai_interpretation_requests_resource_type
    check (resource_type in ('scientific_job','protein_annotation_job','sequence_retrieval','blast_job')),
  constraint ai_interpretation_requests_evidence_schema check (evidence_schema_version='ai-evidence-v1'),
  constraint ai_interpretation_requests_evidence_object check (jsonb_typeof(evidence_snapshot)='object'),
  constraint ai_interpretation_requests_evidence_size check (octet_length(evidence_snapshot::text)<=65536),
  constraint ai_interpretation_requests_evidence_sha check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_interpretation_requests_status check (status in ('queued','interpreting','completed','error')),
  constraint ai_interpretation_requests_provider check (provider is null or provider ~ '^[a-z0-9_-]{2,64}$'),
  constraint ai_interpretation_requests_model check (model is null or char_length(model) between 1 and 128),
  constraint ai_interpretation_requests_prompt_version check (prompt_version is null or char_length(prompt_version) between 1 and 128),
  constraint ai_interpretation_requests_policy check (policy_version='ai-interpretation-policy-v1'),
  constraint ai_interpretation_requests_result_schema check (interpretation_schema_version is null or interpretation_schema_version='ai-interpretation-v1'),
  constraint ai_interpretation_requests_result_object check (interpretation is null or jsonb_typeof(interpretation)='object'),
  constraint ai_interpretation_requests_result_sha check (interpretation_sha256 is null or interpretation_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ai_interpretation_requests_attempts check (processing_attempts>=0),
  constraint ai_interpretation_requests_error check (processing_error is null or char_length(processing_error)<=2000)
);

create index ai_interpretation_requests_owner_created_idx on public.ai_interpretation_requests(requested_by,created_at desc);
create index ai_interpretation_requests_conversation_created_idx on public.ai_interpretation_requests(conversation_id,created_at desc);
create index ai_interpretation_requests_status_idx on public.ai_interpretation_requests(status,created_at);

alter table public.ai_interpretation_requests enable row level security;
alter table public.ai_interpretation_requests force row level security;
create policy ai_interpretation_requests_select_owner on public.ai_interpretation_requests for select to authenticated
using ((select auth.uid())=requested_by and (select app_private.is_org_member(organization_id)));
revoke all on table public.ai_interpretation_requests from public,anon,authenticated,service_role;
grant select on table public.ai_interpretation_requests to authenticated;

insert into app_private.scientific_rate_limit_policies(action,window_seconds,user_limit,organization_limit)
values ('ai_interpretation',60,10,50)
on conflict (action) do update set window_seconds=excluded.window_seconds,user_limit=excluded.user_limit,organization_limit=excluded.organization_limit;

create or replace function app_private.ai_evidence_fact(p_id text,p_label text,p_value jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('id',p_id,'label',p_label,'value',p_value);
$$;
revoke all on function app_private.ai_evidence_fact(text,text,jsonb) from public,anon,authenticated,service_role;

create or replace function app_private.build_ai_execution_evidence(p_plan public.ai_plan_requests)
returns jsonb language plpgsql security definer set search_path='' as $$
declare evidence jsonb; top_hits jsonb;
begin
  if p_plan.status<>'dispatched' or p_plan.dispatched_resource_type is null or p_plan.dispatched_resource_id is null then
    raise exception 'AI plan has no dispatched execution resource';
  end if;

  if p_plan.dispatched_resource_type='scientific_job' then
    select jsonb_build_object(
      'schema_version','ai-evidence-v1','resource_type','scientific_job','resource_id',j.id,
      'facts',jsonb_build_array(
        app_private.ai_evidence_fact('status','Execution status',to_jsonb(j.status)),
        app_private.ai_evidence_fact('job_type','Scientific job type',to_jsonb(j.job_type)),
        app_private.ai_evidence_fact('tool','Authoritative tool',jsonb_build_object('id',j.tool_id,'version',j.tool_version,'executor_version',j.executor_version)),
        app_private.ai_evidence_fact('result_summary','Authoritative result summary',j.result_summary),
        app_private.ai_evidence_fact('result_sha256','Result SHA-256',to_jsonb(j.result_sha256)),
        app_private.ai_evidence_fact('completed_at','Processing finished at',to_jsonb(j.processing_finished_at))
      )
    ) into evidence
    from public.scientific_jobs j
    where j.id=p_plan.dispatched_resource_id and j.project_id=p_plan.project_id and j.organization_id=p_plan.organization_id and j.status='completed' and j.result_summary is not null and j.result_sha256 is not null;
  elsif p_plan.dispatched_resource_type='protein_annotation_job' then
    select jsonb_build_object(
      'schema_version','ai-evidence-v1','resource_type','protein_annotation_job','resource_id',a.id,
      'facts',jsonb_build_array(
        app_private.ai_evidence_fact('status','Annotation status',to_jsonb(a.status)),
        app_private.ai_evidence_fact('refseq_accession','RefSeq accession',to_jsonb(a.refseq_accession)),
        app_private.ai_evidence_fact('protein_identity','Recorded protein identity',jsonb_build_object('protein_name',a.protein_name,'gene_names',a.gene_names,'organism_name',a.organism_name)),
        app_private.ai_evidence_fact('uniprot','UniProt evidence',jsonb_build_object('accession',a.uniprot_accession,'entry_id',a.uniprot_entry_id,'reviewed',a.uniprot_reviewed,'release',a.uniprot_release,'release_date',a.uniprot_release_date)),
        app_private.ai_evidence_fact('annotation_summary','Authoritative annotation summary',a.annotation_summary),
        app_private.ai_evidence_fact('source_provenance','Source provenance',jsonb_build_object('freshness_policy',a.freshness_policy,'source_checked_at',a.source_checked_at,'connector_version',a.connector_version,'mapping_response_sha256',a.mapping_response_sha256,'uniprot_response_sha256',a.uniprot_response_sha256,'interpro_response_sha256',a.interpro_response_sha256,'pfam_response_sha256',a.pfam_response_sha256)),
        app_private.ai_evidence_fact('result_message','Result message',to_jsonb(a.result_message))
      )
    ) into evidence
    from public.protein_annotation_jobs a
    where a.id=p_plan.dispatched_resource_id and a.project_id=p_plan.project_id and a.organization_id=p_plan.organization_id and a.status in ('completed','no_mapping');
  elsif p_plan.dispatched_resource_type='sequence_retrieval' then
    select jsonb_build_object(
      'schema_version','ai-evidence-v1','resource_type','sequence_retrieval','resource_id',r.id,
      'facts',jsonb_build_array(
        app_private.ai_evidence_fact('status','Retrieval status',to_jsonb(r.status)),
        app_private.ai_evidence_fact('source','Source',jsonb_build_object('provider',r.source_provider,'database',r.source_database,'freshness_policy',r.freshness_policy)),
        app_private.ai_evidence_fact('accession','Accession identity',jsonb_build_object('requested',r.requested_accession,'resolved',r.resolved_accession)),
        app_private.ai_evidence_fact('record','NCBI record metadata',jsonb_build_object('title',r.record_title,'organism',r.organism,'reported_length',r.reported_length,'record_updated_date',r.record_updated_date)),
        app_private.ai_evidence_fact('source_provenance','Source provenance',jsonb_build_object('connector_version',r.connector_version,'source_checked_at',r.source_checked_at,'source_retrieved_at',r.source_retrieved_at,'source_response_sha256',r.source_response_sha256)),
        app_private.ai_evidence_fact('result_message','Result message',to_jsonb(r.result_message))
      )
    ) into evidence
    from public.sequence_retrievals r
    where r.id=p_plan.dispatched_resource_id and r.project_id=p_plan.project_id and r.organization_id=p_plan.organization_id and r.status in ('retrieved','not_found');
  elsif p_plan.dispatched_resource_type='blast_job' then
    select coalesce(jsonb_agg(value),'[]'::jsonb) into top_hits
    from (select value from public.blast_jobs b, lateral jsonb_array_elements(coalesce(b.normalized_hits,'[]'::jsonb)) value where b.id=p_plan.dispatched_resource_id limit 10) x;
    select jsonb_build_object(
      'schema_version','ai-evidence-v1','resource_type','blast_job','resource_id',b.id,
      'facts',jsonb_build_array(
        app_private.ai_evidence_fact('status','BLAST status',to_jsonb(b.status)),
        app_private.ai_evidence_fact('configuration','BLAST configuration',jsonb_build_object('program',b.program,'database_name',b.database_name,'expect_value',b.expect_value,'max_targets',b.max_targets,'low_complexity_filter',b.low_complexity_filter)),
        app_private.ai_evidence_fact('service','BLAST service provenance',jsonb_build_object('provider',b.service_provider,'mode',b.service_mode,'service_version',b.service_version,'blast_version',b.blast_version,'database_release',b.database_release)),
        app_private.ai_evidence_fact('result_summary','Authoritative result summary',b.result_summary),
        app_private.ai_evidence_fact('top_hits','First up to 10 normalized hits',top_hits),
        app_private.ai_evidence_fact('raw_result_sha256','Raw BLAST result SHA-256',to_jsonb(b.raw_result_sha256))
      )
    ) into evidence
    from public.blast_jobs b
    where b.id=p_plan.dispatched_resource_id and b.project_id=p_plan.project_id and b.organization_id=p_plan.organization_id and b.status='completed' and b.result_summary is not null and b.raw_result_sha256 is not null;
  else
    raise exception 'dispatched resource type is not interpretable';
  end if;

  if evidence is null then raise exception 'authoritative execution result is not ready for interpretation' using errcode='P0002'; end if;
  if octet_length(evidence::text)>65536 then raise exception 'authoritative evidence snapshot exceeds interpretation limit'; end if;
  return evidence;
end;$$;
revoke all on function app_private.build_ai_execution_evidence(public.ai_plan_requests) from public,anon,authenticated,service_role;

create or replace function app_private.request_ai_interpretation(p_plan_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller_id uuid:=auth.uid(); target public.ai_plan_requests%rowtype; existing_id uuid; request_id uuid; evidence jsonb; evidence_hash text; queue_id bigint; user_active integer; org_active integer;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into target from public.ai_plan_requests where id=p_plan_request_id and requested_by=caller_id;
  if not found then raise exception 'AI plan not found' using errcode='P0002'; end if;
  if target.status<>'dispatched' then raise exception 'AI plan has not been dispatched'; end if;
  if not app_private.can_write_org(target.organization_id) then raise exception 'project write access denied' using errcode='42501'; end if;
  select id into existing_id from public.ai_interpretation_requests where plan_request_id=target.id;
  if existing_id is not null then return existing_id; end if;
  perform app_private.consume_scientific_rate_limit('ai_interpretation',caller_id,target.organization_id);
  select count(*) into user_active from public.ai_interpretation_requests where requested_by=caller_id and status in ('queued','interpreting');
  select count(*) into org_active from public.ai_interpretation_requests where organization_id=target.organization_id and status in ('queued','interpreting');
  if user_active>=2 or org_active>=10 then raise sqlstate 'PGRST' using message=jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active AI interpretation requests.')::text,detail=jsonb_build_object('status',429)::text; end if;
  evidence:=app_private.build_ai_execution_evidence(target);
  evidence_hash:=encode(extensions.digest(convert_to(evidence::text,'UTF8'),'sha256'),'hex');
  insert into public.ai_interpretation_requests(plan_request_id,conversation_id,organization_id,project_id,requested_by,resource_type,resource_id,evidence_snapshot,evidence_sha256)
  values(target.id,target.conversation_id,target.organization_id,target.project_id,caller_id,target.dispatched_resource_type,target.dispatched_resource_id,evidence,evidence_hash)
  returning id into request_id;
  select pgmq.send(queue_name=>'ai_interpretation',msg=>jsonb_build_object('interpretation_request_id',request_id)) into queue_id;
  if queue_id is null then raise exception 'failed to enqueue AI interpretation request'; end if;
  return request_id;
end;$$;

create or replace function public.request_ai_interpretation(plan_request_id uuid)
returns uuid language sql security invoker set search_path='' as $$ select app_private.request_ai_interpretation(plan_request_id); $$;
revoke all on function app_private.request_ai_interpretation(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.request_ai_interpretation(uuid) to authenticated;
revoke all on function public.request_ai_interpretation(uuid) from public,anon,service_role;
grant execute on function public.request_ai_interpretation(uuid) to authenticated;

create or replace function app_private.claim_ai_interpretation_request(p_visibility_seconds integer default 300)
returns table(message_id bigint,interpretation_request_id uuid,evidence_snapshot jsonb,evidence_sha256 text)
language plpgsql security definer set search_path='' as $$
declare q record; target public.ai_interpretation_requests%rowtype; target_id uuid; current_hash text;
begin
  if p_visibility_seconds<60 or p_visibility_seconds>900 then raise exception 'visibility timeout must be between 60 and 900 seconds'; end if;
  select * into q from pgmq.read(queue_name=>'ai_interpretation',vt=>p_visibility_seconds,qty=>1) limit 1;
  if not found then return; end if;
  begin target_id:=(q.message->>'interpretation_request_id')::uuid; exception when others then perform pgmq.delete('ai_interpretation',q.msg_id); return; end;
  select * into target from public.ai_interpretation_requests where id=target_id for update;
  if not found or target.status<>'queued' then perform pgmq.delete('ai_interpretation',q.msg_id); return; end if;
  current_hash:=encode(extensions.digest(convert_to(target.evidence_snapshot::text,'UTF8'),'sha256'),'hex');
  if current_hash<>target.evidence_sha256 then
    update public.ai_interpretation_requests set status='error',processing_error='Evidence snapshot integrity check failed.',processing_finished_at=now(),updated_at=now() where id=target.id;
    perform pgmq.delete('ai_interpretation',q.msg_id); return;
  end if;
  update public.ai_interpretation_requests set status='interpreting',processing_attempts=processing_attempts+1,processing_started_at=coalesce(processing_started_at,now()),processing_error=null,updated_at=now() where id=target.id;
  return query select q.msg_id::bigint,target.id,target.evidence_snapshot,target.evidence_sha256;
end;$$;

create or replace function public.claim_ai_interpretation_request(visibility_seconds integer default 300)
returns table(message_id bigint,interpretation_request_id uuid,evidence_snapshot jsonb,evidence_sha256 text)
language sql security invoker set search_path='' as $$ select * from app_private.claim_ai_interpretation_request(visibility_seconds); $$;
revoke all on function app_private.claim_ai_interpretation_request(integer) from public,anon,authenticated;
grant execute on function app_private.claim_ai_interpretation_request(integer) to service_role;
revoke all on function public.claim_ai_interpretation_request(integer) from public,anon,authenticated;
grant execute on function public.claim_ai_interpretation_request(integer) to service_role;

create or replace function app_private.validate_ai_interpretation(p_request public.ai_interpretation_requests,p_interpretation jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare finding jsonb; evidence_id jsonb; known_ids text[];
begin
  if p_interpretation is null or jsonb_typeof(p_interpretation)<>'object' or p_interpretation->>'schema_version'<>'ai-interpretation-v1' then raise exception 'AI interpretation schema is invalid'; end if;
  if char_length(coalesce(p_interpretation->>'summary',''))<1 or char_length(p_interpretation->>'summary')>3000 then raise exception 'AI interpretation summary is invalid'; end if;
  if jsonb_typeof(p_interpretation->'findings')<>'array' or jsonb_array_length(p_interpretation->'findings') not between 1 and 8 then raise exception 'AI interpretation findings are invalid'; end if;
  if jsonb_typeof(p_interpretation->'limitations')<>'array' or jsonb_array_length(p_interpretation->'limitations')>8 then raise exception 'AI interpretation limitations are invalid'; end if;
  select array_agg(f->>'id') into known_ids from jsonb_array_elements(p_request.evidence_snapshot->'facts') f;
  for finding in select value from jsonb_array_elements(p_interpretation->'findings') loop
    if jsonb_typeof(finding)<>'object' or char_length(coalesce(finding->>'statement',''))<1 or char_length(finding->>'statement')>1000 or jsonb_typeof(finding->'evidence_ids')<>'array' or jsonb_array_length(finding->'evidence_ids') not between 1 and 6 then raise exception 'AI interpretation finding is invalid'; end if;
    for evidence_id in select value from jsonb_array_elements(finding->'evidence_ids') loop
      if jsonb_typeof(evidence_id)<>'string' or trim(both '"' from evidence_id::text)<>all(known_ids) then raise exception 'AI interpretation references unknown evidence'; end if;
    end loop;
  end loop;
end;$$;
revoke all on function app_private.validate_ai_interpretation(public.ai_interpretation_requests,jsonb) from public,anon,authenticated,service_role;

create or replace function app_private.finish_ai_interpretation_success(p_message_id bigint,p_interpretation_request_id uuid,p_provider text,p_model text,p_prompt_version text,p_policy_version text,p_interpretation jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare target public.ai_interpretation_requests%rowtype; interpretation_hash text; summary text;
begin
  select * into target from public.ai_interpretation_requests where id=p_interpretation_request_id for update;
  if not found or target.status<>'interpreting' then raise exception 'AI interpretation request is not active' using errcode='P0002'; end if;
  if trim(p_provider) !~ '^[a-z0-9_-]{2,64}$' or nullif(trim(p_model),'') is null or char_length(trim(p_model))>128 or nullif(trim(p_prompt_version),'') is null or char_length(trim(p_prompt_version))>128 or p_policy_version<>'ai-interpretation-policy-v1' then raise exception 'AI interpretation provenance is invalid'; end if;
  perform app_private.validate_ai_interpretation(target,p_interpretation);
  interpretation_hash:=encode(extensions.digest(convert_to(p_interpretation::text,'UTF8'),'sha256'),'hex'); summary:=left(p_interpretation->>'summary',3000);
  update public.ai_interpretation_requests set status='completed',provider=trim(p_provider),model=trim(p_model),prompt_version=trim(p_prompt_version),policy_version=p_policy_version,interpretation_schema_version='ai-interpretation-v1',interpretation=p_interpretation,interpretation_sha256=interpretation_hash,processing_finished_at=now(),processing_error=null,updated_at=now() where id=target.id;
  insert into public.ai_messages(conversation_id,organization_id,project_id,conversation_owner_id,role,content,message_kind,plan_request_id)
  values(target.conversation_id,target.organization_id,target.project_id,target.requested_by,'assistant',summary,'interpretation_summary',target.plan_request_id);
  if not pgmq.delete('ai_interpretation',p_message_id) then raise exception 'AI interpretation queue message delete failed'; end if;
end;$$;

create or replace function public.finish_ai_interpretation_success(message_id bigint,interpretation_request_id uuid,provider text,model text,prompt_version text,policy_version text,interpretation jsonb)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_ai_interpretation_success(message_id,interpretation_request_id,provider,model,prompt_version,policy_version,interpretation); $$;
revoke all on function app_private.finish_ai_interpretation_success(bigint,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.finish_ai_interpretation_success(bigint,uuid,text,text,text,text,jsonb) to service_role;
revoke all on function public.finish_ai_interpretation_success(bigint,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_ai_interpretation_success(bigint,uuid,text,text,text,text,jsonb) to service_role;

create or replace function app_private.finish_ai_interpretation_error(p_message_id bigint,p_interpretation_request_id uuid,p_processing_error text,p_retryable boolean default true,p_max_attempts integer default 3)
returns text language plpgsql security definer set search_path='' as $$
declare target public.ai_interpretation_requests%rowtype; new_id bigint; safe_error text:=left(coalesce(nullif(trim(p_processing_error),''),'AI interpretation failed.'),2000);
begin
  if p_max_attempts<1 or p_max_attempts>5 then raise exception 'invalid AI interpretation max attempts'; end if;
  select * into target from public.ai_interpretation_requests where id=p_interpretation_request_id for update;
  if not found then perform pgmq.delete('ai_interpretation',p_message_id); return 'discarded'; end if;
  if target.status<>'interpreting' then perform pgmq.delete('ai_interpretation',p_message_id); return 'discarded'; end if;
  if p_retryable and target.processing_attempts<p_max_attempts then
    update public.ai_interpretation_requests set status='queued',processing_error=safe_error,updated_at=now() where id=target.id;
    if not pgmq.delete('ai_interpretation',p_message_id) then raise exception 'AI interpretation queue delete failed'; end if;
    select pgmq.send(queue_name=>'ai_interpretation',msg=>jsonb_build_object('interpretation_request_id',target.id),delay=>15) into new_id;
    if new_id is null then raise exception 'AI interpretation retry enqueue failed'; end if;
    return 'retry';
  end if;
  update public.ai_interpretation_requests set status='error',processing_error=safe_error,processing_finished_at=now(),updated_at=now() where id=target.id;
  perform pgmq.delete('ai_interpretation',p_message_id);
  return 'error';
end;$$;

create or replace function public.finish_ai_interpretation_error(message_id bigint,interpretation_request_id uuid,processing_error text,retryable boolean default true,max_attempts integer default 3)
returns text language sql security invoker set search_path='' as $$ select app_private.finish_ai_interpretation_error(message_id,interpretation_request_id,processing_error,retryable,max_attempts); $$;
revoke all on function app_private.finish_ai_interpretation_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function app_private.finish_ai_interpretation_error(bigint,uuid,text,boolean,integer) to service_role;
revoke all on function public.finish_ai_interpretation_error(bigint,uuid,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.finish_ai_interpretation_error(bigint,uuid,text,boolean,integer) to service_role;

create or replace function app_private.audit_ai_interpretation_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare event_name text; event_outcome text;
begin
  if tg_op='INSERT' then event_name:='AI_INTERPRETATION_REQUEST_CREATED'; event_outcome:='created';
  elsif new.status is distinct from old.status then event_name:='AI_INTERPRETATION_STATUS_CHANGED'; event_outcome:=case when new.status='error' then 'failed' when new.status='completed' then 'completed' else 'state_change' end;
  else return new; end if;
  perform app_private.append_audit_event(new.organization_id,new.project_id,new.requested_by,case when auth.uid() is null then 'service' else 'user' end,event_name,'ai_interpretation_request',new.id::text,event_outcome,jsonb_strip_nulls(jsonb_build_object('status',new.status,'previous_status',case when tg_op='UPDATE' then old.status else null end,'plan_request_id',new.plan_request_id,'resource_type',new.resource_type,'resource_id',new.resource_id,'evidence_sha256',new.evidence_sha256,'interpretation_sha256',new.interpretation_sha256,'provider',new.provider,'model',new.model,'prompt_version',new.prompt_version,'policy_version',new.policy_version)));
  return new;
end;$$;
create trigger ai_interpretation_requests_audit_events after insert or update on public.ai_interpretation_requests for each row execute function app_private.audit_ai_interpretation_change();
revoke all on function app_private.audit_ai_interpretation_change() from public,anon,authenticated,service_role;
