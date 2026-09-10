create or replace function app_private.get_provider_subscription_management_context(
  p_organization_id uuid,
  p_provider_key text,
  p_external_subscription_id text,
  p_livemode boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not app_private.can_manage_org(p_organization_id) then
    raise exception 'billing manager access required' using errcode='42501';
  end if;

  select jsonb_build_object(
    'organization_id',s.organization_id,
    'provider_key',s.provider_key,
    'external_subscription_id',s.external_subscription_id,
    'provider_status',s.provider_status,
    'external_customer_id',s.external_customer_id,
    'external_price_id',m.external_price_id,
    'plan_key',p.plan_key,
    'price_key',bp.price_key
  ) into result
  from public.billing_provider_external_subscriptions s
  join public.billing_prices bp on bp.id=s.billing_price_id
  join public.billing_plans p on p.id=bp.plan_id
  join public.billing_provider_plan_mappings m
    on m.billing_price_id=s.billing_price_id and m.provider_key=s.provider_key and m.livemode=s.livemode
  where s.organization_id=p_organization_id
    and s.provider_key=p_provider_key
    and s.external_subscription_id=p_external_subscription_id
    and s.livemode=p_livemode;

  if result is null then raise exception 'provider subscription not found' using errcode='P0002'; end if;
  return result;
end;
$$;

create or replace function public.get_provider_subscription_management_context(
  organization_id uuid,
  provider_key text,
  external_subscription_id text,
  livemode boolean
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select app_private.get_provider_subscription_management_context(organization_id,provider_key,external_subscription_id,livemode);
$$;

revoke all on function app_private.get_provider_subscription_management_context(uuid,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_provider_subscription_management_context(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.get_provider_subscription_management_context(uuid,text,text,boolean) to authenticated;
grant execute on function public.get_provider_subscription_management_context(uuid,text,text,boolean) to authenticated;
