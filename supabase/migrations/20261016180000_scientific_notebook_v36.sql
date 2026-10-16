-- Genithm V36: append researcher-authored notes to real projects and recorded scientific results.
-- The recorded source SHA is captured from a completed scientific job by a database
-- trigger, never trusted from browser input. Notebook interpretations are NOT
-- independently verified results and never mutate the scientific artifact.
create table public.scientific_notebook_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  scientific_job_id uuid references public.scientific_jobs(id) on delete restrict,
  source_result_sha256 text,
  note_kind text not null default 'observation'
    check (note_kind in ('observation','hypothesis','interpretation','limitation')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  body text not null check (char_length(btrim(body)) between 1 and 8000),
  tags text[] not null default '{}'::text[]
    check (cardinality(tags) <= 8 and array_position(tags, null) is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scientific_notebook_source_ck check (
    (scientific_job_id is null and source_result_sha256 is null)
    or (scientific_job_id is not null and source_result_sha256 ~ '^[0-9a-f]{64}$')
  )
);
create index scientific_notebook_owner_recent_idx
  on public.scientific_notebook_entries(created_by,created_at desc);
create index scientific_notebook_project_recent_idx
  on public.scientific_notebook_entries(project_id,created_at desc);

create function app_private.validate_scientific_notebook_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  org_id uuid;
  source_hash text;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  if TG_OP = 'INSERT' then
    if new.created_by is distinct from actor then
      raise exception 'Invalid notebook owner' using errcode='42501';
    end if;
    select p.organization_id into org_id from public.projects p
      where p.id = new.project_id and p.status = 'active'
      and app_private.is_org_member(p.organization_id);
    if not found then
      raise exception 'Project unavailable' using errcode='42501';
    end if;
    -- The organization is derived from the actual project, never the form.
    new.organization_id := org_id;
    if new.scientific_job_id is not null then
      select j.result_sha256 into source_hash from public.scientific_jobs j
      where j.id = new.scientific_job_id and j.organization_id = org_id
        and j.project_id = new.project_id and j.requested_by = actor
        and j.status = 'completed' and j.result_sha256 ~ '^[0-9a-f]{64}$';
      if not found then
        raise exception 'Completed source analysis unavailable' using errcode='42501';
      end if;
      new.source_result_sha256 := source_hash;
    else
      new.source_result_sha256 := null;
    end if;
    new.created_at := now();
    new.updated_at := now();
  else
    if old.created_by is distinct from actor or
       new.created_by is distinct from old.created_by or
       new.organization_id is distinct from old.organization_id or
       new.project_id is distinct from old.project_id or
       new.scientific_job_id is distinct from old.scientific_job_id or
       new.source_result_sha256 is distinct from old.source_result_sha256 or
       new.created_at is distinct from old.created_at then
      raise exception 'Notebook source and ownership are immutable'
        using errcode='42501';
    end if;
    if not app_private.is_org_member(old.organization_id) then
      raise exception 'Notebook project unavailable' using errcode='42501';
    end if;
    new.updated_at := now();
  end if;
  -- Bound tags individually, not just the array's cardinality.
  if exists (
    select 1 from unnest(new.tags) as tag
    where char_length(tag) not between 2 and 24
      or tag !~ '^[a-z0-9][a-z0-9-]*$'
  ) then
    raise exception 'Notebook tags must be short, lowercase identifiers'
      using errcode='23514';
  end if;
  return new;
end $$;

revoke all on function app_private.validate_scientific_notebook_entry()
  from public, anon, authenticated, service_role;

create trigger scientific_notebook_entry_write_guard
  before insert or update on public.scientific_notebook_entries
  for each row execute function app_private.validate_scientific_notebook_entry();

alter table public.scientific_notebook_entries enable row level security;

create policy scientific_notebook_select_owner
  on public.scientific_notebook_entries for select to authenticated
  using (
    created_by = (select auth.uid()) and
    (select app_private.is_org_member(organization_id))
  );
create policy scientific_notebook_insert_owner
  on public.scientific_notebook_entries for insert to authenticated
  with check (
    created_by = (select auth.uid()) and
    (select app_private.is_org_member(organization_id))
  );
create policy scientific_notebook_update_owner
  on public.scientific_notebook_entries for update to authenticated
  using (
    created_by = (select auth.uid()) and
    (select app_private.is_org_member(organization_id))
  )
  with check (
    created_by = (select auth.uid()) and
    (select app_private.is_org_member(organization_id))
  );
create policy scientific_notebook_delete_owner
  on public.scientific_notebook_entries for delete to authenticated
  using (
    created_by = (select auth.uid()) and
    (select app_private.is_org_member(organization_id))
  );

revoke all on public.scientific_notebook_entries from public, anon;
grant select, insert, update, delete on public.scientific_notebook_entries to authenticated;
comment on table public.scientific_notebook_entries is
  'Researcher-authored notes linked to projects and optional completed scientific results. The captured SHA is recorded job evidence, not a biological validation.';
