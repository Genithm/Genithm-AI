-- Stripe Payment System V1
-- Provider state is normalized into Genithm. No card or bank-account payloads are stored.

create table public.billing_provider_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'stripe',
  livemode boolean not null,
  provider_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, livemode),
  unique (provider, livemode, provider_customer_id),
  constraint billing_provider_customers_provider check (provider = 'stripe'),
  constraint billing_provider_customers_id_length check (char_length(provider_customer_id) between 4 and 255)
);

create table public.billing_provider_prices (
  id uuid primary key default gen_random_uuid(),
  billing_price_id uuid not null references public.billing_prices(id) on delete restrict,
  provider text not null default 'stripe',
  livemode boolean not null,
  provider_product_id text not null,
  provider_price_id text not null,
  lookup_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (billing_price_id, provider, livemode),
  unique (provider, livemode, provider_price_id),
  unique (provider, livemode, lookup_key),
  constraint billing_provider_prices_provider check (provider = 'stripe'),
  constraint billing_provider_prices_status check (status in ('active','archived')),
  constraint billing_provider_prices_lookup_length check (char_length(lookup_key) between 3 and 120)
);

create table public.billing_provider_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  billing_price_id uuid not null references public.billing_prices(id) on delete restrict,
  provider text not null default 'stripe',
  livemode boolean not null,
  provider_customer_id text not null,
  provider_subscription_id text not null,
  provider_status text not null,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  latest_invoice_id text,
  provider_created_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, livemode, provider_subscription_id),
  constraint billing_provider_subscriptions_provider check (provider = 'stripe'),
  constraint billing_provider_subscriptions_status check (provider_status in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')),
  constraint billing_provider_subscriptions_period check (current_period_start is null or current_period_end is null or current_period_start <= current_period_end)
);

create table public.billing_provider_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'stripe',
  livemode boolean not null,
  provider_customer_id text not null,
  provider_invoice_id text not null,
  provider_subscription_id text,
  provider_payment_intent_id text,
  status text,
  currency text not null,
  amount_due_minor bigint not null default 0,
  amount_paid_minor bigint not null default 0,
  amount_remaining_minor bigint not null default 0,
  hosted_invoice_url text,
  invoice_pdf_url text,
  period_start timestamptz,
  period_end timestamptz,
  provider_created_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, livemode, provider_invoice_id),
  constraint billing_provider_invoices_provider check (provider = 'stripe'),
  constraint billing_provider_invoices_currency check (currency ~ '^[a-z]{3}$'),
  constraint billing_provider_invoices_amounts check (amount_due_minor >= 0 and amount_paid_minor >= 0 and amount_remaining_minor >= 0)
);

create table public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  livemode boolean not null,
  provider_event_id text not null,
  event_type text not null,
  provider_created_at timestamptz not null,
  payload_sha256 text not null,
  processing_status text not null default 'received',
  attempt_count integer not null default 1,
  error_code text,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, livemode, provider_event_id),
  constraint billing_provider_events_provider check (provider = 'stripe'),
  constraint billing_provider_events_digest check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint billing_provider_events_status check (processing_status in ('received','processed','ignored','failed')),
  constraint billing_provider_events_attempts check (attempt_count >= 1),
  constraint billing_provider_events_error_length check (error_code is null or char_length(error_code) <= 120)
);

create table public.billing_provider_payouts (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  livemode boolean not null,
  provider_payout_id text not null,
  status text not null,
  currency text not null,
  amount_minor bigint not null,
  arrival_date date,
  method text,
  automatic boolean,
  provider_created_at timestamptz,
  last_synced_at timestamptz not null default now(),
  unique (provider, livemode, provider_payout_id),
  constraint billing_provider_payouts_provider check (provider = 'stripe'),
  constraint billing_provider_payouts_currency check (currency ~ '^[a-z]{3}$'),
  constraint billing_provider_payouts_amount check (amount_minor >= 0)
);

create table public.billing_provider_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  provider text not null default 'stripe',
  livemode boolean not null,
  provider_refund_id text,
  provider_invoice_id text,
  provider_payment_intent_id text not null,
  status text not null default 'pending_provider',
  currency text not null,
  amount_minor bigint not null,
  reason text,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (provider, livemode, provider_refund_id),
  constraint billing_provider_refunds_provider check (provider = 'stripe'),
  constraint billing_provider_refunds_currency check (currency ~ '^[a-z]{3}$'),
  constraint billing_provider_refunds_amount check (amount_minor > 0),
  constraint billing_provider_refunds_status check (status in ('pending_provider','pending','succeeded','failed','canceled','requires_action')),
  constraint billing_provider_refunds_reason check (reason is null or reason in ('duplicate','fraudulent','requested_by_customer','other'))
);

create table public.billing_provider_disputes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  provider text not null default 'stripe',
  livemode boolean not null,
  provider_dispute_id text not null,
  provider_charge_id text,
  status text not null,
  reason text,
  currency text not null,
  amount_minor bigint not null,
  provider_created_at timestamptz,
  last_synced_at timestamptz not null default now(),
  unique (provider, livemode, provider_dispute_id),
  constraint billing_provider_disputes_provider check (provider = 'stripe'),
  constraint billing_provider_disputes_currency check (currency ~ '^[a-z]{3}$'),
  constraint billing_provider_disputes_amount check (amount_minor >= 0)
);

