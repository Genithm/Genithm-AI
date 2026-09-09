-- Platform Admin Provisioning V1
-- One-time, service-role-only bootstrap for the first platform administrator.
-- Browser/user sessions cannot call this function directly.

create or replace function app_private.bootstrap_first_platform_admin(
  p_target_user_id uuid,
  p_reason text default 'initial_platform_admin_bootstrap'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_reason text := trim(coalesce(p_reason, ''));
begin
  if p_target_user_id is null then
    raise exception 'target user id is required' using errcode = '22023';
  end if;

  if char_length(normalized_reason) < 3 or char_length(normalized_reason) > 500 then
    raise exception 'bootstrap reason must be between 3 and 500 characters' using errcode = '22023';
  end if;

  -- Idempotent only for the already-provisioned target. Once any other admin
  -- exists, this bootstrap path is permanently closed.
  if exists (
    select 1
    from app_private.platform_admins as platform_admin
    where platform_admin.user_id = p_target_user_id
      and platform_admin.role = 'platform_admin'
  ) then
    return p_target_user_id;
  end if;

  if exists (select 1 from app_private.platform_admins) then
    raise exception 'initial platform admin bootstrap is closed' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users as account
    where account.id = p_target_user_id
      and account.email_confirmed_at is not null
  ) then
    raise exception 'confirmed target user was not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from auth.mfa_factors as factor
    where factor.user_id = p_target_user_id
      and factor.status::text = 'verified'
  ) then
    raise exception 'verified MFA factor is required before platform admin bootstrap' using errcode = '42501';
  end if;

  insert into app_private.platform_admins (
    user_id,
    role,
    granted_at,
    granted_by,
    reason
  ) values (
    p_target_user_id,
    'platform_admin',
    now(),
    p_target_user_id,
    normalized_reason
  );

  return p_target_user_id;
end;
$$;

revoke all on function app_private.bootstrap_first_platform_admin(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function app_private.bootstrap_first_platform_admin(uuid, text)
to service_role;

create or replace function public.bootstrap_first_platform_admin(
  target_user_id uuid,
  reason text default 'initial_platform_admin_bootstrap'
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.bootstrap_first_platform_admin(target_user_id, reason);
$$;

revoke all on function public.bootstrap_first_platform_admin(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_first_platform_admin(uuid, text)
to service_role;

comment on function public.bootstrap_first_platform_admin(uuid, text) is
  'Service-role-only one-time bootstrap for the first confirmed Genithm platform admin. Requires a verified MFA factor and closes once any platform admin exists.';
