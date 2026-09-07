revoke all on table public.profiles from anon, authenticated;
revoke all on table public.organizations from anon, authenticated;
revoke all on table public.organization_members from anon, authenticated;
revoke all on table public.projects from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;

grant select, delete on table public.organizations to authenticated;
grant insert (name, slug, created_by) on table public.organizations to authenticated;
grant update (name, slug) on table public.organizations to authenticated;

grant select on table public.organization_members to authenticated;
grant insert (organization_id, user_id, role) on table public.organization_members to authenticated;

grant select, delete on table public.projects to authenticated;
grant insert (organization_id, name, description, status, created_by) on table public.projects to authenticated;
grant update (name, description, status) on table public.projects to authenticated;

create or replace function public.create_organization(org_name text, org_slug text)
returns public.organizations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_org public.organizations;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (trim(org_name), lower(trim(org_slug)), caller_id)
  returning * into new_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (new_org.id, caller_id, 'owner');

  return new_org;
end;
$$;

revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
