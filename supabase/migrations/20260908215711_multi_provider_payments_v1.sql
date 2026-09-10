-- Multi-provider Payments V1
-- Stripe remains fully supported. PayPal adds recurring customer billing; Wise adds payout/transfer rails.
-- Provider secrets never live in Postgres.

create table public.billing_payment_providers (
  provider_key text primary key,
  display_name text not null,
  provider_kind text not null,
  capabilities text[] not null default '{}'::text[],
  status text not null default 'supported',
  documentation_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_payment_providers_key check (provider_key ~ '^[a-z0-9_]{2,40}$'),
  constraint billing_payment_providers_kind check (provider_kind in ('payment_processor','payout_rail','hybrid')),
  constraint billing_payment_providers_status check (status in ('supported','beta','disabled')),
  constraint billing_payment_providers_capabilities check (
    capabilities <@ array['checkout','subscriptions','portal','invoices','refunds','disputes','payouts','transfers','webhooks']::text[]
  )
);

insert into public.billing_payment_providers(provider_key,display_name,provider_kind,capabilities,status,documentation_url)
values
  ('stripe','Stripe','hybrid',array['checkout','subscriptions','portal','invoices','refunds','disputes','payouts','webhooks'],'supported','https://docs.stripe.com/'),
  ('paypal','PayPal','payment_processor',array['checkout','subscriptions','invoices','refunds','disputes','webhooks'],'supported','https://developer.paypal.com/'),
  ('wise','Wise','payout_rail',array['payouts','transfers','webhooks'],'supported','https://docs.wise.com/')
on conflict(provider_key) do update
set display_name=excluded.display_name,provider_kind=excluded.provider_kind,capabilities=excluded.capabilities,status=excluded.status,documentation_url=excluded.documentation_url,updated_at=now();

create table public.billing_provider_connections (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null references public.billing_payment_providers(provider_key) on delete restrict,
  livemode boolean not null,
  connection_scope text not null default 'platform',
  external_account_id text,
  external_profile_id text,
  connection_status text not null default 'credentials_missing',
  capabilities text[] not null default '{}'::text[],
  last_verified_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key,livemode,connection_scope),
  constraint billing_provider_connections_scope check (connection_scope='platform'),
  constraint billing_provider_connections_status check (connection_status in ('credentials_missing','configured','verified','degraded','disabled')),
  constraint billing_provider_connections_error check (last_error_code is null or char_length(last_error_code)<=120)
);

create table public.billing_provider_plan_mappings (
  id uuid primary key default gen_random_uuid(),
  billing_price_id uuid not null references public.billing_prices(id) on delete restrict,
  provider_key text not null references public.billing_payment_providers(provider_key) on delete restrict,
  livemode boolean not null,
  external_product_id text,
  external_price_id text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(billing_price_id,provider_key,livemode),
  unique(provider_key,livemode,external_price_id),
  constraint billing_provider_plan_mappings_status check (status in ('active','archived'))
);

create table public.billing_provider_external_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  billing_price_id uuid not null references public.billing_prices(id) on delete restrict,
  provider_key text not null references public.billing_payment_providers(provider_key) on delete restrict,
  livemode boolean not null,
  external_customer_id text,
  external_subscription_id text not null,
  provider_status text not null,
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  provider_created_at timestamptz,
  last_provider_event_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key,livemode,external_subscription_id)
);

create table public.billing_provider_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  provider_key text not null references public.billing_payment_providers(provider_key) on delete restrict,
  livemode boolean not null,
  external_transaction_id text not null,
  external_subscription_id text,
  transaction_kind text not null,
  status text not null,
  currency text not null,
  amount_minor bigint not null,
  refundable_amount_minor bigint,
  provider_created_at timestamptz,
  last_synced_at timestamptz not null default now(),
  unique(provider_key,livemode,external_transaction_id),
  constraint billing_provider_transactions_kind check (transaction_kind in ('payment','refund','dispute','invoice')),
  constraint billing_provider_transactions_currency check (currency ~ '^[A-Z]{3}$'),
  constraint billing_provider_transactions_amount check (amount_minor >= 0),
  constraint billing_provider_transactions_refundable check (refundable_amount_minor is null or refundable_amount_minor >= 0)
);

