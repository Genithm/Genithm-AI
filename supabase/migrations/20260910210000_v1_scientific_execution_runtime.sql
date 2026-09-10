create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  workflow_type text not null,
  status text not null default 'created',
  input_snapshot jsonb not null,
  idempotency_key text not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  worker_id text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analysis_jobs_status check (status in ('created','queued','running','completed','failed','cancelled')),
  constraint analysis_jobs_workflow_type_length check (char_length(workflow_type) between 1 and 120),
  constraint analysis_jobs_idempotency_key_length check (char_length(idempotency_key) between 8 and 200),
  constraint analysis_jobs_attempts check (attempt_count >= 0 and max_attempts between 1 and 20),
  unique (project_id, idempotency_key)
);

create table public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  version integer not null default 1,
  result_payload jsonb not null,
  tool_name text not null,
  tool_version text not null,
  parameters jsonb not null default '{}'::jsonb,
  input_checksum text not null,
  worker_id text not null,
  executed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint analysis_results_version check (version > 0),
  constraint analysis_results_tool_name_length check (char_length(tool_name) between 1 and 120),
  constraint analysis_results_tool_version_length check (char_length(tool_version) between 1 and 120),
  constraint analysis_results_checksum_length check (char_length(input_checksum) between 16 and 256),
  unique (job_id, version)
);

create table public.evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  result_id uuid not null references public.analysis_results(id) on delete cascade,
  schema_version text not null default 'ai-evidence-v1',
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (result_id)
);

create index analysis_jobs_project_status_created_idx on public.analysis_jobs(project_id, status, created_at desc);
create index analysis_jobs_queue_idx on public.analysis_jobs(status, lease_expires_at, created_at) where status in ('queued','running');
create index analysis_results_job_created_idx on public.analysis_results(job_id, created_at desc);
create index evidence_snapshots_job_created_idx on public.evidence_snapshots(job_id, created_at desc);

create trigger analysis_jobs_set_updated_at before update on public.analysis_jobs for each row execute function app_private.set_updated_at();

alter table public.analysis_jobs enable row level security;
alter table public.analysis_jobs force row level security;
alter table public.analysis_results enable row level security;
alter table public.analysis_results force row level security;
alter table public.evidence_snapshots enable row level security;
alter table public.evidence_snapshots force row level security;

create policy analysis_jobs_select_project_member on public.analysis_jobs for select to authenticated using (
  exists (select 1 from public.projects p where p.id = analysis_jobs.project_id and app_private.is_org_member(p.organization_id))
);
create policy analysis_jobs_insert_project_writer on public.analysis_jobs for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (
    select 1 from public.projects p where p.id = analysis_jobs.project_id and app_private.can_write_org(p.organization_id)
  )
);
create policy analysis_jobs_cancel_project_writer on public.analysis_jobs for update to authenticated using (
  status in ('created','queued') and exists (
    select 1 from public.projects p where p.id = analysis_jobs.project_id and app_private.can_write_org(p.organization_id)
  )
) with check (status = 'cancelled');

create policy analysis_results_select_project_member on public.analysis_results for select to authenticated using (
  exists (
    select 1 from public.analysis_jobs j join public.projects p on p.id = j.project_id
    where j.id = analysis_results.job_id and app_private.is_org_member(p.organization_id)
  )
);
create policy evidence_snapshots_select_project_member on public.evidence_snapshots for select to authenticated using (
  exists (
    select 1 from public.analysis_jobs j join public.projects p on p.id = j.project_id
    where j.id = evidence_snapshots.job_id and app_private.is_org_member(p.organization_id)
  )
);

revoke all on table public.analysis_jobs, public.analysis_results, public.evidence_snapshots from anon, authenticated;
grant select, insert, update on table public.analysis_jobs to authenticated;
grant select on table public.analysis_results, public.evidence_snapshots to authenticated;

