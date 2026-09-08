create or replace function app_private.mirror_stripe_subscription_provider_registry()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.billing_provider_external_subscriptions(
    organization_id,billing_price_id,provider_key,livemode,external_customer_id,external_subscription_id,provider_status,
    cancel_at_period_end,current_period_start,current_period_end,provider_created_at,last_provider_event_at,last_synced_at
  ) values(
    new.organization_id,new.billing_price_id,'stripe',new.livemode,new.provider_customer_id,new.provider_subscription_id,new.provider_status,
    new.cancel_at_period_end,new.current_period_start,new.current_period_end,new.provider_created_at,new.last_provider_event_at,new.last_synced_at
  )
  on conflict(provider_key,livemode,external_subscription_id) do update set
    billing_price_id=excluded.billing_price_id,
    external_customer_id=excluded.external_customer_id,
    provider_status=excluded.provider_status,
    cancel_at_period_end=excluded.cancel_at_period_end,
    current_period_start=excluded.current_period_start,
    current_period_end=excluded.current_period_end,
    provider_created_at=coalesce(public.billing_provider_external_subscriptions.provider_created_at,excluded.provider_created_at),
    last_provider_event_at=excluded.last_provider_event_at,
    last_synced_at=excluded.last_synced_at,
    updated_at=now();
  return new;
end;
$$;

revoke all on function app_private.mirror_stripe_subscription_provider_registry() from public,anon,authenticated,service_role;

drop trigger if exists billing_provider_subscriptions_mirror_registry on public.billing_provider_subscriptions;
create trigger billing_provider_subscriptions_mirror_registry
after insert or update on public.billing_provider_subscriptions
for each row execute function app_private.mirror_stripe_subscription_provider_registry();

insert into public.billing_provider_external_subscriptions(
  organization_id,billing_price_id,provider_key,livemode,external_customer_id,external_subscription_id,provider_status,
  cancel_at_period_end,current_period_start,current_period_end,provider_created_at,last_provider_event_at,last_synced_at
)
select organization_id,billing_price_id,'stripe',livemode,provider_customer_id,provider_subscription_id,provider_status,
       cancel_at_period_end,current_period_start,current_period_end,provider_created_at,last_provider_event_at,last_synced_at
from public.billing_provider_subscriptions
on conflict(provider_key,livemode,external_subscription_id) do nothing;

create or replace function app_private.get_organization_provider_billing_state(p_organization_id uuid,p_livemode boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not app_private.is_org_member(p_organization_id) then
    raise exception 'organization access denied' using errcode='42501';
  end if;

  select jsonb_build_object(
    'organization_id',p_organization_id,
    'livemode',p_livemode,
    'can_manage_billing',app_private.can_manage_org(p_organization_id),
    'subscriptions',coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider_key',s.provider_key,
        'external_subscription_id',s.external_subscription_id,
        'provider_status',s.provider_status,
        'cancel_at_period_end',s.cancel_at_period_end,
        'current_period_start',s.current_period_start,
        'current_period_end',s.current_period_end,
        'plan_key',p.plan_key,
        'plan_name',p.name,
        'price_key',bp.price_key,
        'currency',bp.currency,
        'unit_amount_minor',bp.unit_amount_minor,
        'billing_interval',bp.billing_interval
      ) order by s.last_synced_at desc)
      from public.billing_provider_external_subscriptions s
      join public.billing_prices bp on bp.id=s.billing_price_id
      join public.billing_plans p on p.id=bp.plan_id
      where s.organization_id=p_organization_id and s.livemode=p_livemode
        and lower(s.provider_status) not in ('cancelled','canceled','expired','incomplete_expired')
    ),'[]'::jsonb),
    'checkout_options',coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider_key',m.provider_key,
        'price_key',bp.price_key,
        'plan_key',p.plan_key,
        'plan_name',p.name,
        'currency',bp.currency,
        'unit_amount_minor',bp.unit_amount_minor,
        'billing_interval',bp.billing_interval,
        'interval_count',bp.interval_count
      ) order by p.sort_order,m.provider_key,bp.sort_order,bp.price_key)
      from public.billing_provider_plan_mappings m
      join public.billing_prices bp on bp.id=m.billing_price_id and bp.status='active'
      join public.billing_plans p on p.id=bp.plan_id and p.status='active'
      join public.billing_provider_connections c on c.provider_key=m.provider_key and c.livemode=m.livemode and c.connection_status='verified'
      where m.livemode=p_livemode and m.status='active' and m.provider_key in ('stripe','paypal')
    ),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.get_organization_provider_billing_state(organization_id uuid,livemode boolean)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$ select app_private.get_organization_provider_billing_state(organization_id,livemode); $$;

revoke all on function app_private.get_organization_provider_billing_state(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_organization_provider_billing_state(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.get_organization_provider_billing_state(uuid,boolean) to authenticated;
grant execute on function public.get_organization_provider_billing_state(uuid,boolean) to authenticated;
