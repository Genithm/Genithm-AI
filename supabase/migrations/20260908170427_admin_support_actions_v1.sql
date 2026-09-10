create table app_private.platform_support_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete set null,
  target_project_id uuid references public.projects(id) on delete set null,
  category text not null,
  title text not null,
  initial_note text not null,
  status text not null default 'open',
  opened_by uuid not null references auth.users(id) on delete restrict,
  opened_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text,
  constraint platform_support_cases_category_check check (category in ('account','access','billing','scientific_job','other')),
  constraint platform_support_cases_title_length check (char_length(title) between 3 and 160),
  constraint platform_support_cases_initial_note_length check (char_length(initial_note) between 3 and 4000),
  constraint platform_support_cases_status_check check (status in ('open','resolved')),
  constraint platform_support_cases_resolution_note_length check (resolution_note is null or char_length(resolution_note) between 3 and 4000),
  constraint platform_support_cases_resolution_state_check check (
    (status = 'open' and resolved_by is null and resolved_at is null and resolution_note is null)
    or
    (status = 'resolved' and resolved_by is not null and resolved_at is not null and resolution_note is not null)
  )
);

create index platform_support_cases_org_status_opened_idx
  on app_private.platform_support_cases (organization_id, status, opened_at desc);
create index platform_support_cases_target_user_idx
  on app_private.platform_support_cases (target_user_id)
  where target_user_id is not null;

alter table app_private.platform_support_cases enable row level security;
alter table app_private.platform_support_cases force row level security;
revoke all on table app_private.platform_support_cases from public, anon, authenticated, service_role;

create policy platform_support_cases_explicit_deny
on app_private.platform_support_cases
as restrictive
for all
to public
using (false)
with check (false);

create or replace function app_private.require_platform_admin_aal2()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_aal text := coalesce((auth.jwt() ->> 'aal'), 'aal1');
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if caller_aal <> 'aal2' then
    raise exception 'aal2 authentication required for admin support actions' using errcode = '42501';
  end if;

  return caller_id;
end;
$$;

revoke all on function app_private.require_platform_admin_aal2() from public, anon, authenticated, service_role;
grant execute on function app_private.require_platform_admin_aal2() to authenticated;

create or replace function app_private.lookup_platform_support_user(p_exact_email text)
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  display_name text,
  organization_count bigint,
  project_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(trim(coalesce(p_exact_email, '')));
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if char_length(normalized_email) < 3 or char_length(normalized_email) > 320 or normalized_email not like '%@%' then
    raise exception 'valid exact email is required' using errcode = '22023';
  end if;

  return query
  select
    account.id,
    account.email,
    account.created_at,
    account.last_sign_in_at,
    account.email_confirmed_at,
    profile.display_name,
    (select count(*) from public.organization_members as membership where membership.user_id = account.id),
    (select count(distinct project.id)
       from public.organization_members as membership
       join public.projects as project on project.organization_id = membership.organization_id
      where membership.user_id = account.id)
  from auth.users as account
  left join public.profiles as profile on profile.id = account.id
  where lower(account.email) = normalized_email
  limit 1;
end;
$$;

revoke all on function app_private.lookup_platform_support_user(text) from public, anon, authenticated, service_role;
grant execute on function app_private.lookup_platform_support_user(text) to authenticated;

create or replace function app_private.get_platform_support_user_memberships(p_user_id uuid)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  membership_role text,
  project_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  return query
  select
    organization.id,
    organization.name,
    organization.slug,
    membership.role,
    (select count(*) from public.projects as project where project.organization_id = organization.id)
  from public.organization_members as membership
  join public.organizations as organization on organization.id = membership.organization_id
  where membership.user_id = p_user_id
  order by organization.created_at desc, organization.id
  limit 100;
end;
$$;

