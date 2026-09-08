create or replace function app_private.authorize_platform_billing_configuration()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform app_private.require_platform_admin_aal2();
  return true;
end;
$$;

create or replace function public.authorize_platform_billing_configuration()
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.authorize_platform_billing_configuration();
$$;

revoke all on function app_private.authorize_platform_billing_configuration() from public,anon,authenticated,service_role;
revoke all on function public.authorize_platform_billing_configuration() from public,anon,authenticated,service_role;

grant execute on function app_private.authorize_platform_billing_configuration() to authenticated;
grant execute on function public.authorize_platform_billing_configuration() to authenticated;

comment on function public.authorize_platform_billing_configuration() is
  'Platform-admin + AAL2 authorization gate used before server-side Stripe product/price configuration.';
