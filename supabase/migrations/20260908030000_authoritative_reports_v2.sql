alter table public.scientific_reports
  add column source_resource_type text,
  add column source_resource_id uuid,
  add column source_evidence_sha256 text,
  add column blast_job_id uuid references public.blast_jobs(id) on delete restrict,
  add column sequence_retrieval_id uuid references public.sequence_retrievals(id) on delete restrict,
  add column protein_annotation_job_id uuid references public.protein_annotation_jobs(id) on delete restrict;

update public.scientific_reports
set source_resource_type='scientific_job',
    source_resource_id=source_job_id,
    source_evidence_sha256=source_result_sha256;

alter table public.scientific_reports
  alter column source_resource_type set not null,
  alter column source_resource_id set not null,
  alter column source_evidence_sha256 set not null,
  alter column source_job_id drop not null,
  alter column source_job_type drop not null,
  alter column source_result_sha256 drop not null;

alter table public.scientific_reports drop constraint scientific_reports_schema;
alter table public.scientific_reports add constraint scientific_reports_schema
  check (report_schema_version in ('scientific-report-v1','scientific-report-v2'));
alter table public.scientific_reports add constraint scientific_reports_resource_type
  check (source_resource_type in ('scientific_job','blast_job','sequence_retrieval','protein_annotation_job'));
alter table public.scientific_reports add constraint scientific_reports_source_evidence_sha
  check (source_evidence_sha256 ~ '^[0-9a-f]{64}$');
alter table public.scientific_reports add constraint scientific_reports_source_reference
  check (
    (source_resource_type='scientific_job' and source_job_id=source_resource_id and blast_job_id is null and sequence_retrieval_id is null and protein_annotation_job_id is null)
    or (source_resource_type='blast_job' and blast_job_id=source_resource_id and source_job_id is null and sequence_retrieval_id is null and protein_annotation_job_id is null)
    or (source_resource_type='sequence_retrieval' and sequence_retrieval_id=source_resource_id and source_job_id is null and blast_job_id is null and protein_annotation_job_id is null)
    or (source_resource_type='protein_annotation_job' and protein_annotation_job_id=source_resource_id and source_job_id is null and blast_job_id is null and sequence_retrieval_id is null)
  );

create unique index scientific_reports_resource_owner_unique_idx
  on public.scientific_reports(source_resource_type,source_resource_id,created_by);
create index scientific_reports_blast_job_fk_idx on public.scientific_reports(blast_job_id) where blast_job_id is not null;
create index scientific_reports_sequence_retrieval_fk_idx on public.scientific_reports(sequence_retrieval_id) where sequence_retrieval_id is not null;
create index scientific_reports_protein_annotation_fk_idx on public.scientific_reports(protein_annotation_job_id) where protein_annotation_job_id is not null;

