-- AI sequence intelligence dispatch: preserve existing plans, bound inputs and actor.
-- Apply only after scientific-worker 0.5.0 and the sequence intelligence schema.
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
      and residue_count between 1 and 200000 and file_size_bytes between 1 and 2097152 and ncbi_protein_origin,
    'sequence_insights_ready', status='ready' and sha256 ~ '^[0-9a-f]{64}$'
      and sequence_count=1 and sequence_type in ('dna','rna')
      and residue_count between 1 and 50000 and file_size_bytes between 1 and 2097152
      and not (coalesce(validation_warnings,'[]'::jsonb) ? 'gap_characters_present')
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
    jsonb_build_object('task','msa_phylogeny_workflow','need','3-50 compatible ready ungapped single-record sequences of the same type, within V1 compute limits'),
    jsonb_build_object('task','sequence_insights','need','one ready ungapped DNA/RNA FASTA up to 50000 bases, with an approved sequence operation')
  ),
  'sequences',coalesce((select jsonb_agg(item) from annotated),'[]'::jsonb),
  'completed_msa_jobs',(select items from completed_msa)
);
$function$
;

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

  if p_plan->>'intent'='scientific_action' and action='sequence_insights' then
    if p_plan is null or jsonb_typeof(p_plan)<>'object'
      or not app_private.jsonb_has_exact_keys(p_plan,array['schema_version','intent','summary','limitations','action'])
      or p_plan->>'schema_version' is distinct from 'ai-plan-v1'
      or char_length(coalesce(p_plan->>'summary','')) not between 1 and 2000
      or jsonb_typeof(p_plan->'limitations')<>'array'
      or jsonb_array_length(p_plan->'limitations')>10
      or not app_private.jsonb_has_exact_keys(p_plan->'action',array['type','parameters'])
      or jsonb_typeof(p_plan->'action'->'parameters')<>'object' then
      raise exception 'AI sequence intelligence plan shape is invalid';
    end if;
    for limitation in select value from jsonb_array_elements(p_plan->'limitations') loop
      if jsonb_typeof(limitation)<>'string' or char_length(limitation#>>'{}') not between 1 and 500 then
        raise exception 'AI sequence intelligence limitation is invalid';
      end if;
    end loop;
    params := p_plan->'action'->'parameters';
    if not app_private.jsonb_has_exact_keys(params,array['sequence_upload_id','operation','motif','min_aa'])
      or jsonb_typeof(params->'sequence_upload_id')<>'string'
      or coalesce(params->>'sequence_upload_id','') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or jsonb_typeof(params->'operation')<>'string'
      or params->>'operation' not in ('orf_scan','six_frame_translation','motif_scan','reverse_complement')
      or jsonb_typeof(params->'min_aa')<>'number'
      or coalesce(params->>'min_aa','') !~ '^[1-9][0-9]{0,3}$' then
      raise exception 'AI sequence intelligence parameters are invalid';
    end if;
    if (params->>'min_aa')::integer not between 1 and 1000 then
      raise exception 'AI sequence intelligence ORF minimum is invalid';
    end if;
    if params->>'operation'='motif_scan' then
      if jsonb_typeof(params->'motif')<>'string'
        or coalesce(params->>'motif','') !~ '^[ACGTRYSWKMBDHVNU]{2,32}$'
        or (params->>'min_aa')::integer<>30 then
        raise exception 'AI motif scan parameters are invalid';
      end if;
    elsif params->'motif' is distinct from 'null'::jsonb
      or (params->>'operation'<>'orf_scan' and (params->>'min_aa')::integer<>30) then
      raise exception 'AI sequence intelligence operation parameters are incompatible';
    end if;
    if not exists (
      select 1 from public.sequence_uploads u
      where u.id=(params->>'sequence_upload_id')::uuid
        and u.project_id=p_request.project_id and u.organization_id=p_request.organization_id
        and u.status='ready' and u.sequence_type in ('dna','rna')
        and u.sequence_count=1 and u.sha256 ~ '^[0-9a-f]{64}$'
        and u.residue_count between 1 and 50000 and u.file_size_bytes between 1 and 2097152
        and not (coalesce(u.validation_warnings,'[]'::jsonb) ? 'gap_characters_present')
    ) then
      raise exception 'AI sequence intelligence input is not authorized or executable';
    end if;
    if not exists (
      select 1 from jsonb_array_elements(
        app_private.ai_capability_preflight(p_request.project_id,p_request.organization_id)->'sequences'
      ) as authorized_input(value)
      where authorized_input.value->>'id'=params->>'sequence_upload_id'
        and authorized_input.value->>'sequence_insights_ready'='true'
    ) then
      raise exception 'AI sequence input was not present in the authorized planning context';
    end if;
    return action;
  end if;

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

  perform set_config('request.jwt.claim.sub',p_expected_user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

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
  elsif action='sequence_insights' then
    result_id := app_private.request_sequence_insights(
      target.project_id,(params->>'sequence_upload_id')::uuid,
      params->>'operation',params->>'motif',(params->>'min_aa')::integer
    );
    r_type := 'scientific_job';
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

revoke all on function app_private.ai_capability_preflight(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function app_private.validate_ai_plan_for_request_v2(public.ai_plan_requests,jsonb) from public,anon,authenticated,service_role;
revoke all on function app_private.dispatch_ai_plan_service(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.dispatch_ai_plan_service(uuid,uuid) to service_role;
