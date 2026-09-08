alter table public.billing_provider_subscriptions
  add column last_provider_event_at timestamptz;

create index billing_provider_subscriptions_event_order_idx
  on public.billing_provider_subscriptions(provider, livemode, provider_subscription_id, last_provider_event_at desc);

drop function if exists public.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz);
drop function if exists app_private.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz);

create or replace function app_private.sync_stripe_subscription(
  p_livemode boolean,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_provider_price_id text,
  p_provider_status text,
  p_cancel_at_period_end boolean,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at timestamptz,
  p_latest_invoice_id text,
  p_provider_created_at timestamptz,
  p_event_created_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_org uuid;
  target_price uuid;
  target_plan uuid;
  target_id uuid;
  free_plan uuid;
  operational_status text;
  existing public.billing_provider_subscriptions%rowtype;
begin
  select organization_id into target_org
  from public.billing_provider_customers
  where provider='stripe' and livemode=p_livemode and provider_customer_id=p_provider_customer_id;
  if target_org is null then raise exception 'stripe customer mapping not found'; end if;

  select pp.billing_price_id, bp.plan_id into target_price, target_plan
  from public.billing_provider_prices pp
  join public.billing_prices bp on bp.id=pp.billing_price_id
  where pp.provider='stripe' and pp.livemode=p_livemode and pp.provider_price_id=p_provider_price_id and pp.status='active';
  if target_price is null then raise exception 'stripe price mapping not found'; end if;
  if p_provider_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused') then raise exception 'unsupported stripe subscription status'; end if;
  if p_event_created_at is null then raise exception 'stripe event timestamp is required'; end if;

  select * into existing
  from public.billing_provider_subscriptions
  where provider='stripe' and livemode=p_livemode and provider_subscription_id=p_provider_subscription_id
  for update;

  if found and existing.last_provider_event_at is not null and existing.last_provider_event_at > p_event_created_at then
    return existing.id;
  end if;

  insert into public.billing_provider_subscriptions(
    organization_id,billing_price_id,provider,livemode,provider_customer_id,provider_subscription_id,provider_status,
    cancel_at_period_end,current_period_start,current_period_end,cancel_at,latest_invoice_id,provider_created_at,last_provider_event_at,last_synced_at
  ) values(
    target_org,target_price,'stripe',p_livemode,p_provider_customer_id,p_provider_subscription_id,p_provider_status,
    coalesce(p_cancel_at_period_end,false),p_current_period_start,p_current_period_end,p_cancel_at,p_latest_invoice_id,p_provider_created_at,p_event_created_at,now()
  )
  on conflict (provider,livemode,provider_subscription_id) do update
    set billing_price_id=excluded.billing_price_id,
        provider_customer_id=excluded.provider_customer_id,
        provider_status=excluded.provider_status,
        cancel_at_period_end=excluded.cancel_at_period_end,
        current_period_start=excluded.current_period_start,
        current_period_end=excluded.current_period_end,
        cancel_at=excluded.cancel_at,
        latest_invoice_id=excluded.latest_invoice_id,
        provider_created_at=coalesce(public.billing_provider_subscriptions.provider_created_at,excluded.provider_created_at),
        last_provider_event_at=excluded.last_provider_event_at,
        last_synced_at=now(),
        updated_at=now()
  returning id into target_id;

  if p_provider_status in ('canceled','incomplete_expired') then
    select id into free_plan from public.billing_plans where plan_key='free' and status='active';
    if free_plan is null then raise exception 'active free fallback plan not configured'; end if;
    update public.organization_subscriptions
    set plan_id=free_plan,status='active',assignment_source='provider',current_period_start=null,current_period_end=null,cancel_at=null,updated_at=now()
    where organization_id=target_org;
  else
    operational_status := case p_provider_status
      when 'trialing' then 'trialing'
      when 'active' then 'active'
      when 'past_due' then 'past_due'
      when 'unpaid' then 'past_due'
      when 'paused' then 'paused'
      else 'incomplete'
    end;
    update public.organization_subscriptions
    set plan_id=target_plan,status=operational_status,assignment_source='provider',
        current_period_start=p_current_period_start,current_period_end=p_current_period_end,cancel_at=p_cancel_at,updated_at=now()
    where organization_id=target_org;
  end if;

  return target_id;
end;
$$;

create or replace function public.sync_stripe_subscription(
  livemode boolean,
  provider_customer_id text,
  provider_subscription_id text,
  provider_price_id text,
  provider_status text,
  cancel_at_period_end boolean,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  latest_invoice_id text,
  provider_created_at timestamptz,
  event_created_at timestamptz
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.sync_stripe_subscription(
    livemode,provider_customer_id,provider_subscription_id,provider_price_id,provider_status,
    cancel_at_period_end,current_period_start,current_period_end,cancel_at,latest_invoice_id,
    provider_created_at,event_created_at
  );
$$;

revoke all on function app_private.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;

grant execute on function app_private.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz,timestamptz) to service_role;
grant execute on function public.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz,timestamptz) to service_role;
