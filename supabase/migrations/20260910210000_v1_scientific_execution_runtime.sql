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

create policy analysis_jobs_select_project_member on public.analysis_jobs for select to authenticated using (exists (select 1 from public.projects p where p.id = analysis_jobs.project_id and app_private.is_org_member(p.organization_id)));
create policy analysis_jobs_insert_project_writer on public.analysis_jobs for insert to authenticated with check (created_by = (select auth.uid()) and exists (select 1 from public.projects p where p.id = analysis_jobs.project_id and app_private.can_write_org(p.organization_id)));
create policy analysis_jobs_cancel_project_writer on public.analysis_jobs for update to authenticated using (status in ('created','queued') and exists (select 1 from public.projects p where p.id = analysis_jobs.project_id and app_private.can_write_org(p.organization_id))) with check (status = 'cancelled');

create policy analysis_results_select_project_member on public.analysis_results for select to authenticated using (exists (select 1 from public.analysis_jobs j join public.projects p on p.id = j.project_id where j.id = analysis_results.job_id and app_private.is_org_member(p.organization_id)));
create policy evidence_snapshots_select_project_member on public.evidence_snapshots for select to authenticated using (exists (select 1 from public.analysis_jobs j join public.projects p on p.id = j.project_id where j.id = evidence_snapshots.job_id and app_private.is_org_member(p.organization_id)));

revoke all on table public.analysis_jobs, public.analysis_results, public.evidence_snapshots from anon, authenticated;
grant select, insert, update on table public.analysis_jobs to authenticated;
grant select on table public.analysis_results, public.evidence_snapshots to authenticated;

-- Worker RPC boundary
-- (functions omitted here intentionally in this patch representation; existing definitions retained in repository)
-- Ensure server-side workers can execute the runtime RPC contract.
grant execute on function public.claim_analysis_job(text, integer) to service_role;
grant execute on function public.renew_analysis_job_lease(uuid, text, integer) to service_role;
grant execute on function public.finish_analysis_job_success(uuid, text, jsonb, text, text, jsonb, text, timestamptz, jsonb) to service_role;
grant execute on function public.finish_analysis_job_error(uuid, text, text, boolean) to service_role;
