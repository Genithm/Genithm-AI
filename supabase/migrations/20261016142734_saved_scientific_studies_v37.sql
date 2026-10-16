-- Genithm V37: durable owner-scoped scientific comparison studies.
-- A study stores ONLY immutable references to existing completed analyses and
-- their DB-recorded hashes. No scientific measurements or unverified projections
-- are stored as validated results. Reopening checks original artifact bytes.
create table public.scientific_comparison_studies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  job_type text not null check (job_type in ('protein_properties','pairwise_alignment')),
  job_ids uuid[] not null check (
    cardinality(job_ids) between 2 and 4 and array_position(job_ids,null) is null
  ),
  source_sha256 text[] not null default '{}'::text[],
  tool_versions text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scientific_study_attestations_ck check (
    cardinality(source_sha256)=cardinality(job_ids) and
    cardinality(tool_versions)=cardinality(job_ids)
  )
);
create index scientific_studies_owner_recent_idx
  on public.scientific_comparison_studies(created_by,created_at desc);
create index scientific_studies_project_recent_idx
  on public.scientific_comparison_studies(project_id,created_at desc);

create function app_private.validate_scientific_comparison_study()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  org uuid;
  current_job uuid;
  source_job record;
  hashes text[] := '{}'::text[];
  versions text[] := '{}'::text[];
begin
  if actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if new.created_by is distinct from actor then
      raise exception 'Study owner mismatch' using errcode='42501';
    end if;
    select p.organization_id into org from public.projects p
      where p.id=new.project_id and p.status='active'
        and app_private.is_org_member(p.organization_id);
    if not found then
      raise exception 'Project not accessible' using errcode='42501';
    end if;
    new.organization_id := org;
    if cardinality(new.job_ids) not between 2 and 4
       or cardinality(array(select distinct unnest(new.job_ids))) <> cardinality(new.job_ids)
    then
      raise exception 'Select 2-4 distinct scientific jobs' using errcode='23514';
    end if;
    -- Source order matters and is locked into the attestation arrays. Every
    -- source must belong to this researcher and exactly this project.
    foreach current_job in array new.job_ids loop
      select j.result_sha256, j.tool_version into source_job
      from public.scientific_jobs j
      where j.id=current_job and j.project_id=new.project_id
        and j.organization_id=org and j.requested_by=actor
        and j.status='completed' and j.job_type=new.job_type
        and j.result_sha256 ~ '^[a-f0-9]{64}$'
        and j.tool_version is not null;
      if not found then
        raise exception 'Comparison source unavailable or inconsistent'
          using errcode='42501';
      end if;
      hashes := array_append(hashes,source_job.result_sha256);
      versions := array_append(versions,source_job.tool_version);
    end loop;
    new.source_sha256 := hashes;
    new.tool_versions := versions;
    new.created_at := now();
    new.updated_at := now();
  else
    if old.created_by is distinct from actor or
      new.created_by is distinct from old.created_by or
      new.organization_id is distinct from old.organization_id or
      new.project_id is distinct from old.project_id or
      new.job_type is distinct from old.job_type or
      new.job_ids is distinct from old.job_ids or
      new.source_sha256 is distinct from old.source_sha256 or
      new.tool_versions is distinct from old.tool_versions or
      new.created_at is distinct from old.created_at then
      raise exception 'Study owner and source evidence are immutable'
        using errcode='42501';
    end if;
    if not app_private.is_org_member(old.organization_id) then
      raise exception 'Study not accessible' using errcode='42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

revoke all on function app_private.validate_scientific_comparison_study()
  from public,anon,authenticated,service_role;
create trigger scientific_comparison_study_write_guard
  before insert or update on public.scientific_comparison_studies
  for each row execute function app_private.validate_scientific_comparison_study();

alter table public.scientific_comparison_studies enable row level security;

create policy scientific_comparison_studies_select_owner
  on public.scientific_comparison_studies for select to authenticated
  using (created_by=(select auth.uid()) and
    (select app_private.is_org_member(organization_id)));
create policy scientific_comparison_studies_insert_owner
  on public.scientific_comparison_studies for insert to authenticated
  with check (created_by=(select auth.uid()) and
    (select app_private.is_org_member(organization_id)));
create policy scientific_comparison_studies_update_owner
  on public.scientific_comparison_studies for update to authenticated
  using (created_by=(select auth.uid()) and
    (select app_private.is_org_member(organization_id)))
  with check (created_by=(select auth.uid()) and
    (select app_private.is_org_member(organization_id)));
create policy scientific_comparison_studies_delete_owner
  on public.scientific_comparison_studies for delete to authenticated
  using (created_by=(select auth.uid()) and
    (select app_private.is_org_member(organization_id)));

revoke all on public.scientific_comparison_studies from public, anon;
grant select, insert, update, delete on public.scientific_comparison_studies to authenticated;
comment on table public.scientific_comparison_studies is
  'User-authored saved comparison selections. Stored digests are source metadata, not proof of artifact validity; verify bytes every time a saved study is reopened.';
