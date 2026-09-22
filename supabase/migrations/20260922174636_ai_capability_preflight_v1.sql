-- Add deterministic capability-aware AI preflight and enforce worker-compatible scientific plans.

CREATE OR REPLACE FUNCTION app_private.ai_capability_preflight(p_project_id uuid, p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
with seq as (
  select
    u.id,u.original_filename,u.status,u.sequence_type,u.sequence_count,u.residue_count,
    u.file_size_bytes,u.sha256,u.validation_warnings,
    exists(
      select 1 from public.sequence_retrievals r
      where r.sequence_upload_id=u.id
        and r.project_id=p_project_id
        and r.organization_id=p_organization_id
        and r.source_provider='ncbi'
        and r.source_database='protein'
        and r.status='retrieved'
        and r.resolved_accession is not null
    ) as ncbi_protein_origin
  from public.sequence_uploads u
  where u.project_id=p_project_id and u.organization_id=p_organization_id
  order by u.created_at desc
  limit 100
),
annotated as (
  select jsonb_build_object(
    'id',id,
    'filename',left(original_filename,255),
    'status',status,
    'sequence_type',sequence_type,
    'sequence_count',sequence_count,
    'residue_count',residue_count,
    'blastn_ready', status='ready' and sha256 is not null and sequence_count=1 and sequence_type in ('dna','rna') and residue_count between 30 and 20000,
    'blastp_ready', status='ready' and sha256 is not null and sequence_count=1 and sequence_type='protein' and residue_count between 10 and 20000,
    'pairwise_ready', status='ready' and sha256 is not null and sequence_count=1 and sequence_type in ('dna','rna','protein')
      and residue_count between 1 and 10000 and file_size_bytes between 1 and 2097152
      and not (coalesce(validation_warnings,'[]'::jsonb) ? 'gap_characters_present'),
    'msa_ready', status='ready' and sha256 is not null and sequence_count=1 and sequence_type in ('dna','rna','protein')
      and residue_count between 1 and 20000 and file_size_bytes between 1 and 2097152
      and not (coalesce(validation_warnings,'[]'::jsonb) ? 'gap_characters_present'),
    'protein_properties_ready', status='ready' and sha256 is not null and sequence_count=1 and sequence_type='protein'
      and residue_count between 1 and 200000 and file_size_bytes between 1 and 2097152
      and not (coalesce(validation_warnings,'[]'::jsonb) ? 'gap_characters_present'),
    'protein_annotation_ready', status='ready' and sha256 is not null and sequence_count=1 and sequence_type='protein'
      and residue_count between 1 and 200000 and file_size_bytes between 1 and 2097152 and ncbi_protein_origin
  ) as item
  from seq
),
completed_msa as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,
    'status',s.status,
    'result_sha256',s.result_sha256,
    'result_summary',s.result_summary
  ) order by s.created_at desc),'[]'::jsonb) as items
  from public.scientific_jobs s
  where s.project_id=p_project_id
    and s.organization_id=p_organization_id
    and s.job_type='multiple_sequence_alignment'
    and s.status='completed'
    and s.result_sha256 is not null
)
select jsonb_build_object(
  'supported_tasks',jsonb_build_array(
    jsonb_build_object('task','ncbi_sequence_retrieval','need','explicit nucleotide or protein accession'),
    jsonb_build_object('task','blast','need','one compatible ready single-record sequence'),
    jsonb_build_object('task','pairwise_alignment','need','two distinct compatible ready single-record sequences of the same type'),
    jsonb_build_object('task','multiple_sequence_alignment','need','3-50 compatible ready ungapped single-record sequences of the same type, within V1 compute limits'),
    jsonb_build_object('task','phylogenetic_tree','need','one completed MSA result'),
    jsonb_build_object('task','protein_properties','need','one compatible ready protein sequence'),
    jsonb_build_object('task','protein_annotation','need','one compatible ready protein sequence originating from a successful NCBI protein retrieval'),
    jsonb_build_object('task','msa_phylogeny_workflow','need','3-50 compatible ready ungapped single-record sequences of the same type, within V1 compute limits')
  ),
  'sequences',coalesce((select jsonb_agg(item) from annotated),'[]'::jsonb),
  'completed_msa_jobs',(select items from completed_msa)
);
$function$
;

