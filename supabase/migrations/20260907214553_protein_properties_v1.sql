alter table public.scientific_jobs drop constraint if exists scientific_jobs_type;
alter table public.scientific_jobs
  add constraint scientific_jobs_type
  check (job_type in ('pairwise_alignment','multiple_sequence_alignment','phylogenetic_tree','protein_properties'));

insert into app_private.scientific_tools(
  tool_id, tool_version, display_name, category, runtime_kind, status,
  network_required, timeout_seconds, memory_mb, cpu_millicores, max_input_cells, parameter_schema
) values (
  'genithm-protein-properties','0.1.0','Genithm Deterministic Protein Properties','protein','isolated_worker','approved',
  false,60,256,500,200000,
  '{"alphabet":{"const":"canonical_20_amino_acids"},"mass_method":{"const":"average_residue_mass_plus_water"},"hydropathy_scale":{"const":"kyte_doolittle"},"charge_model":{"const":"henderson_hasselbalch_v1"}}'::jsonb
)
on conflict (tool_id,tool_version) do update set
  display_name=excluded.display_name, category=excluded.category, runtime_kind=excluded.runtime_kind,
  status=excluded.status, network_required=excluded.network_required, timeout_seconds=excluded.timeout_seconds,
  memory_mb=excluded.memory_mb, cpu_millicores=excluded.cpu_millicores,
  max_input_cells=excluded.max_input_cells, parameter_schema=excluded.parameter_schema;

insert into app_private.scientific_rate_limit_policies(action,window_seconds,user_limit,organization_limit)
values ('protein_properties',3600,30,120)
on conflict (action) do update set
  window_seconds=excluded.window_seconds,user_limit=excluded.user_limit,organization_limit=excluded.organization_limit;