create or replace function app_private.request_authoritative_report(p_source_resource_type text,p_source_resource_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_id uuid:=auth.uid();
  existing_id uuid;
  report_id uuid;
  org_id uuid;
  proj_id uuid;
  project_name text;
  subtype text;
  source_status text;
  completed_at timestamptz;
  evidence_doc jsonb;
  evidence_hash text;
  report_doc jsonb;
  report_hash text;
  result_summary jsonb:='{}'::jsonb;
  parameters jsonb:='{}'::jsonb;
  inputs jsonb:='[]'::jsonb;
  dependencies jsonb:='[]'::jsonb;
  provenance jsonb:='{}'::jsonb;
  source_job uuid;
  blast_job uuid;
  retrieval_job uuid;
  annotation_job uuid;
  j public.scientific_jobs%rowtype;
  b public.blast_jobs%rowtype;
  r public.sequence_retrievals%rowtype;
  a public.protein_annotation_jobs%rowtype;
begin
  if caller_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_source_resource_type not in ('scientific_job','blast_job','sequence_retrieval','protein_annotation_job') then
    raise exception 'unsupported report source type';
  end if;

  select id into existing_id from public.scientific_reports
  where source_resource_type=p_source_resource_type and source_resource_id=p_source_resource_id and created_by=caller_id;
  if existing_id is not null then return existing_id; end if;

  if p_source_resource_type='scientific_job' then
    select * into j from public.scientific_jobs where id=p_source_resource_id;
    if not found then raise exception 'scientific job not found' using errcode='P0002'; end if;
    if not app_private.is_org_member(j.organization_id) then raise exception 'scientific job access denied' using errcode='42501'; end if;
    if j.status<>'completed' or j.result_summary is null or j.result_sha256 is null or j.processing_finished_at is null then raise exception 'scientific result is not finalized'; end if;
    org_id:=j.organization_id; proj_id:=j.project_id; subtype:=j.job_type; source_status:=j.status; completed_at:=j.processing_finished_at; source_job:=j.id;
    select coalesce(jsonb_agg(jsonb_build_object('position',i.input_position,'role',i.input_role,'sequence_upload_id',i.sequence_upload_id,'sha256',i.input_sha256,'sequence_type',i.sequence_type,'residue_count',i.residue_count) order by i.input_position),'[]'::jsonb)
      into inputs from public.scientific_job_inputs i where i.job_id=j.id and i.organization_id=j.organization_id and i.project_id=j.project_id;
    select coalesce(jsonb_agg(jsonb_build_object('job_id',d.dependency_job_id,'role',d.dependency_role,'result_sha256',d.dependency_result_sha256) order by d.created_at,d.dependency_job_id),'[]'::jsonb)
      into dependencies from public.scientific_job_dependencies d where d.job_id=j.id and d.organization_id=j.organization_id and d.project_id=j.project_id;
    result_summary:=j.result_summary; parameters:=j.parameters;
    provenance:=jsonb_build_object('tool',jsonb_build_object('id',j.tool_id,'version',j.tool_version,'executor_version',j.executor_version),'recorded',coalesce(j.provenance,'{}'::jsonb),'result_sha256',j.result_sha256,'result_bytes',j.result_bytes);
    evidence_doc:=jsonb_build_object('resource_type','scientific_job','resource_id',j.id,'job_type',j.job_type,'result_summary',j.result_summary,'parameters',j.parameters,'inputs',inputs,'dependencies',dependencies,'result_sha256',j.result_sha256,'provenance',coalesce(j.provenance,'{}'::jsonb));
  elsif p_source_resource_type='blast_job' then
    select * into b from public.blast_jobs where id=p_source_resource_id;
    if not found then raise exception 'BLAST job not found' using errcode='P0002'; end if;
    if not app_private.is_org_member(b.organization_id) then raise exception 'BLAST job access denied' using errcode='42501'; end if;
    if b.status<>'completed' or b.result_summary is null or b.raw_result_sha256 is null or b.processing_finished_at is null then raise exception 'BLAST result is not finalized'; end if;
    org_id:=b.organization_id; proj_id:=b.project_id; subtype:=b.program; source_status:=b.status; completed_at:=b.processing_finished_at; blast_job:=b.id;
    parameters:=jsonb_build_object('program',b.program,'database_name',b.database_name,'expect_value',b.expect_value,'max_targets',b.max_targets,'low_complexity_filter',b.low_complexity_filter);
    inputs:=jsonb_build_array(jsonb_build_object('sequence_upload_id',b.query_upload_id,'sha256',b.query_sha256,'role','query'));
    result_summary:=jsonb_build_object('summary',b.result_summary,'normalized_hits',coalesce(b.normalized_hits,'[]'::jsonb));
    provenance:=jsonb_strip_nulls(jsonb_build_object('service_provider',b.service_provider,'service_mode',b.service_mode,'service_version',b.service_version,'blast_version',b.blast_version,'database_reported',b.database_reported,'database_release',b.database_release,'remote_rid',b.remote_rid,'submitted_at',b.submitted_at,'raw_result_sha256',b.raw_result_sha256,'raw_result_bytes',b.raw_result_bytes));
    evidence_doc:=jsonb_build_object('resource_type','blast_job','resource_id',b.id,'parameters',parameters,'inputs',inputs,'result_summary',result_summary,'provenance',provenance);
  elsif p_source_resource_type='sequence_retrieval' then
    select * into r from public.sequence_retrievals where id=p_source_resource_id;
    if not found then raise exception 'sequence retrieval not found' using errcode='P0002'; end if;
    if not app_private.is_org_member(r.organization_id) then raise exception 'sequence retrieval access denied' using errcode='42501'; end if;
    if r.status not in ('retrieved','not_found') or r.source_checked_at is null then raise exception 'sequence retrieval is not finalized'; end if;
    org_id:=r.organization_id; proj_id:=r.project_id; subtype:=r.source_database; source_status:=r.status; completed_at:=coalesce(r.processing_finished_at,r.source_checked_at); retrieval_job:=r.id;
    parameters:=jsonb_build_object('source_provider',r.source_provider,'source_database',r.source_database,'requested_accession',r.requested_accession,'resolution_mode',r.resolution_mode,'freshness_policy',r.freshness_policy);
    if r.sequence_upload_id is not null then inputs:=jsonb_build_array(jsonb_build_object('sequence_upload_id',r.sequence_upload_id,'role','retrieved_sequence')); end if;
    result_summary:=jsonb_strip_nulls(jsonb_build_object('status',r.status,'resolved_accession',r.resolved_accession,'record_title',r.record_title,'organism',r.organism,'reported_length',r.reported_length,'record_updated_date',r.record_updated_date,'result_message',r.result_message));
    provenance:=jsonb_strip_nulls(jsonb_build_object('connector_version',r.connector_version,'source_checked_at',r.source_checked_at,'source_retrieved_at',r.source_retrieved_at,'source_response_sha256',r.source_response_sha256,'source_response_bytes',r.source_response_bytes,'freshness_policy',r.freshness_policy));
    evidence_doc:=jsonb_build_object('resource_type','sequence_retrieval','resource_id',r.id,'parameters',parameters,'result_summary',result_summary,'provenance',provenance);
  else
    select * into a from public.protein_annotation_jobs where id=p_source_resource_id;
    if not found then raise exception 'protein annotation job not found' using errcode='P0002'; end if;
    if not app_private.is_org_member(a.organization_id) then raise exception 'protein annotation access denied' using errcode='42501'; end if;
    if a.status not in ('completed','no_mapping') or a.source_checked_at is null then raise exception 'protein annotation is not finalized'; end if;
    org_id:=a.organization_id; proj_id:=a.project_id; subtype:='protein_annotation'; source_status:=a.status; completed_at:=coalesce(a.processing_finished_at,a.source_checked_at); annotation_job:=a.id;
    parameters:=jsonb_build_object('refseq_accession',a.refseq_accession,'freshness_policy',a.freshness_policy,'mapping_provider',a.mapping_provider);
    inputs:=jsonb_build_array(jsonb_build_object('sequence_upload_id',a.sequence_upload_id,'ncbi_retrieval_id',a.ncbi_retrieval_id,'sha256',a.input_sha256,'residue_count',a.input_residue_count,'role','protein_sequence'));
    dependencies:=jsonb_build_array(jsonb_build_object('resource_type','sequence_retrieval','resource_id',a.ncbi_retrieval_id,'role','ncbi_source'));
    result_summary:=jsonb_strip_nulls(jsonb_build_object('status',a.status,'protein_name',a.protein_name,'gene_names',a.gene_names,'organism_name',a.organism_name,'uniprot',jsonb_strip_nulls(jsonb_build_object('accession',a.uniprot_accession,'entry_id',a.uniprot_entry_id,'reviewed',a.uniprot_reviewed,'release',a.uniprot_release,'release_date',a.uniprot_release_date)),'interpro_entries',a.interpro_entries,'pfam_entries',a.pfam_entries,'annotation_summary',a.annotation_summary,'result_message',a.result_message));
    provenance:=jsonb_strip_nulls(jsonb_build_object('connector_version',a.connector_version,'source_checked_at',a.source_checked_at,'mapping_candidate_count',a.mapping_candidate_count,'mapping_response_sha256',a.mapping_response_sha256,'mapping_response_bytes',a.mapping_response_bytes,'uniprot_sequence_sha256',a.uniprot_sequence_sha256,'uniprot_response_sha256',a.uniprot_response_sha256,'uniprot_response_bytes',a.uniprot_response_bytes,'interpro_response_sha256',a.interpro_response_sha256,'interpro_response_bytes',a.interpro_response_bytes,'pfam_response_sha256',a.pfam_response_sha256,'pfam_response_bytes',a.pfam_response_bytes));
    evidence_doc:=jsonb_build_object('resource_type','protein_annotation_job','resource_id',a.id,'parameters',parameters,'inputs',inputs,'dependencies',dependencies,'result_summary',result_summary,'provenance',provenance);
  end if;

  select name into project_name from public.projects where id=proj_id and organization_id=org_id;
  evidence_hash:=encode(extensions.digest(convert_to(evidence_doc::text,'UTF8'),'sha256'),'hex');
  report_doc:=jsonb_build_object(
    'schema_version','scientific-report-v2',
    'report_kind','authoritative_scientific_result',
    'project',jsonb_build_object('id',proj_id,'name',project_name),
    'source',jsonb_build_object('resource_type',p_source_resource_type,'resource_id',p_source_resource_id,'subtype',subtype,'status',source_status,'evidence_sha256',evidence_hash,'completed_at',completed_at),
    'result_summary',result_summary,
    'parameters',parameters,
    'inputs',inputs,
    'dependencies',dependencies,
    'provenance',provenance,
    'interpretation_policy',jsonb_build_object('ai_interpretation_included',false,'statement','This report contains recorded authoritative scientific evidence only. AI interpretation is not part of the scientific truth snapshot.')
  );
  if octet_length(report_doc::text)>131072 then raise exception 'authoritative report exceeds V2 size limit'; end if;
  report_hash:=encode(extensions.digest(convert_to(report_doc::text,'UTF8'),'sha256'),'hex');

  insert into public.scientific_reports(
    organization_id,project_id,created_by,source_job_id,source_job_type,source_result_sha256,
    source_resource_type,source_resource_id,source_evidence_sha256,blast_job_id,sequence_retrieval_id,protein_annotation_job_id,
    report_schema_version,report_snapshot,report_sha256
  ) values (
    org_id,proj_id,caller_id,source_job,case when p_source_resource_type='scientific_job' then subtype else null end,case when p_source_resource_type='scientific_job' then j.result_sha256 else null end,
    p_source_resource_type,p_source_resource_id,evidence_hash,blast_job,retrieval_job,annotation_job,
    'scientific-report-v2',report_doc,report_hash
  ) on conflict (source_resource_type,source_resource_id,created_by) do nothing returning id into report_id;

  if report_id is null then
    select id into existing_id from public.scientific_reports where source_resource_type=p_source_resource_type and source_resource_id=p_source_resource_id and created_by=caller_id;
    if existing_id is null then raise exception 'authoritative report creation conflict'; end if;
    return existing_id;
  end if;

  perform app_private.append_audit_event(org_id,proj_id,caller_id,'user','SCIENTIFIC_REPORT_CREATED','scientific_report',report_id::text,'created',
    jsonb_build_object('source_resource_type',p_source_resource_type,'source_resource_id',p_source_resource_id,'source_subtype',subtype,'source_evidence_sha256',evidence_hash,'report_sha256',report_hash,'report_schema_version','scientific-report-v2'));
  return report_id;
end;
$$;
revoke all on function app_private.request_authoritative_report(text,uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.request_authoritative_report(text,uuid) to authenticated;

create or replace function public.request_authoritative_report(source_resource_type text,source_resource_id uuid)
returns uuid language sql security invoker set search_path='' as $$
  select app_private.request_authoritative_report(source_resource_type,source_resource_id);
$$;
revoke all on function public.request_authoritative_report(text,uuid) from public,anon,service_role;
grant execute on function public.request_authoritative_report(text,uuid) to authenticated;

create or replace function app_private.request_scientific_report(p_source_job_id uuid)
returns uuid language sql security invoker set search_path='' as $$
  select app_private.request_authoritative_report('scientific_job',p_source_job_id);
$$;
revoke all on function app_private.request_scientific_report(uuid) from public,anon,authenticated,service_role;
grant execute on function app_private.request_scientific_report(uuid) to authenticated;

create or replace function public.request_scientific_report(source_job_id uuid)
returns uuid language sql security invoker set search_path='' as $$
  select app_private.request_authoritative_report('scientific_job',source_job_id);
$$;
revoke all on function public.request_scientific_report(uuid) from public,anon,service_role;
grant execute on function public.request_scientific_report(uuid) to authenticated;

drop function public.get_scientific_report(uuid);
create function public.get_scientific_report(report_id uuid)
returns table(
  id uuid, organization_id uuid, project_id uuid, created_by uuid,
  source_job_id uuid, source_job_type text, source_result_sha256 text,
  source_resource_type text, source_resource_id uuid, source_evidence_sha256 text,
  report_schema_version text, report_snapshot jsonb, report_sha256 text, integrity_valid boolean,
  generated_at timestamptz, created_at timestamptz
)
language sql stable security invoker set search_path='' as $$
  select r.id,r.organization_id,r.project_id,r.created_by,
         r.source_job_id,r.source_job_type,r.source_result_sha256,
         r.source_resource_type,r.source_resource_id,r.source_evidence_sha256,
         r.report_schema_version,r.report_snapshot,r.report_sha256,
         encode(extensions.digest(convert_to(r.report_snapshot::text,'UTF8'),'sha256'),'hex')=r.report_sha256,
         r.generated_at,r.created_at
  from public.scientific_reports r where r.id=report_id;
$$;
revoke all on function public.get_scientific_report(uuid) from public,anon,service_role;
grant execute on function public.get_scientific_report(uuid) to authenticated;