create index billing_provider_customers_org_idx on public.billing_provider_customers(organization_id);
create index billing_provider_prices_price_idx on public.billing_provider_prices(billing_price_id);
create index billing_provider_subscriptions_org_status_idx on public.billing_provider_subscriptions(organization_id, provider_status, current_period_end desc);
create index billing_provider_subscriptions_price_idx on public.billing_provider_subscriptions(billing_price_id);
create index billing_provider_invoices_org_created_idx on public.billing_provider_invoices(organization_id, provider_created_at desc);
create index billing_provider_invoices_subscription_idx on public.billing_provider_invoices(provider_subscription_id) where provider_subscription_id is not null;
create index billing_provider_invoices_payment_intent_idx on public.billing_provider_invoices(provider_payment_intent_id) where provider_payment_intent_id is not null;
create index billing_provider_events_status_received_idx on public.billing_provider_events(processing_status, last_received_at desc);
create index billing_provider_refunds_org_requested_idx on public.billing_provider_refunds(organization_id, requested_at desc) where organization_id is not null;
create index billing_provider_refunds_payment_intent_idx on public.billing_provider_refunds(provider_payment_intent_id);
create index billing_provider_disputes_org_idx on public.billing_provider_disputes(organization_id) where organization_id is not null;

create trigger billing_provider_customers_set_updated_at before update on public.billing_provider_customers for each row execute function app_private.set_updated_at();
create trigger billing_provider_prices_set_updated_at before update on public.billing_provider_prices for each row execute function app_private.set_updated_at();
create trigger billing_provider_subscriptions_set_updated_at before update on public.billing_provider_subscriptions for each row execute function app_private.set_updated_at();
create trigger billing_provider_invoices_set_updated_at before update on public.billing_provider_invoices for each row execute function app_private.set_updated_at();

alter table public.billing_provider_customers enable row level security;
alter table public.billing_provider_customers force row level security;
alter table public.billing_provider_prices enable row level security;
alter table public.billing_provider_prices force row level security;
alter table public.billing_provider_subscriptions enable row level security;
alter table public.billing_provider_subscriptions force row level security;
alter table public.billing_provider_invoices enable row level security;
alter table public.billing_provider_invoices force row level security;
alter table public.billing_provider_events enable row level security;
alter table public.billing_provider_events force row level security;
alter table public.billing_provider_payouts enable row level security;
alter table public.billing_provider_payouts force row level security;
alter table public.billing_provider_refunds enable row level security;
alter table public.billing_provider_refunds force row level security;
alter table public.billing_provider_disputes enable row level security;
alter table public.billing_provider_disputes force row level security;

create policy billing_provider_customers_deny_direct on public.billing_provider_customers as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_provider_prices_deny_direct on public.billing_provider_prices as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_provider_subscriptions_deny_direct on public.billing_provider_subscriptions as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_provider_invoices_deny_direct on public.billing_provider_invoices as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_provider_events_deny_direct on public.billing_provider_events as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_provider_payouts_deny_direct on public.billing_provider_payouts as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_provider_refunds_deny_direct on public.billing_provider_refunds as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_provider_disputes_deny_direct on public.billing_provider_disputes as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.billing_provider_customers, public.billing_provider_prices, public.billing_provider_subscriptions, public.billing_provider_invoices, public.billing_provider_events, public.billing_provider_payouts, public.billing_provider_refunds, public.billing_provider_disputes from public, anon, authenticated, service_role;