revoke all on function app_private.get_platform_support_user_memberships(uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.get_platform_support_user_memberships(uuid) to authenticated;

create or replace function app_private.get_platform_support_cases(
  p_organization_id uuid,
  p_page_size integer,
  p_page_offset integer
)
returns table (
  support_case_id uuid,
  organization_id uuid,
  target_user_id uuid,
  target_project_id uuid,
  category text,
  title text,
  initial_note text,
  status text,
  opened_by uuid,
  opened_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;

  if p_page_size < 1 or p_page_size > 100 then
    raise exception 'page size must be between 1 and 100' using errcode = '22023';
  end if;

  if p_page_offset < 0 then
    raise exception 'page offset must be non-negative' using errcode = '22023';
  end if;

  return query
  select
    support_case.id,
    support_case.organization_id,
    support_case.target_user_id,
    support_case.target_project_id,
    support_case.category,
    support_case.title,
    support_case.initial_note,
    support_case.status,
    support_case.opened_by,
    support_case.opened_at,
    support_case.resolved_by,
    support_case.resolved_at,
    support_case.resolution_note
  from app_private.platform_support_cases as support_case
  where support_case.organization_id = p_organization_id
  order by support_case.opened_at desc, support_case.id
  limit p_page_size
  offset p_page_offset;
end;
$$;

revoke all on function app_private.get_platform_support_cases(uuid, integer, integer) from public, anon, authenticated, service_role;
grant execute on function app_private.get_platform_support_cases(uuid, integer, integer) to authenticated;

create or replace function app_private.create_platform_support_case(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_target_project_id uuid,
  p_category text,
  p_title text,
  p_initial_note text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.require_platform_admin_aal2();
  support_case_id uuid;
  normalized_category text := lower(trim(coalesce(p_category, '')));
  normalized_title text := trim(coalesce(p_title, ''));
  normalized_note text := trim(coalesce(p_initial_note, ''));
begin
  if p_organization_id is null or not exists (
    select 1 from public.organizations as organization where organization.id = p_organization_id
  ) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  if normalized_category not in ('account','access','billing','scientific_job','other') then
    raise exception 'invalid support category' using errcode = '22023';
  end if;

  if char_length(normalized_title) < 3 or char_length(normalized_title) > 160 then
    raise exception 'title must be between 3 and 160 characters' using errcode = '22023';
  end if;

  if char_length(normalized_note) < 3 or char_length(normalized_note) > 4000 then
    raise exception 'initial note must be between 3 and 4000 characters' using errcode = '22023';
  end if;

  if p_target_user_id is not null and not exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_target_user_id
  ) then
    raise exception 'target user is not a member of the organization' using errcode = '22023';
  end if;

  if p_target_project_id is not null and not exists (
    select 1
    from public.projects as project
    where project.id = p_target_project_id
      and project.organization_id = p_organization_id
  ) then
    raise exception 'target project does not belong to the organization' using errcode = '22023';
  end if;

  insert into app_private.platform_support_cases (
    organization_id,
    target_user_id,
    target_project_id,
    category,
    title,
    initial_note,
    opened_by
  ) values (
    p_organization_id,
    p_target_user_id,
    p_target_project_id,
    normalized_category,
    normalized_title,
    normalized_note,
    caller_id
  )
  returning id into support_case_id;

  perform app_private.append_audit_event(
    p_organization_id,
    p_target_project_id,
    caller_id,
    'user',
    'PLATFORM_SUPPORT_CASE_CREATED',
    'platform_support_case',
    support_case_id::text,
    'created',
    jsonb_strip_nulls(jsonb_build_object(
      'category', normalized_category,
      'target_user_id', p_target_user_id,
      'target_project_id', p_target_project_id
    ))
  );

  return support_case_id;
end;
$$;

revoke all on function app_private.create_platform_support_case(uuid, uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function app_private.create_platform_support_case(uuid, uuid, uuid, text, text, text) to authenticated;

create or replace function app_private.resolve_platform_support_case(
  p_support_case_id uuid,
  p_resolution_note text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.require_platform_admin_aal2();
  support_case app_private.platform_support_cases%rowtype;
  normalized_note text := trim(coalesce(p_resolution_note, ''));
begin
  if p_support_case_id is null then
    raise exception 'support case id is required' using errcode = '22023';
  end if;

  if char_length(normalized_note) < 3 or char_length(normalized_note) > 4000 then
    raise exception 'resolution note must be between 3 and 4000 characters' using errcode = '22023';
  end if;

  select * into support_case
  from app_private.platform_support_cases
  where id = p_support_case_id
  for update;

  if not found then
    raise exception 'support case not found' using errcode = 'P0002';
  end if;

  if support_case.status = 'resolved' then
    return support_case.id;
  end if;

  update app_private.platform_support_cases
  set status = 'resolved',
      resolved_by = caller_id,
      resolved_at = now(),
      resolution_note = normalized_note
  where id = support_case.id;

  perform app_private.append_audit_event(
    support_case.organization_id,
    support_case.target_project_id,
    caller_id,
    'user',
    'PLATFORM_SUPPORT_CASE_RESOLVED',
    'platform_support_case',
    support_case.id::text,
    'completed',
    jsonb_strip_nulls(jsonb_build_object(
      'category', support_case.category,
      'target_user_id', support_case.target_user_id,
      'target_project_id', support_case.target_project_id
    ))
  );

  return support_case.id;
end;
$$;

revoke all on function app_private.resolve_platform_support_case(uuid, text) from public, anon, authenticated, service_role;
grant execute on function app_private.resolve_platform_support_case(uuid, text) to authenticated;

create or replace function public.lookup_platform_support_user(exact_email text)
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz,
  display_name text,
  organization_count bigint,
  project_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.lookup_platform_support_user(exact_email);
$$;

create or replace function public.get_platform_support_user_memberships(user_id uuid)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  membership_role text,
  project_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.get_platform_support_user_memberships(user_id);
$$;

create or replace function public.get_platform_support_cases(
  organization_id uuid,
  page_size integer default 50,
  page_offset integer default 0
)
returns table (
  support_case_id uuid,
  organization_id uuid,
  target_user_id uuid,
  target_project_id uuid,
  category text,
  title text,
  initial_note text,
  status text,
  opened_by uuid,
  opened_at timestamptz,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.get_platform_support_cases(organization_id, page_size, page_offset);
$$;

create or replace function public.create_platform_support_case(
  organization_id uuid,
  target_user_id uuid default null,
  target_project_id uuid default null,
  category text default 'other',
  title text default '',
  initial_note text default ''
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.create_platform_support_case(
    organization_id,
    target_user_id,
    target_project_id,
    category,
    title,
    initial_note
  );
$$;

create or replace function public.resolve_platform_support_case(
  support_case_id uuid,
  resolution_note text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.resolve_platform_support_case(support_case_id, resolution_note);
$$;

revoke all on function public.lookup_platform_support_user(text) from public, anon, authenticated, service_role;
revoke all on function public.get_platform_support_user_memberships(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_platform_support_cases(uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.create_platform_support_case(uuid, uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_platform_support_case(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.lookup_platform_support_user(text) to authenticated;
grant execute on function public.get_platform_support_user_memberships(uuid) to authenticated;
grant execute on function public.get_platform_support_cases(uuid, integer, integer) to authenticated;
grant execute on function public.create_platform_support_case(uuid, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.resolve_platform_support_case(uuid, text) to authenticated;

comment on table app_private.platform_support_cases is
  'Private Genithm platform support case registry. Support metadata only; no scientific payloads, credentials, password material, or raw billing instruments.';
comment on function public.lookup_platform_support_user(text) is
  'Platform-admin-only exact email lookup for support. Deliberately no fuzzy search or bulk user listing.';
comment on function public.create_platform_support_case(uuid, uuid, uuid, text, text, text) is
  'Platform-admin + AAL2-only support case creation. Does not alter user access, organization membership, scientific jobs, or billing state.';
comment on function public.resolve_platform_support_case(uuid, text) is
  'Platform-admin + AAL2-only support case resolution. Writes an immutable hash-chained audit event.';