create table public.billing_provider_transfers (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null references public.billing_payment_providers(provider_key) on delete restrict,
  livemode boolean not null,
  external_transfer_id text not null,
  external_profile_id text,
  external_recipient_id text,
  status text not null,
  source_currency text not null,
  target_currency text not null,
  source_amount_minor bigint,
  target_amount_minor bigint,
  rate numeric,
  fee_minor bigint,
  estimated_delivery_at timestamptz,
  provider_created_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider_key,livemode,external_transfer_id),
  constraint billing_provider_transfers_source_currency check (source_currency ~ '^[A-Z]{3}$'),
  constraint billing_provider_transfers_target_currency check (target_currency ~ '^[A-Z]{3}$'),
  constraint billing_provider_transfers_amounts check ((source_amount_minor is null or source_amount_minor>=0) and (target_amount_minor is null or target_amount_minor>=0) and (fee_minor is null or fee_minor>=0))
);

create table public.billing_provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null references public.billing_payment_providers(provider_key) on delete restrict,
  livemode boolean not null,
  external_event_id text not null,
  event_type text not null,
  payload_sha256 text not null,
  provider_created_at timestamptz,
  processing_status text not null default 'received',
  attempt_count integer not null default 1,
  processed_at timestamptz,
  error_code text,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  unique(provider_key,livemode,external_event_id),
  constraint billing_provider_webhook_events_digest check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint billing_provider_webhook_events_status check (processing_status in ('received','processed','ignored','failed')),
  constraint billing_provider_webhook_events_attempt check (attempt_count>=1)
);

create index billing_provider_connections_provider_idx on public.billing_provider_connections(provider_key,livemode);
create index billing_provider_plan_mappings_price_idx on public.billing_provider_plan_mappings(billing_price_id);
create index billing_provider_external_subscriptions_org_idx on public.billing_provider_external_subscriptions(organization_id,provider_key,provider_status);
create index billing_provider_external_subscriptions_price_idx on public.billing_provider_external_subscriptions(billing_price_id);
create index billing_provider_transactions_org_idx on public.billing_provider_transactions(organization_id,provider_key,provider_created_at desc) where organization_id is not null;
create index billing_provider_transactions_subscription_idx on public.billing_provider_transactions(provider_key,external_subscription_id) where external_subscription_id is not null;
create index billing_provider_transfers_status_idx on public.billing_provider_transfers(provider_key,status,last_synced_at desc);
create index billing_provider_webhook_events_status_idx on public.billing_provider_webhook_events(provider_key,processing_status,last_received_at desc);

create trigger billing_payment_providers_updated_at before update on public.billing_payment_providers for each row execute function app_private.set_updated_at();
create trigger billing_provider_connections_updated_at before update on public.billing_provider_connections for each row execute function app_private.set_updated_at();
create trigger billing_provider_plan_mappings_updated_at before update on public.billing_provider_plan_mappings for each row execute function app_private.set_updated_at();
create trigger billing_provider_external_subscriptions_updated_at before update on public.billing_provider_external_subscriptions for each row execute function app_private.set_updated_at();

alter table public.billing_payment_providers enable row level security;
alter table public.billing_payment_providers force row level security;
alter table public.billing_provider_connections enable row level security;
alter table public.billing_provider_connections force row level security;
alter table public.billing_provider_plan_mappings enable row level security;
alter table public.billing_provider_plan_mappings force row level security;
alter table public.billing_provider_external_subscriptions enable row level security;
alter table public.billing_provider_external_subscriptions force row level security;
alter table public.billing_provider_transactions enable row level security;
alter table public.billing_provider_transactions force row level security;
alter table public.billing_provider_transfers enable row level security;
alter table public.billing_provider_transfers force row level security;
alter table public.billing_provider_webhook_events enable row level security;
alter table public.billing_provider_webhook_events force row level security;

create policy billing_payment_providers_deny_direct on public.billing_payment_providers as restrictive for all to anon,authenticated using(false) with check(false);
create policy billing_provider_connections_deny_direct on public.billing_provider_connections as restrictive for all to anon,authenticated using(false) with check(false);
create policy billing_provider_plan_mappings_deny_direct on public.billing_provider_plan_mappings as restrictive for all to anon,authenticated using(false) with check(false);
create policy billing_provider_external_subscriptions_deny_direct on public.billing_provider_external_subscriptions as restrictive for all to anon,authenticated using(false) with check(false);
create policy billing_provider_transactions_deny_direct on public.billing_provider_transactions as restrictive for all to anon,authenticated using(false) with check(false);
create policy billing_provider_transfers_deny_direct on public.billing_provider_transfers as restrictive for all to anon,authenticated using(false) with check(false);
create policy billing_provider_webhook_events_deny_direct on public.billing_provider_webhook_events as restrictive for all to anon,authenticated using(false) with check(false);