create or replace function app_private.get_organization_billing_state(p_organization_id uuid, p_livemode boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not app_private.is_org_member(p_organization_id) then
    raise exception 'organization access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'organization_id', p_organization_id,
    'livemode', p_livemode,
    'can_manage_billing', app_private.can_manage_org(p_organization_id),
    'provider_customer_configured', exists(
      select 1 from public.billing_provider_customers c
      where c.organization_id = p_organization_id and c.provider = 'stripe' and c.livemode = p_livemode
    ),
    'provider_catalog_ready', exists(
      select 1
      from public.billing_provider_prices pp
      join public.billing_prices bp on bp.id = pp.billing_price_id and bp.status = 'active'
      join public.billing_plans p on p.id = bp.plan_id and p.status = 'active' and p.billing_model = 'subscription'
      where pp.provider = 'stripe' and pp.livemode = p_livemode and pp.status = 'active'
    ),
    'subscription', (
      select jsonb_build_object(
        'provider_status', s.provider_status,
        'cancel_at_period_end', s.cancel_at_period_end,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'cancel_at', s.cancel_at,
        'provider_subscription_id', s.provider_subscription_id,
        'plan_name', p.name,
        'plan_key', p.plan_key,
        'price_key', bp.price_key
      )
      from public.billing_provider_subscriptions s
      join public.billing_prices bp on bp.id = s.billing_price_id
      join public.billing_plans p on p.id = bp.plan_id
      where s.organization_id = p_organization_id and s.provider = 'stripe' and s.livemode = p_livemode
      order by s.last_synced_at desc
      limit 1
    ),
    'checkout_options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'price_key', bp.price_key,
        'plan_key', p.plan_key,
        'plan_name', p.name,
        'currency', bp.currency,
        'unit_amount_minor', bp.unit_amount_minor,
        'billing_interval', bp.billing_interval,
        'interval_count', bp.interval_count
      ) order by p.sort_order, bp.sort_order, bp.price_key)
      from public.billing_provider_prices pp
      join public.billing_prices bp on bp.id = pp.billing_price_id and bp.status = 'active'
      join public.billing_plans p on p.id = bp.plan_id and p.status = 'active' and p.billing_model = 'subscription'
      where pp.provider = 'stripe' and pp.livemode = p_livemode and pp.status = 'active'
    ), '[]'::jsonb),
    'recent_invoices', coalesce((
      select jsonb_agg(invoice_row.payload order by invoice_row.created_at desc)
      from (
        select jsonb_build_object(
          'provider_invoice_id', i.provider_invoice_id,
          'status', i.status,
          'currency', i.currency,
          'amount_due_minor', i.amount_due_minor,
          'amount_paid_minor', i.amount_paid_minor,
          'amount_remaining_minor', i.amount_remaining_minor,
          'hosted_invoice_url', i.hosted_invoice_url,
          'invoice_pdf_url', i.invoice_pdf_url,
          'provider_created_at', i.provider_created_at
        ) as payload,
        i.provider_created_at as created_at
        from public.billing_provider_invoices i
        where i.organization_id = p_organization_id and i.provider = 'stripe' and i.livemode = p_livemode
        order by i.provider_created_at desc nulls last, i.created_at desc
        limit 12
      ) invoice_row
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function app_private.get_billing_checkout_context(p_organization_id uuid, p_price_key text, p_livemode boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not app_private.can_manage_org(p_organization_id) then
    raise exception 'billing manager access required' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.billing_provider_subscriptions s
    where s.organization_id = p_organization_id
      and s.provider = 'stripe'
      and s.livemode = p_livemode
      and s.provider_status in ('incomplete','trialing','active','past_due','unpaid','paused')
  ) then
    raise exception 'existing subscription must be managed through the billing portal' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'organization_id', p_organization_id,
    'provider_customer_id', c.provider_customer_id,
    'provider_price_id', pp.provider_price_id,
    'provider_product_id', pp.provider_product_id,
    'price_key', bp.price_key,
    'plan_key', p.plan_key,
    'plan_name', p.name,
    'currency', bp.currency,
    'unit_amount_minor', bp.unit_amount_minor,
    'billing_interval', bp.billing_interval,
    'interval_count', bp.interval_count
  ) into result
  from public.billing_prices bp
  join public.billing_plans p on p.id = bp.plan_id
  join public.billing_provider_prices pp on pp.billing_price_id = bp.id
  left join public.billing_provider_customers c
    on c.organization_id = p_organization_id and c.provider = 'stripe' and c.livemode = p_livemode
  where bp.price_key = p_price_key
    and bp.status = 'active'
    and p.status = 'active'
    and p.billing_model = 'subscription'
    and pp.provider = 'stripe'
    and pp.livemode = p_livemode
    and pp.status = 'active';

  if result is null then
    raise exception 'active checkout price is not configured' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function app_private.get_billing_portal_context(p_organization_id uuid, p_livemode boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not app_private.can_manage_org(p_organization_id) then
    raise exception 'billing manager access required' using errcode = '42501';
  end if;

  select jsonb_build_object('organization_id', p_organization_id, 'provider_customer_id', c.provider_customer_id)
  into result
  from public.billing_provider_customers c
  where c.organization_id = p_organization_id and c.provider = 'stripe' and c.livemode = p_livemode;

  if result is null then
    raise exception 'billing customer is not configured' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

create or replace function app_private.configure_stripe_price_mapping(
  p_plan_key text,
  p_price_key text,
  p_currency text,
  p_unit_amount_minor bigint,
  p_billing_interval text,
  p_interval_count integer,
  p_livemode boolean,
  p_provider_product_id text,
  p_provider_price_id text,
  p_lookup_key text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_plan public.billing_plans%rowtype;
  target_price_id uuid;
begin
  select * into target_plan from public.billing_plans where plan_key = p_plan_key for update;
  if not found or target_plan.billing_model <> 'subscription' or target_plan.plan_key = 'free' then
    raise exception 'subscription plan not found or not eligible for provider checkout';
  end if;
  if p_unit_amount_minor <= 0 then raise exception 'paid price amount must be positive'; end if;
  if lower(p_currency) !~ '^[a-z]{3}$' then raise exception 'invalid currency'; end if;
  if p_billing_interval not in ('month','year') or p_interval_count < 1 or p_interval_count > 12 then raise exception 'invalid billing interval'; end if;

  insert into public.billing_prices(plan_id, price_key, currency, unit_amount_minor, billing_interval, interval_count, status)
  values(target_plan.id, p_price_key, upper(p_currency), p_unit_amount_minor, p_billing_interval, p_interval_count, 'active')
  on conflict (price_key) do update
    set plan_id = excluded.plan_id,
        currency = excluded.currency,
        unit_amount_minor = excluded.unit_amount_minor,
        billing_interval = excluded.billing_interval,
        interval_count = excluded.interval_count,
        status = 'active',
        updated_at = now()
  returning id into target_price_id;

  insert into public.billing_provider_prices(billing_price_id, provider, livemode, provider_product_id, provider_price_id, lookup_key, status)
  values(target_price_id, 'stripe', p_livemode, p_provider_product_id, p_provider_price_id, p_lookup_key, 'active')
  on conflict (billing_price_id, provider, livemode) do update
    set provider_product_id = excluded.provider_product_id,
        provider_price_id = excluded.provider_price_id,
        lookup_key = excluded.lookup_key,
        status = 'active',
        updated_at = now();

  update public.billing_plans set status = 'active', updated_at = now() where id = target_plan.id;
  return target_price_id;
end;
$$;

create or replace function app_private.sync_stripe_customer(p_organization_id uuid, p_livemode boolean, p_provider_customer_id text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare target_id uuid;
begin
  if not exists(select 1 from public.organizations where id = p_organization_id) then raise exception 'organization not found'; end if;
  insert into public.billing_provider_customers(organization_id, provider, livemode, provider_customer_id)
  values(p_organization_id, 'stripe', p_livemode, p_provider_customer_id)
  on conflict (organization_id, provider, livemode) do update
    set provider_customer_id = excluded.provider_customer_id, updated_at = now()
  returning id into target_id;
  return target_id;
end;
$$;

create or replace function app_private.begin_stripe_event(p_livemode boolean, p_provider_event_id text, p_event_type text, p_provider_created_at timestamptz, p_payload_sha256 text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare existing public.billing_provider_events%rowtype;
begin
  select * into existing from public.billing_provider_events where provider='stripe' and livemode=p_livemode and provider_event_id=p_provider_event_id for update;
  if found then
    if existing.payload_sha256 <> p_payload_sha256 or existing.event_type <> p_event_type then raise exception 'provider event replay mismatch'; end if;
    update public.billing_provider_events set attempt_count=attempt_count+1, last_received_at=now() where id=existing.id;
    return existing.processing_status;
  end if;
  insert into public.billing_provider_events(provider, livemode, provider_event_id, event_type, provider_created_at, payload_sha256)
  values('stripe', p_livemode, p_provider_event_id, p_event_type, p_provider_created_at, p_payload_sha256);
  return 'received';
end;
$$;

create or replace function app_private.finish_stripe_event(p_livemode boolean, p_provider_event_id text, p_processing_status text, p_error_code text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_processing_status not in ('processed','ignored','failed') then raise exception 'invalid event completion status'; end if;
  update public.billing_provider_events
  set processing_status=p_processing_status,
      error_code=case when p_processing_status='failed' then left(coalesce(p_error_code,'provider_sync_failed'),120) else null end,
      processed_at=case when p_processing_status in ('processed','ignored') then now() else null end,
      last_received_at=now()
  where provider='stripe' and livemode=p_livemode and provider_event_id=p_provider_event_id;
  if not found then raise exception 'provider event not found'; end if;
end;
$$;

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
  p_provider_created_at timestamptz
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
begin
  select organization_id into target_org from public.billing_provider_customers
  where provider='stripe' and livemode=p_livemode and provider_customer_id=p_provider_customer_id;
  if target_org is null then raise exception 'stripe customer mapping not found'; end if;

  select pp.billing_price_id, bp.plan_id into target_price, target_plan
  from public.billing_provider_prices pp
  join public.billing_prices bp on bp.id=pp.billing_price_id
  where pp.provider='stripe' and pp.livemode=p_livemode and pp.provider_price_id=p_provider_price_id and pp.status='active';
  if target_price is null then raise exception 'stripe price mapping not found'; end if;
  if p_provider_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused') then raise exception 'unsupported stripe subscription status'; end if;

  insert into public.billing_provider_subscriptions(
    organization_id,billing_price_id,provider,livemode,provider_customer_id,provider_subscription_id,provider_status,
    cancel_at_period_end,current_period_start,current_period_end,cancel_at,latest_invoice_id,provider_created_at,last_synced_at
  ) values(
    target_org,target_price,'stripe',p_livemode,p_provider_customer_id,p_provider_subscription_id,p_provider_status,
    coalesce(p_cancel_at_period_end,false),p_current_period_start,p_current_period_end,p_cancel_at,p_latest_invoice_id,p_provider_created_at,now()
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

create or replace function app_private.sync_stripe_invoice(
  p_livemode boolean,
  p_provider_customer_id text,
  p_provider_invoice_id text,
  p_provider_subscription_id text,
  p_provider_payment_intent_id text,
  p_status text,
  p_currency text,
  p_amount_due_minor bigint,
  p_amount_paid_minor bigint,
  p_amount_remaining_minor bigint,
  p_hosted_invoice_url text,
  p_invoice_pdf_url text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_provider_created_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare target_org uuid; target_id uuid;
begin
  select organization_id into target_org from public.billing_provider_customers
  where provider='stripe' and livemode=p_livemode and provider_customer_id=p_provider_customer_id;
  if target_org is null then raise exception 'stripe customer mapping not found'; end if;
  insert into public.billing_provider_invoices(
    organization_id,provider,livemode,provider_customer_id,provider_invoice_id,provider_subscription_id,provider_payment_intent_id,
    status,currency,amount_due_minor,amount_paid_minor,amount_remaining_minor,hosted_invoice_url,invoice_pdf_url,
    period_start,period_end,provider_created_at,last_synced_at
  ) values(
    target_org,'stripe',p_livemode,p_provider_customer_id,p_provider_invoice_id,p_provider_subscription_id,p_provider_payment_intent_id,
    p_status,lower(p_currency),greatest(p_amount_due_minor,0),greatest(p_amount_paid_minor,0),greatest(p_amount_remaining_minor,0),
    p_hosted_invoice_url,p_invoice_pdf_url,p_period_start,p_period_end,p_provider_created_at,now()
  )
  on conflict (provider,livemode,provider_invoice_id) do update
  set provider_subscription_id=excluded.provider_subscription_id, provider_payment_intent_id=excluded.provider_payment_intent_id,
      status=excluded.status,currency=excluded.currency,amount_due_minor=excluded.amount_due_minor,amount_paid_minor=excluded.amount_paid_minor,
      amount_remaining_minor=excluded.amount_remaining_minor,hosted_invoice_url=excluded.hosted_invoice_url,invoice_pdf_url=excluded.invoice_pdf_url,
      period_start=excluded.period_start,period_end=excluded.period_end,provider_created_at=coalesce(public.billing_provider_invoices.provider_created_at,excluded.provider_created_at),
      last_synced_at=now(),updated_at=now()
  returning id into target_id;
  return target_id;
end;
$$;

create or replace function app_private.sync_stripe_payout(p_livemode boolean,p_provider_payout_id text,p_status text,p_currency text,p_amount_minor bigint,p_arrival_date date,p_method text,p_automatic boolean,p_provider_created_at timestamptz)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_id uuid;
begin
  insert into public.billing_provider_payouts(provider,livemode,provider_payout_id,status,currency,amount_minor,arrival_date,method,automatic,provider_created_at,last_synced_at)
  values('stripe',p_livemode,p_provider_payout_id,p_status,lower(p_currency),greatest(p_amount_minor,0),p_arrival_date,p_method,p_automatic,p_provider_created_at,now())
  on conflict(provider,livemode,provider_payout_id) do update set status=excluded.status,currency=excluded.currency,amount_minor=excluded.amount_minor,arrival_date=excluded.arrival_date,method=excluded.method,automatic=excluded.automatic,last_synced_at=now()
  returning id into target_id; return target_id;
end; $$;

create or replace function app_private.sync_stripe_dispute(p_livemode boolean,p_provider_dispute_id text,p_provider_charge_id text,p_status text,p_reason text,p_currency text,p_amount_minor bigint,p_provider_created_at timestamptz)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_org uuid; target_id uuid;
begin
  select i.organization_id into target_org from public.billing_provider_invoices i
  where i.provider='stripe' and i.livemode=p_livemode and i.provider_payment_intent_id is not null
    and i.provider_payment_intent_id in (
      select r.provider_payment_intent_id from public.billing_provider_refunds r where false
    ) limit 1;
  insert into public.billing_provider_disputes(organization_id,provider,livemode,provider_dispute_id,provider_charge_id,status,reason,currency,amount_minor,provider_created_at,last_synced_at)
  values(target_org,'stripe',p_livemode,p_provider_dispute_id,p_provider_charge_id,p_status,p_reason,lower(p_currency),greatest(p_amount_minor,0),p_provider_created_at,now())
  on conflict(provider,livemode,provider_dispute_id) do update set status=excluded.status,reason=excluded.reason,currency=excluded.currency,amount_minor=excluded.amount_minor,last_synced_at=now()
  returning id into target_id; return target_id;
end; $$;

create or replace function app_private.request_platform_refund(p_provider_invoice_id text,p_amount_minor bigint default null,p_reason text default 'requested_by_customer')
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare caller_id uuid := app_private.require_platform_admin_aal2(); invoice_row public.billing_provider_invoices%rowtype; requested_amount bigint; request_id uuid;
begin
  select * into invoice_row from public.billing_provider_invoices where provider='stripe' and provider_invoice_id=p_provider_invoice_id order by livemode desc limit 1 for update;
  if not found then raise exception 'invoice not found' using errcode='P0002'; end if;
  if invoice_row.provider_payment_intent_id is null or invoice_row.amount_paid_minor <= 0 then raise exception 'invoice has no refundable payment'; end if;
  requested_amount := coalesce(p_amount_minor, invoice_row.amount_paid_minor);
  if requested_amount <= 0 or requested_amount > invoice_row.amount_paid_minor then raise exception 'invalid refund amount' using errcode='22023'; end if;
  if p_reason not in ('duplicate','fraudulent','requested_by_customer','other') then raise exception 'invalid refund reason' using errcode='22023'; end if;

  insert into public.billing_provider_refunds(organization_id,provider,livemode,provider_invoice_id,provider_payment_intent_id,status,currency,amount_minor,reason,requested_by)
  values(invoice_row.organization_id,'stripe',invoice_row.livemode,invoice_row.provider_invoice_id,invoice_row.provider_payment_intent_id,'pending_provider',invoice_row.currency,requested_amount,p_reason,caller_id)
  returning id into request_id;

  perform app_private.append_audit_event(invoice_row.organization_id,null,caller_id,'user','PLATFORM_BILLING_REFUND_REQUESTED','billing_refund',request_id::text,'created',
    jsonb_build_object('provider_invoice_id',invoice_row.provider_invoice_id,'amount_minor',requested_amount,'currency',invoice_row.currency,'reason',p_reason));

  return jsonb_build_object('refund_request_id',request_id,'livemode',invoice_row.livemode,'provider_payment_intent_id',invoice_row.provider_payment_intent_id,'amount_minor',requested_amount,'currency',invoice_row.currency,'reason',p_reason);
end; $$;

create or replace function app_private.complete_stripe_refund(p_refund_request_id uuid,p_provider_refund_id text,p_status text,p_amount_minor bigint,p_currency text)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target public.billing_provider_refunds%rowtype;
begin
  select * into target from public.billing_provider_refunds where id=p_refund_request_id for update;
  if not found then raise exception 'refund request not found'; end if;
  update public.billing_provider_refunds set provider_refund_id=p_provider_refund_id,status=p_status,currency=lower(p_currency),amount_minor=p_amount_minor,last_synced_at=now() where id=target.id;
  perform app_private.append_audit_event(target.organization_id,null,null,'service','PLATFORM_BILLING_REFUND_SYNCED','billing_refund',target.id::text,
    case when p_status='succeeded' then 'completed' when p_status='failed' then 'failed' else 'state_change' end,
    jsonb_build_object('provider_refund_id',p_provider_refund_id,'status',p_status,'amount_minor',p_amount_minor,'currency',lower(p_currency)));
  return target.id;
end; $$;

create or replace function app_private.sync_stripe_refund_event(p_livemode boolean,p_provider_refund_id text,p_provider_payment_intent_id text,p_status text,p_amount_minor bigint,p_currency text,p_reason text)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target public.billing_provider_refunds%rowtype; target_org uuid; target_invoice text; target_id uuid;
begin
  select * into target from public.billing_provider_refunds
  where provider='stripe' and livemode=p_livemode and provider_payment_intent_id=p_provider_payment_intent_id and provider_refund_id is null
  order by requested_at desc limit 1 for update;
  if found then
    update public.billing_provider_refunds set provider_refund_id=p_provider_refund_id,status=p_status,amount_minor=p_amount_minor,currency=lower(p_currency),reason=coalesce(p_reason,reason),last_synced_at=now() where id=target.id returning id into target_id;
    return target_id;
  end if;
  select i.organization_id,i.provider_invoice_id into target_org,target_invoice from public.billing_provider_invoices i
  where i.provider='stripe' and i.livemode=p_livemode and i.provider_payment_intent_id=p_provider_payment_intent_id order by i.provider_created_at desc nulls last limit 1;
  insert into public.billing_provider_refunds(organization_id,provider,livemode,provider_refund_id,provider_invoice_id,provider_payment_intent_id,status,currency,amount_minor,reason,last_synced_at)
  values(target_org,'stripe',p_livemode,p_provider_refund_id,target_invoice,p_provider_payment_intent_id,p_status,lower(p_currency),p_amount_minor,p_reason,now())
  on conflict(provider,livemode,provider_refund_id) do update set status=excluded.status,amount_minor=excluded.amount_minor,currency=excluded.currency,reason=coalesce(excluded.reason,public.billing_provider_refunds.reason),last_synced_at=now()
  returning id into target_id; return target_id;
end; $$;

create or replace function app_private.get_platform_admin_payment_operations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not app_private.is_platform_admin() then raise exception 'platform admin access denied' using errcode='42501'; end if;
  select jsonb_build_object(
    'failed_event_count',(select count(*) from public.billing_provider_events where processing_status='failed'),
    'pending_refund_count',(select count(*) from public.billing_provider_refunds where status in ('pending_provider','pending','requires_action')),
    'open_dispute_count',(select count(*) from public.billing_provider_disputes where status not in ('won','lost','warning_closed')),
    'latest_payouts',coalesce((select jsonb_agg(x.payload order by x.synced desc) from (select jsonb_build_object('provider_payout_id',p.provider_payout_id,'livemode',p.livemode,'status',p.status,'currency',p.currency,'amount_minor',p.amount_minor,'arrival_date',p.arrival_date) payload,p.last_synced_at synced from public.billing_provider_payouts p order by p.last_synced_at desc limit 10)x),'[]'::jsonb),
    'latest_refunds',coalesce((select jsonb_agg(x.payload order by x.requested desc) from (select jsonb_build_object('refund_request_id',r.id,'organization_id',r.organization_id,'provider_refund_id',r.provider_refund_id,'provider_invoice_id',r.provider_invoice_id,'livemode',r.livemode,'status',r.status,'currency',r.currency,'amount_minor',r.amount_minor,'reason',r.reason,'requested_at',r.requested_at) payload,r.requested_at requested from public.billing_provider_refunds r order by r.requested_at desc limit 20)x),'[]'::jsonb),
    'latest_disputes',coalesce((select jsonb_agg(x.payload order by x.synced desc) from (select jsonb_build_object('provider_dispute_id',d.provider_dispute_id,'organization_id',d.organization_id,'livemode',d.livemode,'status',d.status,'reason',d.reason,'currency',d.currency,'amount_minor',d.amount_minor) payload,d.last_synced_at synced from public.billing_provider_disputes d order by d.last_synced_at desc limit 20)x),'[]'::jsonb)
  ) into result;
  return result;
end; $$;

create or replace function public.get_organization_billing_state(organization_id uuid, livemode boolean)
returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.get_organization_billing_state(organization_id,livemode); $$;
create or replace function public.get_billing_checkout_context(organization_id uuid, price_key text, livemode boolean)
returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.get_billing_checkout_context(organization_id,price_key,livemode); $$;
create or replace function public.get_billing_portal_context(organization_id uuid, livemode boolean)
returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.get_billing_portal_context(organization_id,livemode); $$;
create or replace function public.request_platform_refund(provider_invoice_id text, amount_minor bigint default null, reason text default 'requested_by_customer')
returns jsonb language sql volatile security invoker set search_path='' as $$ select app_private.request_platform_refund(provider_invoice_id,amount_minor,reason); $$;
create or replace function public.get_platform_admin_payment_operations()
returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.get_platform_admin_payment_operations(); $$;

create or replace function public.configure_stripe_price_mapping(plan_key text,price_key text,currency text,unit_amount_minor bigint,billing_interval text,interval_count integer,livemode boolean,provider_product_id text,provider_price_id text,lookup_key text)
returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.configure_stripe_price_mapping(plan_key,price_key,currency,unit_amount_minor,billing_interval,interval_count,livemode,provider_product_id,provider_price_id,lookup_key); $$;
create or replace function public.sync_stripe_customer(organization_id uuid,livemode boolean,provider_customer_id text)
returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.sync_stripe_customer(organization_id,livemode,provider_customer_id); $$;
create or replace function public.begin_stripe_event(livemode boolean,provider_event_id text,event_type text,provider_created_at timestamptz,payload_sha256 text)
returns text language sql volatile security invoker set search_path='' as $$ select app_private.begin_stripe_event(livemode,provider_event_id,event_type,provider_created_at,payload_sha256); $$;
create or replace function public.finish_stripe_event(livemode boolean,provider_event_id text,processing_status text,error_code text default null)
returns void language sql volatile security invoker set search_path='' as $$ select app_private.finish_stripe_event(livemode,provider_event_id,processing_status,error_code); $$;
create or replace function public.sync_stripe_subscription(livemode boolean,provider_customer_id text,provider_subscription_id text,provider_price_id text,provider_status text,cancel_at_period_end boolean,current_period_start timestamptz,current_period_end timestamptz,cancel_at timestamptz,latest_invoice_id text,provider_created_at timestamptz)
returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.sync_stripe_subscription(livemode,provider_customer_id,provider_subscription_id,provider_price_id,provider_status,cancel_at_period_end,current_period_start,current_period_end,cancel_at,latest_invoice_id,provider_created_at); $$;
create or replace function public.sync_stripe_invoice(livemode boolean,provider_customer_id text,provider_invoice_id text,provider_subscription_id text,provider_payment_intent_id text,status text,currency text,amount_due_minor bigint,amount_paid_minor bigint,amount_remaining_minor bigint,hosted_invoice_url text,invoice_pdf_url text,period_start timestamptz,period_end timestamptz,provider_created_at timestamptz)
returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.sync_stripe_invoice(livemode,provider_customer_id,provider_invoice_id,provider_subscription_id,provider_payment_intent_id,status,currency,amount_due_minor,amount_paid_minor,amount_remaining_minor,hosted_invoice_url,invoice_pdf_url,period_start,period_end,provider_created_at); $$;
create or replace function public.sync_stripe_payout(livemode boolean,provider_payout_id text,status text,currency text,amount_minor bigint,arrival_date date,method text,automatic boolean,provider_created_at timestamptz)
returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.sync_stripe_payout(livemode,provider_payout_id,status,currency,amount_minor,arrival_date,method,automatic,provider_created_at); $$;
create or replace function public.sync_stripe_dispute(livemode boolean,provider_dispute_id text,provider_charge_id text,status text,reason text,currency text,amount_minor bigint,provider_created_at timestamptz)
returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.sync_stripe_dispute(livemode,provider_dispute_id,provider_charge_id,status,reason,currency,amount_minor,provider_created_at); $$;
create or replace function public.complete_stripe_refund(refund_request_id uuid,provider_refund_id text,status text,amount_minor bigint,currency text)
returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.complete_stripe_refund(refund_request_id,provider_refund_id,status,amount_minor,currency); $$;
create or replace function public.sync_stripe_refund_event(livemode boolean,provider_refund_id text,provider_payment_intent_id text,status text,amount_minor bigint,currency text,reason text)
returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.sync_stripe_refund_event(livemode,provider_refund_id,provider_payment_intent_id,status,amount_minor,currency,reason); $$;

revoke all on function app_private.get_organization_billing_state(uuid,boolean), app_private.get_billing_checkout_context(uuid,text,boolean), app_private.get_billing_portal_context(uuid,boolean), app_private.request_platform_refund(text,bigint,text), app_private.get_platform_admin_payment_operations() from public,anon,authenticated,service_role;
revoke all on function public.get_organization_billing_state(uuid,boolean), public.get_billing_checkout_context(uuid,text,boolean), public.get_billing_portal_context(uuid,boolean), public.request_platform_refund(text,bigint,text), public.get_platform_admin_payment_operations() from public,anon,authenticated,service_role;

grant execute on function app_private.get_organization_billing_state(uuid,boolean), app_private.get_billing_checkout_context(uuid,text,boolean), app_private.get_billing_portal_context(uuid,boolean), app_private.request_platform_refund(text,bigint,text), app_private.get_platform_admin_payment_operations() to authenticated;
grant execute on function public.get_organization_billing_state(uuid,boolean), public.get_billing_checkout_context(uuid,text,boolean), public.get_billing_portal_context(uuid,boolean), public.request_platform_refund(text,bigint,text), public.get_platform_admin_payment_operations() to authenticated;

revoke all on function app_private.configure_stripe_price_mapping(text,text,text,bigint,text,integer,boolean,text,text,text), app_private.sync_stripe_customer(uuid,boolean,text), app_private.begin_stripe_event(boolean,text,text,timestamptz,text), app_private.finish_stripe_event(boolean,text,text,text), app_private.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz), app_private.sync_stripe_invoice(boolean,text,text,text,text,text,text,bigint,bigint,bigint,text,text,timestamptz,timestamptz,timestamptz), app_private.sync_stripe_payout(boolean,text,text,text,bigint,date,text,boolean,timestamptz), app_private.sync_stripe_dispute(boolean,text,text,text,text,text,bigint,timestamptz), app_private.complete_stripe_refund(uuid,text,text,bigint,text), app_private.sync_stripe_refund_event(boolean,text,text,text,bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function public.configure_stripe_price_mapping(text,text,text,bigint,text,integer,boolean,text,text,text), public.sync_stripe_customer(uuid,boolean,text), public.begin_stripe_event(boolean,text,text,timestamptz,text), public.finish_stripe_event(boolean,text,text,text), public.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz), public.sync_stripe_invoice(boolean,text,text,text,text,text,text,bigint,bigint,bigint,text,text,timestamptz,timestamptz,timestamptz), public.sync_stripe_payout(boolean,text,text,text,bigint,date,text,boolean,timestamptz), public.sync_stripe_dispute(boolean,text,text,text,text,text,bigint,timestamptz), public.complete_stripe_refund(uuid,text,text,bigint,text), public.sync_stripe_refund_event(boolean,text,text,text,bigint,text,text) from public,anon,authenticated,service_role;

grant usage on schema app_private to authenticated,service_role;
grant execute on function app_private.configure_stripe_price_mapping(text,text,text,bigint,text,integer,boolean,text,text,text), app_private.sync_stripe_customer(uuid,boolean,text), app_private.begin_stripe_event(boolean,text,text,timestamptz,text), app_private.finish_stripe_event(boolean,text,text,text), app_private.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz), app_private.sync_stripe_invoice(boolean,text,text,text,text,text,text,bigint,bigint,bigint,text,text,timestamptz,timestamptz,timestamptz), app_private.sync_stripe_payout(boolean,text,text,text,bigint,date,text,boolean,timestamptz), app_private.sync_stripe_dispute(boolean,text,text,text,text,text,bigint,timestamptz), app_private.complete_stripe_refund(uuid,text,text,bigint,text), app_private.sync_stripe_refund_event(boolean,text,text,text,bigint,text,text) to service_role;
grant execute on function public.configure_stripe_price_mapping(text,text,text,bigint,text,integer,boolean,text,text,text), public.sync_stripe_customer(uuid,boolean,text), public.begin_stripe_event(boolean,text,text,timestamptz,text), public.finish_stripe_event(boolean,text,text,text), public.sync_stripe_subscription(boolean,text,text,text,text,boolean,timestamptz,timestamptz,timestamptz,text,timestamptz), public.sync_stripe_invoice(boolean,text,text,text,text,text,text,bigint,bigint,bigint,text,text,timestamptz,timestamptz,timestamptz), public.sync_stripe_payout(boolean,text,text,text,bigint,date,text,boolean,timestamptz), public.sync_stripe_dispute(boolean,text,text,text,text,text,bigint,timestamptz), public.complete_stripe_refund(uuid,text,text,bigint,text), public.sync_stripe_refund_event(boolean,text,text,text,bigint,text,text) to service_role;

comment on table public.billing_provider_events is 'Stripe webhook idempotency ledger. Stores event identity and SHA-256 only; raw provider payloads are deliberately not retained.';
comment on table public.billing_provider_payouts is 'Stripe account payout operational state. Bank account details are never stored in Genithm.';
comment on function public.request_platform_refund(text,bigint,text) is 'Platform-admin + AAL2 refund authorization. The external Stripe refund is executed server-side after this audited authorization step.';