create or replace function public.claim_analysis_job(worker_id text, lease_seconds integer default 300)
returns table (
  job_id uuid,
  project_id uuid,
  workflow_type text,
  input_snapshot jsonb,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare claimed_id uuid;
begin
  if worker_id is null or char_length(worker_id) < 1 or char_length(worker_id) > 200 then
    raise exception 'invalid worker_id';
  end if;
  if lease_seconds < 30 or lease_seconds > 1800 then
    raise exception 'invalid lease_seconds';
  end if;

  select j.id into claimed_id
  from public.analysis_jobs j
  where (
    j.status = 'queued'
    or (j.status = 'running' and j.lease_expires_at < now() and j.attempt_count < j.max_attempts)
  )
  order by j.created_at
  for update skip locked
  limit 1;

  if claimed_id is null then return; end if;

  update public.analysis_jobs j
  set status = 'running',
      worker_id = claim_analysis_job.worker_id,
      lease_expires_at = now() + make_interval(secs => lease_seconds),
      started_at = coalesce(j.started_at, now()),
      attempt_count = j.attempt_count + 1,
      last_error = null
  where j.id = claimed_id;

  return query
  select j.id, j.project_id, j.workflow_type, j.input_snapshot, j.attempt_count, j.max_attempts
  from public.analysis_jobs j where j.id = claimed_id;
end;
$$;

create or replace function public.renew_analysis_job_lease(job_id uuid, worker_id text, lease_seconds integer default 300)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.analysis_jobs j
  set lease_expires_at = now() + make_interval(secs => lease_seconds)
  where j.id = job_id and j.status = 'running' and j.worker_id = worker_id and j.lease_expires_at >= now()
  returning true;
$$;

create or replace function public.finish_analysis_job_success(
  job_id uuid,
  worker_id text,
  result_payload jsonb,
  tool_name text,
  tool_version text,
  parameters jsonb,
  input_checksum text,
  executed_at timestamptz,
  evidence_snapshot jsonb
)
returns table (result_id uuid, evidence_snapshot_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare new_result_id uuid; new_evidence_id uuid; next_version integer;
begin
  perform 1 from public.analysis_jobs j
  where j.id = finish_analysis_job_success.job_id
    and j.status = 'running'
    and j.worker_id = finish_analysis_job_success.worker_id
  for update;
  if not found then raise exception 'analysis job is not owned by worker'; end if;

  select coalesce(max(r.version), 0) + 1 into next_version from public.analysis_results r where r.job_id = finish_analysis_job_success.job_id;
  insert into public.analysis_results(job_id, version, result_payload, tool_name, tool_version, parameters, input_checksum, worker_id, executed_at)
  values (job_id, next_version, result_payload, tool_name, tool_version, coalesce(parameters, '{}'::jsonb), input_checksum, worker_id, executed_at)
  returning id into new_result_id;

  insert into public.evidence_snapshots(job_id, result_id, snapshot)
  values (job_id, new_result_id, evidence_snapshot)
  returning id into new_evidence_id;

  update public.analysis_jobs j
  set status='completed', completed_at=now(), lease_expires_at=null, last_error=null
  where j.id = finish_analysis_job_success.job_id;

  return query select new_result_id, new_evidence_id;
end;
$$;

create or replace function public.finish_analysis_job_error(
  job_id uuid,
  worker_id text,
  processing_error text,
  retryable boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare next_status text;
begin
  perform 1 from public.analysis_jobs j
  where j.id = finish_analysis_job_error.job_id and j.status='running' and j.worker_id = finish_analysis_job_error.worker_id
  for update;
  if not found then raise exception 'analysis job is not owned by worker'; end if;

  select case when retryable and j.attempt_count < j.max_attempts then 'queued' else 'failed' end
  into next_status from public.analysis_jobs j where j.id = finish_analysis_job_error.job_id;

  update public.analysis_jobs j
  set status=next_status,
      worker_id=null,
      lease_expires_at=null,
      last_error=left(coalesce(processing_error,'unknown error'),1500),
      completed_at=case when next_status='failed' then now() else null end
  where j.id = finish_analysis_job_error.job_id;
  return next_status;
end;
$$;

revoke all on function public.claim_analysis_job(text, integer), public.renew_analysis_job_lease(uuid, text, integer), public.finish_analysis_job_success(uuid, text, jsonb, text, text, jsonb, text, timestamptz, jsonb), public.finish_analysis_job_error(uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.claim_analysis_job(text, integer), public.renew_analysis_job_lease(uuid, text, integer), public.finish_analysis_job_success(uuid, text, jsonb, text, text, jsonb, text, timestamptz, jsonb), public.finish_analysis_job_error(uuid, text, text, boolean) to service_role;