revoke all on table public.billing_payment_providers,public.billing_provider_connections,public.billing_provider_plan_mappings,public.billing_provider_external_subscriptions,public.billing_provider_transactions,public.billing_provider_transfers,public.billing_provider_webhook_events from public,anon,authenticated,service_role;

-- Backfill Stripe catalog mapping into the provider-neutral registry.
insert into public.billing_provider_plan_mappings(billing_price_id,provider_key,livemode,external_product_id,external_price_id,status)
select billing_price_id,'stripe',livemode,provider_product_id,provider_price_id,status
from public.billing_provider_prices
on conflict(billing_price_id,provider_key,livemode) do nothing;

create or replace function app_private.get_payment_provider_catalog(p_livemode boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'provider_key',p.provider_key,'display_name',p.display_name,'provider_kind',p.provider_kind,'capabilities',p.capabilities,'status',p.status,
    'connection_status',coalesce(c.connection_status,'credentials_missing'),'connection_capabilities',coalesce(c.capabilities,'{}'::text[]),'livemode',p_livemode
  ) order by p.display_name),'[]'::jsonb)
  into result
  from public.billing_payment_providers p
  left join public.billing_provider_connections c on c.provider_key=p.provider_key and c.livemode=p_livemode and c.connection_scope='platform'
  where p.status<>'disabled';
  return result;
end; $$;

create or replace function app_private.upsert_payment_provider_connection(p_provider_key text,p_livemode boolean,p_external_account_id text,p_external_profile_id text,p_connection_status text,p_capabilities text[],p_error_code text default null)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_id uuid;
begin
  if not exists(select 1 from public.billing_payment_providers where provider_key=p_provider_key and status<>'disabled') then raise exception 'unsupported payment provider'; end if;
  insert into public.billing_provider_connections(provider_key,livemode,external_account_id,external_profile_id,connection_status,capabilities,last_verified_at,last_error_code)
  values(p_provider_key,p_livemode,p_external_account_id,p_external_profile_id,p_connection_status,coalesce(p_capabilities,'{}'::text[]),case when p_connection_status='verified' then now() else null end,p_error_code)
  on conflict(provider_key,livemode,connection_scope) do update set external_account_id=excluded.external_account_id,external_profile_id=excluded.external_profile_id,connection_status=excluded.connection_status,capabilities=excluded.capabilities,last_verified_at=case when excluded.connection_status='verified' then now() else public.billing_provider_connections.last_verified_at end,last_error_code=excluded.last_error_code,updated_at=now()
  returning id into target_id; return target_id;
end; $$;

create or replace function app_private.configure_provider_plan_mapping(p_provider_key text,p_livemode boolean,p_plan_key text,p_price_key text,p_currency text,p_unit_amount_minor bigint,p_billing_interval text,p_interval_count integer,p_external_product_id text,p_external_price_id text)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_plan public.billing_plans%rowtype; target_price_id uuid; target_mapping_id uuid;
begin
  select * into target_plan from public.billing_plans where plan_key=p_plan_key for update;
  if not found or target_plan.billing_model<>'subscription' or target_plan.plan_key='free' then raise exception 'subscription plan is not eligible'; end if;
  if p_provider_key not in ('stripe','paypal') then raise exception 'provider does not support subscription plan mapping'; end if;
  if p_unit_amount_minor<=0 or upper(p_currency)!~'^[A-Z]{3}$' then raise exception 'invalid price'; end if;
  if p_billing_interval not in ('month','year') or p_interval_count<1 or p_interval_count>12 then raise exception 'invalid billing interval'; end if;
  insert into public.billing_prices(plan_id,price_key,currency,unit_amount_minor,billing_interval,interval_count,status)
  values(target_plan.id,p_price_key,upper(p_currency),p_unit_amount_minor,p_billing_interval,p_interval_count,'active')
  on conflict(price_key) do update set plan_id=excluded.plan_id,currency=excluded.currency,unit_amount_minor=excluded.unit_amount_minor,billing_interval=excluded.billing_interval,interval_count=excluded.interval_count,status='active',updated_at=now()
  returning id into target_price_id;
  insert into public.billing_provider_plan_mappings(billing_price_id,provider_key,livemode,external_product_id,external_price_id,status)
  values(target_price_id,p_provider_key,p_livemode,p_external_product_id,p_external_price_id,'active')
  on conflict(billing_price_id,provider_key,livemode) do update set external_product_id=excluded.external_product_id,external_price_id=excluded.external_price_id,status='active',updated_at=now()
  returning id into target_mapping_id;
  update public.billing_plans set status='active',updated_at=now() where id=target_plan.id;
  return target_mapping_id;