revoke all on function app_private.ai_capability_preflight(uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION app_private.validate_ai_plan_for_request_v3(p_request ai_plan_requests, p_plan jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  action text;
  params jsonb;
  ids uuid[];
  expected integer;
  bad integer;
  type_count integer;
  total_residues bigint;
begin
  action := app_private.validate_ai_plan_for_request_v2(p_request,p_plan);
  if action is null then return null; end if;
  params := p_plan->'action'->'parameters';

  if action='blast' then
    if not exists(
      select 1 from public.sequence_uploads u
      where u.id=(params->>'query_upload_id')::uuid
        and u.project_id=p_request.project_id
        and u.organization_id=p_request.organization_id
        and u.status='ready'
        and u.sha256 is not null
        and u.sequence_count=1
        and u.residue_count between 10 and 20000
        and (
          (params->>'program'='blastn' and u.sequence_type in ('dna','rna') and u.residue_count>=30)
          or
          (params->>'program'='blastp' and u.sequence_type='protein')
        )
    ) then raise exception 'AI BLAST input is not compatible with the requested program'; end if;

  elsif action='pairwise_alignment' then
    ids := array[(params->>'sequence_a_id')::uuid,(params->>'sequence_b_id')::uuid];
    select count(*) filter (
      where u.status<>'ready' or u.sha256 is null or u.sequence_count<>1
        or u.sequence_type not in ('dna','rna','protein')
        or u.residue_count is null or u.residue_count<1 or u.residue_count>10000
        or u.file_size_bytes<1 or u.file_size_bytes>2097152
        or coalesce(u.validation_warnings,'[]'::jsonb) ? 'gap_characters_present'
    ), count(distinct u.sequence_type)
    into bad,type_count
    from public.sequence_uploads u
    where u.id=any(ids) and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id;
    if bad<>0 or type_count<>1 then
      raise exception 'AI pairwise inputs are not mutually compatible for execution';
    end if;

  elsif action in ('multiple_sequence_alignment','msa_phylogeny_workflow') then
    select array_agg(value::uuid) into ids
    from jsonb_array_elements_text(params->'sequence_upload_ids');
    expected := coalesce(array_length(ids,1),0);
    select
      count(*) filter (
        where u.status<>'ready' or u.sha256 is null or u.sequence_count<>1
          or u.sequence_type not in ('dna','rna','protein')
          or u.residue_count is null or u.residue_count<1 or u.residue_count>20000
          or u.file_size_bytes<1 or u.file_size_bytes>2097152
          or coalesce(u.validation_warnings,'[]'::jsonb) ? 'gap_characters_present'
      ),
      count(distinct u.sequence_type),
      coalesce(sum(u.residue_count),0)
    into bad,type_count,total_residues
    from public.sequence_uploads u
    where u.id=any(ids) and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id;
    if expected<3 or expected>50 or bad<>0 or type_count<>1 or total_residues>100000 then
      raise exception 'AI MSA inputs are not mutually compatible or exceed V1 compute limits';
    end if;

  elsif action='protein_properties' then
    if not exists(
      select 1 from public.sequence_uploads u
      where u.id=(params->>'sequence_upload_id')::uuid
        and u.project_id=p_request.project_id
        and u.organization_id=p_request.organization_id
        and u.status='ready' and u.sha256 is not null and u.sequence_count=1
        and u.sequence_type='protein' and u.residue_count between 1 and 200000
        and u.file_size_bytes between 1 and 2097152
        and not (coalesce(u.validation_warnings,'[]'::jsonb) ? 'gap_characters_present')
    ) then raise exception 'AI protein properties input is not executable'; end if;

  elsif action='protein_annotation' then
    if not exists(
      select 1
      from public.sequence_uploads u
      join public.sequence_retrievals r on r.sequence_upload_id=u.id
      where u.id=(params->>'sequence_upload_id')::uuid
        and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id
        and u.status='ready' and u.sha256 is not null and u.sequence_count=1
        and u.sequence_type='protein' and u.residue_count between 1 and 200000
        and u.file_size_bytes between 1 and 2097152
        and r.source_provider='ncbi' and r.source_database='protein'
        and r.status='retrieved' and r.resolved_accession is not null
    ) then raise exception 'AI protein annotation input is not executable'; end if;
  end if;

  return action;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'AI plan contains an invalid typed parameter';
end;
$function$
;

revoke all on function app_private.validate_ai_plan_for_request_v3(public.ai_plan_requests,jsonb) from public,anon,authenticated,service_role;

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

  context := context || jsonb_build_object(
    'capability_preflight', app_private.ai_capability_preflight(p_project_id,org_id)
  );

  return query select convo.id,message_id,
    case when normalized_message='' then 'Attached biological data for analysis.' else normalized_message end,
    context;
end;
$function$
;

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

  select app_private.validate_ai_plan_for_request_v3(r,p_plan)
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
;

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

  action := app_private.validate_ai_plan_for_request_v3(target,target.plan);
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
$function$
;