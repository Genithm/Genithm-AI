create table public.scientific_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  source_job_id uuid not null references public.scientific_jobs(id) on delete restrict,
  source_job_type text not null,
  source_result_sha256 text not null,
  report_schema_version text not null default 'scientific-report-v1',
  report_snapshot jsonb not null,
  report_sha256 text not null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint scientific_reports_source_type check (source_job_type in ('pairwise_alignment','multiple_sequence_alignment','phylogenetic_tree','protein_properties')),
  constraint scientific_reports_source_sha check (source_result_sha256 ~ '^[0-9a-f]{64}$'),
  constraint scientific_reports_schema check (report_schema_version='scientific-report-v1'),
  constraint scientific_reports_snapshot_object check (jsonb_typeof(report_snapshot)='object'),
  constraint scientific_reports_snapshot_size check (octet_length(report_snapshot::text)<=131072),
  constraint scientific_reports_report_sha check (report_sha256 ~ '^[0-9a-f]{64}$'),
  constraint scientific_reports_source_owner_unique unique (source_job_id, created_by)
);

create index scientific_reports_owner_created_idx on public.scientific_reports(created_by, created_at desc);
create index scientific_reports_project_created_idx on public.scientific_reports(project_id, created_at desc);

alter table public.scientific_reports enable row level security;
alter table public.scientific_reports force row level security;

create policy scientific_reports_select_owner
on public.scientific_reports
for select
to authenticated
using (
  (select auth.uid()) = created_by
  and (select app_private.is_org_member(organization_id))
);

revoke all on table public.scientific_reports from public, anon, authenticated, service_role;
grant select on table public.scientific_reports to authenticated;

create or replace function app_private.prevent_scientific_report_mutation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  raise exception 'scientific reports are immutable';
end;
$$;
revoke all on function app_private.prevent_scientific_report_mutation() from public, anon, authenticated, service_role;

create trigger scientific_reports_immutable
before update or delete on public.scientific_reports
for each row execute function app_private.prevent_scientific_report_mutation();

create or replace function app_private.request_scientific_report(p_source_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_id uuid := auth.uid();
  source_job public.scientific_jobs%rowtype;
  existing_id uuid;
  report_id uuid;
  input_rows jsonb;
  dependency_rows jsonb;
  report_doc jsonb;
  report_hash text;
  project_name text;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;

  select * into source_job
  from public.scientific_jobs
  where id=p_source_job_id;

  if not found then
    raise exception 'scientific job not found' using errcode='P0002';
  end if;
  if not app_private.is_org_member(source_job.organization_id) then
    raise exception 'scientific job access denied' using errcode='42501';
  end if;
  if source_job.status <> 'completed'
     or source_job.result_summary is null
     or source_job.result_sha256 is null
     or source_job.processing_finished_at is null then
    raise exception 'scientific result is not finalized';
  end if;

  select id into existing_id
  from public.scientific_reports
  where source_job_id=source_job.id and created_by=caller_id;
  if existing_id is not null then
    return existing_id;
  end if;

  select name into project_name
  from public.projects
  where id=source_job.project_id and organization_id=source_job.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'position', i.input_position,
    'role', i.input_role,
    'sequence_upload_id', i.sequence_upload_id,
    'sha256', i.input_sha256,
    'sequence_type', i.sequence_type,
    'residue_count', i.residue_count
  ) order by i.input_position), '[]'::jsonb)
  into input_rows
  from public.scientific_job_inputs i
  where i.job_id=source_job.id
    and i.organization_id=source_job.organization_id
    and i.project_id=source_job.project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'job_id', d.dependency_job_id,
    'role', d.dependency_role,
    'result_sha256', d.dependency_result_sha256
  ) order by d.created_at, d.dependency_job_id), '[]'::jsonb)
  into dependency_rows
  from public.scientific_job_dependencies d
  where d.job_id=source_job.id
    and d.organization_id=source_job.organization_id
    and d.project_id=source_job.project_id;

  report_doc := jsonb_build_object(
    'schema_version', 'scientific-report-v1',
    'report_kind', 'authoritative_scientific_result',
    'project', jsonb_build_object(
      'id', source_job.project_id,
      'name', project_name
    ),
    'source', jsonb_build_object(
      'resource_type', 'scientific_job',
      'resource_id', source_job.id,
      'job_type', source_job.job_type,
      'status', source_job.status,
      'result_sha256', source_job.result_sha256,
      'result_bytes', source_job.result_bytes,
      'completed_at', source_job.processing_finished_at
    ),
    'tool', jsonb_build_object(
      'id', source_job.tool_id,
      'version', source_job.tool_version,
      'executor_version', source_job.executor_version
    ),
    'parameters', source_job.parameters,
    'inputs', input_rows,
    'dependencies', dependency_rows,
    'result_summary', source_job.result_summary,
    'provenance', coalesce(source_job.provenance, '{}'::jsonb),
    'interpretation_policy', jsonb_build_object(
      'ai_interpretation_included', false,
      'statement', 'This V1 report contains recorded authoritative scientific results only. AI interpretation is not part of the scientific truth snapshot.'
    )
  );

  report_hash := encode(extensions.digest(convert_to(report_doc::text,'UTF8'),'sha256'),'hex');

  insert into public.scientific_reports(
    organization_id, project_id, created_by, source_job_id, source_job_type,
    source_result_sha256, report_snapshot, report_sha256
  ) values (
    source_job.organization_id, source_job.project_id, caller_id, source_job.id, source_job.job_type,
    source_job.result_sha256, report_doc, report_hash
  ) returning id into report_id;

  perform app_private.append_audit_event(
    source_job.organization_id,
    source_job.project_id,
    caller_id,
    'user',
    'SCIENTIFIC_REPORT_CREATED',
    'scientific_report',
    report_id::text,
    'created',
    jsonb_build_object(
      'source_job_id', source_job.id,
      'source_job_type', source_job.job_type,
      'source_result_sha256', source_job.result_sha256,
      'report_sha256', report_hash,
      'report_schema_version', 'scientific-report-v1'
    )
  );

  return report_id;
end;
$$;

create or replace function public.request_scientific_report(source_job_id uuid)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select app_private.request_scientific_report(source_job_id);
$$;

revoke all on function app_private.request_scientific_report(uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.request_scientific_report(uuid) to authenticated;
revoke all on function public.request_scientific_report(uuid) from public, anon, service_role;
grant execute on function public.request_scientific_report(uuid) to authenticated;