create or replace function app_private.request_protein_properties(p_project_id uuid,p_sequence_upload_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  input public.sequence_uploads%rowtype;
  tool app_private.scientific_tools%rowtype;
  normalized_params jsonb := jsonb_build_object(
    'alphabet','canonical_20_amino_acids',
    'mass_method','average_residue_mass_plus_water',
    'hydropathy_scale','kyte_doolittle',
    'charge_model','henderson_hasselbalch_v1'
  );
  fingerprint text;
  existing_id uuid;
  new_id uuid;
  queue_message_id bigint;
  user_active integer;
  org_active integer;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  select organization_id into org_id from public.projects where id=p_project_id;
  if not found then raise exception 'project not found' using errcode='P0002'; end if;
  if not app_private.can_write_org(org_id) then raise exception 'project write access denied' using errcode='42501'; end if;

  select * into input from public.sequence_uploads
  where id=p_sequence_upload_id and project_id=p_project_id and organization_id=org_id;
  if not found then raise exception 'protein sequence not found' using errcode='P0002'; end if;
  if input.status <> 'ready' or input.sha256 is null or input.sequence_count <> 1 or input.sequence_type <> 'protein' then
    raise exception 'protein properties require one validated protein sequence';
  end if;
  if input.residue_count is null or input.residue_count < 1 or input.residue_count > 200000 then
    raise exception 'protein sequence exceeds V1 residue bounds';
  end if;
  if input.file_size_bytes < 1 or input.file_size_bytes > 2097152 then
    raise exception 'protein input file exceeds worker read limit';
  end if;
  if coalesce(input.validation_warnings,'[]'::jsonb) ? 'gap_characters_present' then
    raise exception 'protein properties require an ungapped sequence';
  end if;

  select * into tool from app_private.scientific_tools
  where tool_id='genithm-protein-properties' and tool_version='0.1.0' and status='approved';
  if not found then raise exception 'approved protein properties tool is unavailable'; end if;

  fingerprint := encode(extensions.digest(convert_to(concat_ws(E'\x1f',
    'protein_properties',p_project_id::text,input.id::text,input.sha256,tool.tool_id,tool.tool_version,normalized_params::text
  ),'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint,14321));

  select id into existing_id from public.scientific_jobs
  where organization_id=org_id and request_fingerprint=fingerprint
    and status in ('queued','running','validating_result')
  order by created_at desc limit 1;
  if existing_id is not null then return existing_id; end if;

  perform app_private.consume_scientific_rate_limit('protein_properties',caller_id,org_id);
  select count(*) into user_active from public.scientific_jobs
  where requested_by=caller_id and status in ('queued','running','validating_result');
  select count(*) into org_active from public.scientific_jobs
  where organization_id=org_id and status in ('queued','running','validating_result');
  if user_active >= 5 or org_active >= 25 then
    raise sqlstate 'PGRST' using
      message=jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active scientific analyses. Wait for current jobs to finish.')::text,
      detail=jsonb_build_object('status',429)::text;
  end if;

  insert into public.scientific_jobs(
    organization_id,project_id,requested_by,job_type,tool_id,tool_version,parameters,request_fingerprint
  ) values (
    org_id,p_project_id,caller_id,'protein_properties',tool.tool_id,tool.tool_version,normalized_params,fingerprint
  ) returning id into new_id;

  insert into public.scientific_job_inputs(
    job_id,organization_id,project_id,input_position,input_role,sequence_upload_id,input_sha256,sequence_type,residue_count
  ) values (
    new_id,org_id,p_project_id,1,'protein_sequence',input.id,input.sha256,input.sequence_type,input.residue_count
  );

  select pgmq.send(queue_name=>'scientific_standard',msg=>jsonb_build_object('job_id',new_id,'job_type','protein_properties')) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue protein properties job'; end if;
  return new_id;
end;
$$;

create or replace function public.request_protein_properties(project_id uuid,sequence_upload_id uuid)
returns uuid language sql security invoker set search_path=''
as $$ select app_private.request_protein_properties(project_id,sequence_upload_id); $$;

revoke all on function app_private.request_protein_properties(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.request_protein_properties(uuid,uuid) to authenticated;
revoke all on function public.request_protein_properties(uuid,uuid) from public,anon,service_role;
grant execute on function public.request_protein_properties(uuid,uuid) to authenticated;

create or replace function app_private.claim_scientific_job(p_visibility_seconds integer default 300)
returns table(message_id bigint,job_id uuid,organization_id uuid,project_id uuid,requested_by uuid,job_type text,tool_id text,tool_version text,parameters jsonb,request_fingerprint text,inputs jsonb)
language plpgsql security definer set search_path='' as $$
declare
  q record; target public.scientific_jobs%rowtype; target_id uuid; payload_type text;
  input_rows jsonb; input_count integer; tool_status text;
begin
  if p_visibility_seconds < 60 or p_visibility_seconds > 900 then raise exception 'visibility timeout must be between 60 and 900 seconds'; end if;
  select * into q from pgmq.read(queue_name=>'scientific_standard',vt=>p_visibility_seconds,qty=>1) limit 1;
  if not found then return; end if;
  begin target_id := (q.message->>'job_id')::uuid; payload_type := q.message->>'job_type';
  exception when others then perform pgmq.delete('scientific_standard',q.msg_id); return; end;
  select * into target from public.scientific_jobs where id=target_id for update;
  if not found or target.status <> 'queued' or payload_type is distinct from target.job_type then
    perform pgmq.delete('scientific_standard',q.msg_id); return;
  end if;
  select status into tool_status from app_private.scientific_tools where tool_id=target.tool_id and tool_version=target.tool_version;
  if tool_status is null or tool_status='disabled' then
    update public.scientific_jobs set status='error',failure_class='execution',processing_error='Approved scientific tool is unavailable.',processing_finished_at=now(),updated_at=now() where id=target.id;
    perform pgmq.delete('scientific_standard',q.msg_id); return;
  end if;
  select count(*) into input_count from public.scientific_job_inputs where job_id=target.id;
  if (target.job_type='pairwise_alignment' and input_count<>2)
     or (target.job_type='multiple_sequence_alignment' and (input_count<3 or input_count>50))
     or (target.job_type='protein_properties' and input_count<>1) then
    update public.scientific_jobs set status='error',failure_class='input_integrity',processing_error='Scientific job inputs are incomplete or outside approved bounds.',processing_finished_at=now(),updated_at=now() where id=target.id;
    perform pgmq.delete('scientific_standard',q.msg_id); return;
  end if;
  update public.scientific_jobs set status='running',processing_attempts=processing_attempts+1,processing_started_at=coalesce(processing_started_at,now()),processing_error=null,failure_class=null,updated_at=now() where id=target.id returning * into target;
  select jsonb_agg(jsonb_build_object(
    'position',i.input_position,'role',i.input_role,'upload_id',i.sequence_upload_id,'object_path',u.object_path,
    'file_size_bytes',u.file_size_bytes,'sha256',i.input_sha256,'sequence_type',i.sequence_type,'residue_count',i.residue_count
  ) order by i.input_position) into input_rows
  from public.scientific_job_inputs i join public.sequence_uploads u on u.id=i.sequence_upload_id where i.job_id=target.id;
  return query select q.msg_id::bigint,target.id,target.organization_id,target.project_id,target.requested_by,
    target.job_type,target.tool_id,target.tool_version,target.parameters,target.request_fingerprint,input_rows;
end;
$$;

create or replace function app_private.finish_protein_properties_success(
  p_message_id bigint,p_job_id uuid,p_executor_version text,p_result_object_path text,
  p_result_sha256 text,p_result_bytes bigint,p_result_summary jsonb,p_provenance jsonb
)
returns void language plpgsql security definer set search_path='' as $$
declare
  target public.scientific_jobs%rowtype;
  expected_path text;
  input_sha text;
  input_residues bigint;
  length_value integer;
  molecular_weight numeric;
  aromaticity numeric;
  gravy numeric;
  charge7 numeric;
  pi_value numeric;
begin
  select * into target from public.scientific_jobs where id=p_job_id for update;
  if not found or target.status<>'running' or target.job_type<>'protein_properties' then
    raise exception 'protein properties job is not active' using errcode='P0002';
  end if;
  if target.tool_id<>'genithm-protein-properties' or target.tool_version<>'0.1.0' then
    raise exception 'protein properties tool provenance mismatch';
  end if;
  expected_path := target.organization_id::text||'/'||target.project_id::text||'/'||target.id::text||'/protein-properties.json';
  if p_result_object_path is distinct from expected_path then raise exception 'protein result object path mismatch'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='analysis-results' and o.name=expected_path) then
    raise exception 'protein result artifact not found' using errcode='P0002';
  end if;
  if p_result_sha256 is null or p_result_sha256 !~ '^[0-9a-f]{64}$' or p_result_bytes is null or p_result_bytes<1 or p_result_bytes>26214400 then
    raise exception 'protein result integrity metadata is invalid';
  end if;
  if nullif(trim(p_executor_version),'') is null or char_length(trim(p_executor_version))>128 then raise exception 'protein executor provenance is invalid'; end if;
  if p_result_summary is null or jsonb_typeof(p_result_summary)<>'object' or p_provenance is null or jsonb_typeof(p_provenance)<>'object' then
    raise exception 'protein result summary or provenance is invalid';
  end if;
  select input_sha256,residue_count into input_sha,input_residues from public.scientific_job_inputs where job_id=target.id and input_position=1;
  if input_sha is null then raise exception 'protein input provenance is missing'; end if;
  if p_result_summary->>'job_type' is distinct from 'protein_properties'
     or p_result_summary->>'input_sha256' is distinct from input_sha
     or p_result_summary->>'alphabet' is distinct from 'canonical_20_amino_acids' then
    raise exception 'protein result input provenance mismatch';
  end if;
  if p_provenance->>'tool_id' is distinct from target.tool_id
     or p_provenance->>'tool_version' is distinct from target.tool_version
     or p_provenance->>'executor_version' is distinct from trim(p_executor_version)
     or p_provenance->>'request_fingerprint' is distinct from target.request_fingerprint
     or p_provenance->>'input_sha256' is distinct from input_sha then
    raise exception 'protein provenance mismatch';
  end if;
  begin
    length_value := (p_result_summary->>'length')::integer;
    molecular_weight := (p_result_summary->>'molecular_weight_da')::numeric;
    aromaticity := (p_result_summary->>'aromaticity_fraction')::numeric;
    gravy := (p_result_summary->>'gravy')::numeric;
    charge7 := (p_result_summary->>'estimated_net_charge_ph7')::numeric;
    pi_value := (p_result_summary->>'estimated_isoelectric_point')::numeric;
  exception when others then raise exception 'protein result metrics are invalid'; end;
  if length_value<>input_residues or length_value<1 or length_value>200000
     or molecular_weight<=0 or molecular_weight>50000000
     or aromaticity<0 or aromaticity>1
     or gravy<-4.5 or gravy>4.5
     or charge7<-200000 or charge7>200000
     or pi_value<0 or pi_value>14 then
    raise exception 'protein result metrics are outside approved bounds';
  end if;
  if jsonb_typeof(p_result_summary->'amino_acid_composition')<>'object' then raise exception 'protein composition is invalid'; end if;
  update public.scientific_jobs set status='completed',executor_version=trim(p_executor_version),result_object_path=expected_path,
    result_sha256=p_result_sha256,result_bytes=p_result_bytes,result_summary=p_result_summary,provenance=p_provenance,
    processing_finished_at=now(),processing_error=null,failure_class=null,updated_at=now() where id=target.id;
  if not pgmq.delete('scientific_standard',p_message_id) then raise exception 'scientific queue message delete failed'; end if;
end;
$$;

create or replace function public.finish_protein_properties_success(
  message_id bigint,job_id uuid,executor_version text,result_object_path text,result_sha256 text,
  result_bytes bigint,result_summary jsonb,provenance jsonb
)
returns void language sql security invoker set search_path=''
as $$ select app_private.finish_protein_properties_success(message_id,job_id,executor_version,result_object_path,result_sha256,result_bytes,result_summary,provenance); $$;

revoke all on function app_private.finish_protein_properties_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function app_private.finish_protein_properties_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) to service_role;
revoke all on function public.finish_protein_properties_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.finish_protein_properties_success(bigint,uuid,text,text,text,bigint,jsonb,jsonb) to service_role;
