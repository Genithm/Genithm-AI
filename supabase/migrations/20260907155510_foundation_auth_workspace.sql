create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or (char_length(display_name) >= 1 and char_length(display_name) <= 120))
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length check (char_length(name) >= 2 and char_length(name) <= 100),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) >= 2 and char_length(slug) <= 63)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint organization_members_role check (role in ('owner','admin','member','viewer'))
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_length check (char_length(name) >= 1 and char_length(name) <= 160),
  constraint projects_description_length check (description is null or char_length(description) <= 5000),
  constraint projects_status check (status in ('active','archived'))
);

create index organization_members_user_id_idx on public.organization_members(user_id);
create index projects_organization_id_idx on public.projects(organization_id);
create index projects_org_status_created_idx on public.projects(organization_id, status, created_at desc);

create or replace function app_private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_set_updated_at before update on public.profiles for each row execute function app_private.set_updated_at();
create trigger organizations_set_updated_at before update on public.organizations for each row execute function app_private.set_updated_at();
create trigger projects_set_updated_at before update on public.projects for each row execute function app_private.set_updated_at();

create or replace function app_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120), ''));
  return new;
end;
$$;

create trigger auth_user_created after insert on auth.users for each row execute function app_private.handle_new_user();

create or replace function app_private.org_role(target_organization_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select om.role from public.organization_members om
  where om.organization_id = target_organization_id and om.user_id = auth.uid() limit 1;
$$;

create or replace function app_private.is_org_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.organization_members om
    where om.organization_id = target_organization_id and om.user_id = auth.uid()
  );
$$;

create or replace function app_private.is_org_owner(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.org_role(target_organization_id) = 'owner', false);
$$;

create or replace function app_private.can_manage_org(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.org_role(target_organization_id) in ('owner','admin'), false);
$$;

create or replace function app_private.can_write_org(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app_private.org_role(target_organization_id) in ('owner','admin','member'), false);
$$;

revoke all on function app_private.set_updated_at() from public, anon, authenticated;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;
revoke all on function app_private.org_role(uuid) from public, anon;
revoke all on function app_private.is_org_member(uuid) from public, anon;
revoke all on function app_private.is_org_owner(uuid) from public, anon;
revoke all on function app_private.can_manage_org(uuid) from public, anon;
revoke all on function app_private.can_write_org(uuid) from public, anon;
grant execute on function app_private.org_role(uuid), app_private.is_org_member(uuid), app_private.is_org_owner(uuid), app_private.can_manage_org(uuid), app_private.can_write_org(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members enable row level security;
alter table public.organization_members force row level security;
alter table public.projects enable row level security;
alter table public.projects force row level security;

create policy profiles_select_self on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy organizations_select_member_or_creator on public.organizations for select to authenticated using (created_by = (select auth.uid()) or app_private.is_org_member(id));
create policy organizations_insert_self on public.organizations for insert to authenticated with check (created_by = (select auth.uid()));
create policy organizations_update_admin on public.organizations for update to authenticated using (app_private.can_manage_org(id)) with check (app_private.can_manage_org(id));
create policy organizations_delete_owner on public.organizations for delete to authenticated using (app_private.is_org_owner(id));

create policy organization_members_select_same_org on public.organization_members for select to authenticated using (user_id = (select auth.uid()) or app_private.is_org_member(organization_id));
create policy organization_members_insert_initial_owner_or_admin on public.organization_members for insert to authenticated with check (
  (user_id = (select auth.uid()) and role = 'owner' and exists (
    select 1 from public.organizations o where o.id = organization_members.organization_id and o.created_by = (select auth.uid())
  ))
  or (app_private.can_manage_org(organization_id) and role in ('admin','member','viewer'))
);

create policy projects_select_member on public.projects for select to authenticated using (app_private.is_org_member(organization_id));
create policy projects_insert_writer on public.projects for insert to authenticated with check (created_by = (select auth.uid()) and app_private.can_write_org(organization_id));
create policy projects_update_writer on public.projects for update to authenticated using (app_private.can_write_org(organization_id)) with check (app_private.can_write_org(organization_id));
create policy projects_delete_admin on public.projects for delete to authenticated using (app_private.can_manage_org(organization_id));

revoke all on table public.profiles, public.organizations, public.organization_members, public.projects from anon, authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, delete on table public.organizations to authenticated;
grant select, insert on table public.organization_members to authenticated;
grant select, insert, delete on table public.projects to authenticated;