end; $$;

create or replace function app_private.get_provider_checkout_context(p_organization_id uuid,p_provider_key text,p_price_key text,p_livemode boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not app_private.can_manage_org(p_organization_id) then raise exception 'billing manager access required' using errcode='42501'; end if;
  select jsonb_build_object('organization_id',p_organization_id,'provider_key',p_provider_key,'external_product_id',m.external_product_id,'external_price_id',m.external_price_id,'price_key',bp.price_key,'plan_key',p.plan_key,'plan_name',p.name,'currency',bp.currency,'unit_amount_minor',bp.unit_amount_minor,'billing_interval',bp.billing_interval,'interval_count',bp.interval_count)
  into result from public.billing_provider_plan_mappings m join public.billing_prices bp on bp.id=m.billing_price_id join public.billing_plans p on p.id=bp.plan_id
  where m.provider_key=p_provider_key and m.livemode=p_livemode and m.status='active' and bp.price_key=p_price_key and bp.status='active' and p.status='active';
  if result is null then raise exception 'provider checkout price is not configured' using errcode='P0002'; end if;
  return result;
end; $$;

create or replace function app_private.begin_provider_webhook_event(p_provider_key text,p_livemode boolean,p_external_event_id text,p_event_type text,p_payload_sha256 text,p_provider_created_at timestamptz default null)
returns text language plpgsql volatile security definer set search_path='' as $$
declare existing public.billing_provider_webhook_events%rowtype;
begin
  select * into existing from public.billing_provider_webhook_events where provider_key=p_provider_key and livemode=p_livemode and external_event_id=p_external_event_id for update;
  if found then
    if existing.payload_sha256<>p_payload_sha256 or existing.event_type<>p_event_type then raise exception 'provider webhook replay mismatch'; end if;
    update public.billing_provider_webhook_events set attempt_count=attempt_count+1,last_received_at=now() where id=existing.id;
    return existing.processing_status;
  end if;
  insert into public.billing_provider_webhook_events(provider_key,livemode,external_event_id,event_type,payload_sha256,provider_created_at) values(p_provider_key,p_livemode,p_external_event_id,p_event_type,p_payload_sha256,p_provider_created_at);
  return 'received';
end; $$;

create or replace function app_private.finish_provider_webhook_event(p_provider_key text,p_livemode boolean,p_external_event_id text,p_status text,p_error_code text default null)
returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if p_status not in ('processed','ignored','failed') then raise exception 'invalid webhook completion status'; end if;
  update public.billing_provider_webhook_events set processing_status=p_status,error_code=case when p_status='failed' then left(coalesce(p_error_code,'provider_sync_failed'),120) else null end,processed_at=case when p_status in ('processed','ignored') then now() else null end,last_received_at=now() where provider_key=p_provider_key and livemode=p_livemode and external_event_id=p_external_event_id;
  if not found then raise exception 'provider webhook event not found'; end if;
end; $$;

create or replace function app_private.sync_provider_subscription(p_organization_id uuid,p_provider_key text,p_livemode boolean,p_external_subscription_id text,p_external_price_id text,p_external_customer_id text,p_provider_status text,p_current_period_start timestamptz,p_current_period_end timestamptz,p_provider_created_at timestamptz,p_event_created_at timestamptz)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_price uuid; target_plan uuid; existing public.billing_provider_external_subscriptions%rowtype; target_id uuid; free_plan uuid; normalized_status text;
begin
  select m.billing_price_id,bp.plan_id into target_price,target_plan from public.billing_provider_plan_mappings m join public.billing_prices bp on bp.id=m.billing_price_id where m.provider_key=p_provider_key and m.livemode=p_livemode and m.external_price_id=p_external_price_id and m.status='active';
  if target_price is null then raise exception 'provider price mapping not found'; end if;
  select * into existing from public.billing_provider_external_subscriptions where provider_key=p_provider_key and livemode=p_livemode and external_subscription_id=p_external_subscription_id for update;
  if found and existing.last_provider_event_at is not null and p_event_created_at is not null and existing.last_provider_event_at>p_event_created_at then return existing.id; end if;
  insert into public.billing_provider_external_subscriptions(organization_id,billing_price_id,provider_key,livemode,external_customer_id,external_subscription_id,provider_status,current_period_start,current_period_end,provider_created_at,last_provider_event_at,last_synced_at)
  values(p_organization_id,target_price,p_provider_key,p_livemode,p_external_customer_id,p_external_subscription_id,p_provider_status,p_current_period_start,p_current_period_end,p_provider_created_at,p_event_created_at,now())
  on conflict(provider_key,livemode,external_subscription_id) do update set billing_price_id=excluded.billing_price_id,external_customer_id=excluded.external_customer_id,provider_status=excluded.provider_status,current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,last_provider_event_at=coalesce(excluded.last_provider_event_at,public.billing_provider_external_subscriptions.last_provider_event_at),last_synced_at=now(),updated_at=now()
  returning id into target_id;
  normalized_status := lower(p_provider_status);
  if normalized_status in ('cancelled','canceled','expired') then
    select id into free_plan from public.billing_plans where plan_key='free' and status='active';
    update public.organization_subscriptions set plan_id=free_plan,status='active',assignment_source='provider',current_period_start=null,current_period_end=null,cancel_at=null,updated_at=now() where organization_id=p_organization_id;
  else
    update public.organization_subscriptions set plan_id=target_plan,status=case when normalized_status in ('active','approved') then 'active' when normalized_status in ('suspended','paused') then 'paused' when normalized_status in ('past_due','payment_failed') then 'past_due' else 'incomplete' end,assignment_source='provider',current_period_start=p_current_period_start,current_period_end=p_current_period_end,updated_at=now() where organization_id=p_organization_id;
  end if;
  return target_id;
end; $$;

create or replace function app_private.sync_provider_transfer(p_provider_key text,p_livemode boolean,p_external_transfer_id text,p_external_profile_id text,p_external_recipient_id text,p_status text,p_source_currency text,p_target_currency text,p_source_amount_minor bigint,p_target_amount_minor bigint,p_rate numeric,p_fee_minor bigint,p_estimated_delivery_at timestamptz,p_provider_created_at timestamptz)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_id uuid;
begin
  insert into public.billing_provider_transfers(provider_key,livemode,external_transfer_id,external_profile_id,external_recipient_id,status,source_currency,target_currency,source_amount_minor,target_amount_minor,rate,fee_minor,estimated_delivery_at,provider_created_at,last_synced_at)
  values(p_provider_key,p_livemode,p_external_transfer_id,p_external_profile_id,p_external_recipient_id,p_status,upper(p_source_currency),upper(p_target_currency),p_source_amount_minor,p_target_amount_minor,p_rate,p_fee_minor,p_estimated_delivery_at,p_provider_created_at,now())
  on conflict(provider_key,livemode,external_transfer_id) do update set status=excluded.status,source_amount_minor=excluded.source_amount_minor,target_amount_minor=excluded.target_amount_minor,rate=excluded.rate,fee_minor=excluded.fee_minor,estimated_delivery_at=excluded.estimated_delivery_at,last_synced_at=now()
  returning id into target_id; return target_id;
end; $$;

create or replace function public.get_payment_provider_catalog(livemode boolean) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.get_payment_provider_catalog(livemode); $$;
create or replace function public.get_provider_checkout_context(organization_id uuid,provider_key text,price_key text,livemode boolean) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.get_provider_checkout_context(organization_id,provider_key,price_key,livemode); $$;
create or replace function public.upsert_payment_provider_connection(provider_key text,livemode boolean,external_account_id text,external_profile_id text,connection_status text,capabilities text[],error_code text default null) returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.upsert_payment_provider_connection(provider_key,livemode,external_account_id,external_profile_id,connection_status,capabilities,error_code); $$;
create or replace function public.configure_provider_plan_mapping(provider_key text,livemode boolean,plan_key text,price_key text,currency text,unit_amount_minor bigint,billing_interval text,interval_count integer,external_product_id text,external_price_id text) returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.configure_provider_plan_mapping(provider_key,livemode,plan_key,price_key,currency,unit_amount_minor,billing_interval,interval_count,external_product_id,external_price_id); $$;
create or replace function public.begin_provider_webhook_event(provider_key text,livemode boolean,external_event_id text,event_type text,payload_sha256 text,provider_created_at timestamptz default null) returns text language sql volatile security invoker set search_path='' as $$ select app_private.begin_provider_webhook_event(provider_key,livemode,external_event_id,event_type,payload_sha256,provider_created_at); $$;
create or replace function public.finish_provider_webhook_event(provider_key text,livemode boolean,external_event_id text,status text,error_code text default null) returns void language sql volatile security invoker set search_path='' as $$ select app_private.finish_provider_webhook_event(provider_key,livemode,external_event_id,status,error_code); $$;
create or replace function public.sync_provider_subscription(organization_id uuid,provider_key text,livemode boolean,external_subscription_id text,external_price_id text,external_customer_id text,provider_status text,current_period_start timestamptz,current_period_end timestamptz,provider_created_at timestamptz,event_created_at timestamptz) returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.sync_provider_subscription(organization_id,provider_key,livemode,external_subscription_id,external_price_id,external_customer_id,provider_status,current_period_start,current_period_end,provider_created_at,event_created_at); $$;
create or replace function public.sync_provider_transfer(provider_key text,livemode boolean,external_transfer_id text,external_profile_id text,external_recipient_id text,status text,source_currency text,target_currency text,source_amount_minor bigint,target_amount_minor bigint,rate numeric,fee_minor bigint,estimated_delivery_at timestamptz,provider_created_at timestamptz) returns uuid language sql volatile security invoker set search_path='' as $$ select app_private.sync_provider_transfer(provider_key,livemode,external_transfer_id,external_profile_id,external_recipient_id,status,source_currency,target_currency,source_amount_minor,target_amount_minor,rate,fee_minor,estimated_delivery_at,provider_created_at); $$;

revoke all on function app_private.get_payment_provider_catalog(boolean),app_private.get_provider_checkout_context(uuid,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_payment_provider_catalog(boolean),public.get_provider_checkout_context(uuid,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function app_private.get_payment_provider_catalog(boolean),app_private.get_provider_checkout_context(uuid,text,text,boolean) to authenticated;
grant execute on function public.get_payment_provider_catalog(boolean),public.get_provider_checkout_context(uuid,text,text,boolean) to authenticated;

revoke all on function app_private.upsert_payment_provider_connection(text,boolean,text,text,text,text[],text),app_private.configure_provider_plan_mapping(text,boolean,text,text,text,bigint,text,integer,text,text),app_private.begin_provider_webhook_event(text,boolean,text,text,text,timestamptz),app_private.finish_provider_webhook_event(text,boolean,text,text,text),app_private.sync_provider_subscription(uuid,text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz),app_private.sync_provider_transfer(text,boolean,text,text,text,text,text,text,bigint,bigint,numeric,bigint,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.upsert_payment_provider_connection(text,boolean,text,text,text,text[],text),public.configure_provider_plan_mapping(text,boolean,text,text,text,bigint,text,integer,text,text),public.begin_provider_webhook_event(text,boolean,text,text,text,timestamptz),public.finish_provider_webhook_event(text,boolean,text,text,text),public.sync_provider_subscription(uuid,text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz),public.sync_provider_transfer(text,boolean,text,text,text,text,text,text,bigint,bigint,numeric,bigint,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.upsert_payment_provider_connection(text,boolean,text,text,text,text[],text),app_private.configure_provider_plan_mapping(text,boolean,text,text,text,bigint,text,integer,text,text),app_private.begin_provider_webhook_event(text,boolean,text,text,text,timestamptz),app_private.finish_provider_webhook_event(text,boolean,text,text,text),app_private.sync_provider_subscription(uuid,text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz),app_private.sync_provider_transfer(text,boolean,text,text,text,text,text,text,bigint,bigint,numeric,bigint,timestamptz,timestamptz) to service_role;
grant execute on function public.upsert_payment_provider_connection(text,boolean,text,text,text,text[],text),public.configure_provider_plan_mapping(text,boolean,text,text,text,bigint,text,integer,text,text),public.begin_provider_webhook_event(text,boolean,text,text,text,timestamptz),public.finish_provider_webhook_event(text,boolean,text,text,text),public.sync_provider_subscription(uuid,text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz),public.sync_provider_transfer(text,boolean,text,text,text,text,text,text,bigint,bigint,numeric,bigint,timestamptz,timestamptz) to service_role;
