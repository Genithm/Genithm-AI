-- PayPal Financial Operations V1
-- Extends the provider-neutral ledger with subscription payments, refunds and disputes.
-- Provider secrets and raw webhook payloads remain outside Postgres.

alter table public.billing_provider_transactions
  alter column amount_minor drop not null,
  add column external_parent_transaction_id text,
  add column provider_reason text,
  add column provider_status_detail text;

alter table public.billing_provider_transactions
  add constraint billing_provider_transactions_amount_present
  check (amount_minor is not null or amount is not null),
  add constraint billing_provider_transactions_reason_length
  check (provider_reason is null or char_length(provider_reason) <= 160),
  add constraint billing_provider_transactions_status_detail_length
  check (provider_status_detail is null or char_length(provider_status_detail) <= 240);

create index billing_provider_transactions_parent_idx
  on public.billing_provider_transactions(provider_key, livemode, external_parent_transaction_id)
  where external_parent_transaction_id is not null;

create table public.billing_provider_refund_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  provider_key text not null references public.billing_payment_providers(provider_key) on delete restrict,
  livemode boolean not null,
  external_transaction_id text not null,
  external_refund_id text,
  status text not null default 'pending_provider',
  currency text not null,
  amount numeric not null,
  reason text not null default 'requested_by_customer',
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_key, livemode, external_refund_id),
  constraint billing_provider_refund_requests_status check (status in ('pending_provider','pending','completed','failed','cancelled')),
  constraint billing_provider_refund_requests_currency check (currency ~ '^[A-Z]{3}$'),
  constraint billing_provider_refund_requests_amount check (amount > 0),
  constraint billing_provider_refund_requests_reason check (reason in ('duplicate','fraudulent','requested_by_customer','other'))
);

create index billing_provider_refund_requests_org_idx
  on public.billing_provider_refund_requests(organization_id, requested_at desc)
  where organization_id is not null;
create index billing_provider_refund_requests_transaction_idx
  on public.billing_provider_refund_requests(provider_key, livemode, external_transaction_id);
create index billing_provider_refund_requests_requested_by_idx
  on public.billing_provider_refund_requests(requested_by)
  where requested_by is not null;

create trigger billing_provider_refund_requests_updated_at
before update on public.billing_provider_refund_requests
for each row execute function app_private.set_updated_at();

alter table public.billing_provider_refund_requests enable row level security;
alter table public.billing_provider_refund_requests force row level security;

create policy billing_provider_refund_requests_deny_direct
on public.billing_provider_refund_requests
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table public.billing_provider_refund_requests from public, anon, authenticated, service_role;

create or replace function app_private.sync_provider_transaction(
  p_organization_id uuid,
  p_provider_key text,
  p_livemode boolean,
  p_external_transaction_id text,
  p_external_subscription_id text,
  p_external_parent_transaction_id text,
  p_transaction_kind text,
  p_status text,
  p_currency text,
  p_amount numeric,
  p_refundable_amount numeric,
  p_provider_reason text,
  p_provider_status_detail text,
  p_provider_created_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_org uuid := p_organization_id;
  target_id uuid;
begin
  if p_provider_key <> 'paypal' then
    raise exception 'provider transaction sync is not enabled for this provider';
  end if;
  if p_transaction_kind not in ('payment','refund','dispute','invoice') then
    raise exception 'unsupported provider transaction kind';
  end if;
  if upper(p_currency) !~ '^[A-Z]{3}$' or p_amount is null or p_amount < 0 then
    raise exception 'invalid provider transaction amount';
  end if;
  if p_refundable_amount is not null and p_refundable_amount < 0 then
    raise exception 'invalid refundable amount';
  end if;

  if target_org is null and p_external_subscription_id is not null then
    select s.organization_id into target_org
    from public.billing_provider_external_subscriptions s
    where s.provider_key=p_provider_key
      and s.livemode=p_livemode
      and s.external_subscription_id=p_external_subscription_id
    limit 1;
  end if;

  if target_org is null and p_external_parent_transaction_id is not null then
    select t.organization_id into target_org
    from public.billing_provider_transactions t
    where t.provider_key=p_provider_key
      and t.livemode=p_livemode
      and t.external_transaction_id=p_external_parent_transaction_id
    limit 1;
  end if;

  insert into public.billing_provider_transactions(
    organization_id,provider_key,livemode,external_transaction_id,external_subscription_id,
    external_parent_transaction_id,transaction_kind,status,currency,amount_minor,refundable_amount_minor,
    amount,refundable_amount,provider_reason,provider_status_detail,provider_created_at,last_synced_at
  ) values(
    target_org,p_provider_key,p_livemode,p_external_transaction_id,p_external_subscription_id,
    p_external_parent_transaction_id,p_transaction_kind,p_status,upper(p_currency),null,null,
    p_amount,p_refundable_amount,left(p_provider_reason,160),left(p_provider_status_detail,240),p_provider_created_at,now()
  )
  on conflict(provider_key,livemode,external_transaction_id) do update
  set organization_id=coalesce(excluded.organization_id,public.billing_provider_transactions.organization_id),
      external_subscription_id=coalesce(excluded.external_subscription_id,public.billing_provider_transactions.external_subscription_id),
      external_parent_transaction_id=coalesce(excluded.external_parent_transaction_id,public.billing_provider_transactions.external_parent_transaction_id),
      transaction_kind=excluded.transaction_kind,
      status=excluded.status,
      currency=excluded.currency,
      amount=excluded.amount,
      refundable_amount=excluded.refundable_amount,
      provider_reason=excluded.provider_reason,
      provider_status_detail=excluded.provider_status_detail,
      provider_created_at=coalesce(public.billing_provider_transactions.provider_created_at,excluded.provider_created_at),
      last_synced_at=now()
  returning id into target_id;

  return target_id;
end;
$$;

create or replace function app_private.request_provider_refund(
  p_provider_key text,
  p_external_transaction_id text,
  p_amount numeric default null,
  p_reason text default 'requested_by_customer'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := app_private.require_platform_admin_aal2();
  payment public.billing_provider_transactions%rowtype;
  already_requested numeric;
  available numeric;
  requested_amount numeric;
  request_id uuid;
begin
  if p_provider_key <> 'paypal' then
    raise exception 'generic provider refund is not enabled for this provider' using errcode='22023';
  end if;
  if p_reason not in ('duplicate','fraudulent','requested_by_customer','other') then
    raise exception 'invalid refund reason' using errcode='22023';
  end if;

  select * into payment
  from public.billing_provider_transactions
  where provider_key=p_provider_key
    and external_transaction_id=p_external_transaction_id
    and transaction_kind='payment'
    and lower(status) in ('completed','success','succeeded')
  order by livemode desc, provider_created_at desc nulls last
  limit 1
  for update;

  if not found then
    raise exception 'refundable provider payment not found' using errcode='P0002';
  end if;
  if payment.amount is null or payment.amount <= 0 then
    raise exception 'provider payment has no refundable amount';
  end if;

  select coalesce(sum(r.amount),0) into already_requested
  from public.billing_provider_refund_requests r
  where r.provider_key=payment.provider_key
    and r.livemode=payment.livemode
    and r.external_transaction_id=payment.external_transaction_id
    and r.status in ('pending_provider','pending','completed');

  available := greatest(payment.amount - already_requested,0);
  requested_amount := coalesce(p_amount,available);
  if requested_amount <= 0 or requested_amount > available then
    raise exception 'refund amount exceeds remaining refundable amount' using errcode='22023';
  end if;

  insert into public.billing_provider_refund_requests(
    organization_id,provider_key,livemode,external_transaction_id,status,currency,amount,reason,requested_by
  ) values(
    payment.organization_id,payment.provider_key,payment.livemode,payment.external_transaction_id,
    'pending_provider',payment.currency,requested_amount,p_reason,caller_id
  ) returning id into request_id;

  perform app_private.append_audit_event(
    payment.organization_id,null,caller_id,'user','PLATFORM_BILLING_PROVIDER_REFUND_REQUESTED',
    'billing_provider_refund',request_id::text,'created',
    jsonb_build_object(
      'provider_key',payment.provider_key,
      'external_transaction_id',payment.external_transaction_id,
      'amount',requested_amount,
      'currency',payment.currency,
      'reason',p_reason,
      'livemode',payment.livemode
    )
  );

  return jsonb_build_object(
    'refund_request_id',request_id,
    'provider_key',payment.provider_key,
    'livemode',payment.livemode,
    'external_transaction_id',payment.external_transaction_id,
    'amount',requested_amount,
    'currency',payment.currency,
    'reason',p_reason
  );
end;
$$;

create or replace function app_private.complete_provider_refund(
  p_refund_request_id uuid,
  p_external_refund_id text,
  p_status text,
  p_amount numeric,
  p_currency text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.billing_provider_refund_requests%rowtype;
  normalized_status text;
begin
  select * into target
  from public.billing_provider_refund_requests
  where id=p_refund_request_id
  for update;
  if not found then raise exception 'provider refund request not found'; end if;

  normalized_status := case lower(p_status)
    when 'completed' then 'completed'
    when 'pending' then 'pending'
    when 'failed' then 'failed'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    else 'pending'
  end;

  update public.billing_provider_refund_requests
  set external_refund_id=p_external_refund_id,
      status=normalized_status,
      amount=p_amount,
      currency=upper(p_currency),
      last_synced_at=now()
  where id=target.id;

  perform app_private.append_audit_event(
    target.organization_id,null,null,'service','PLATFORM_BILLING_PROVIDER_REFUND_SYNCED',
    'billing_provider_refund',target.id::text,
    case when normalized_status='completed' then 'completed' when normalized_status='failed' then 'failed' else 'state_change' end,
    jsonb_build_object(
      'provider_key',target.provider_key,
      'external_refund_id',p_external_refund_id,
      'status',normalized_status,
      'amount',p_amount,
      'currency',upper(p_currency)
    )
  );

  return target.id;
end;
$$;

create or replace function app_private.sync_provider_refund_event(
  p_provider_key text,
  p_livemode boolean,
  p_external_refund_id text,
  p_external_parent_transaction_id text,
  p_status text,
  p_currency text,
  p_amount numeric,
  p_provider_created_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_request public.billing_provider_refund_requests%rowtype;
  target_org uuid;
  target_id uuid;
  normalized_status text;
begin
  normalized_status := case lower(p_status)
    when 'completed' then 'completed'
    when 'pending' then 'pending'
    when 'failed' then 'failed'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    else lower(p_status)
  end;

  select * into target_request
  from public.billing_provider_refund_requests
  where provider_key=p_provider_key
    and livemode=p_livemode
    and external_transaction_id=p_external_parent_transaction_id
    and (external_refund_id is null or external_refund_id=p_external_refund_id)
    and status in ('pending_provider','pending')
  order by requested_at desc
  limit 1
  for update;

  if found then
    update public.billing_provider_refund_requests
    set external_refund_id=p_external_refund_id,
        status=case when normalized_status in ('completed','pending','failed','cancelled') then normalized_status else status end,
        amount=p_amount,
        currency=upper(p_currency),
        last_synced_at=now()
    where id=target_request.id;
    target_org := target_request.organization_id;
  else
    select organization_id into target_org
    from public.billing_provider_transactions
    where provider_key=p_provider_key
      and livemode=p_livemode
      and external_transaction_id=p_external_parent_transaction_id
    limit 1;
  end if;

  select app_private.sync_provider_transaction(
    target_org,p_provider_key,p_livemode,p_external_refund_id,null,p_external_parent_transaction_id,
    'refund',p_status,p_currency,p_amount,0,null,null,p_provider_created_at
  ) into target_id;

  return target_id;
end;
$$;

create or replace function app_private.get_platform_admin_provider_financial_operations()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not app_private.is_platform_admin() then
    raise exception 'platform admin access denied' using errcode='42501';
  end if;

  select jsonb_build_object(
    'pending_refund_count',(select count(*) from public.billing_provider_refund_requests where status in ('pending_provider','pending')),
    'open_dispute_count',(select count(*) from public.billing_provider_transactions where transaction_kind='dispute' and lower(status) not in ('resolved','won','lost','closed','cancelled','canceled')),
    'recent_payments',coalesce((select jsonb_agg(x.payload order by x.created_at desc) from (
      select jsonb_build_object(
        'provider_key',t.provider_key,'organization_id',t.organization_id,'external_transaction_id',t.external_transaction_id,
        'external_subscription_id',t.external_subscription_id,'status',t.status,'currency',t.currency,'amount',t.amount,
        'refundable_amount',t.refundable_amount,'provider_created_at',t.provider_created_at,'livemode',t.livemode
      ) payload,coalesce(t.provider_created_at,t.last_synced_at) created_at
      from public.billing_provider_transactions t
      where t.transaction_kind='payment'
      order by coalesce(t.provider_created_at,t.last_synced_at) desc
      limit 30
    ) x),'[]'::jsonb),
    'recent_refunds',coalesce((select jsonb_agg(x.payload order by x.requested_at desc) from (
      select jsonb_build_object(
        'refund_request_id',r.id,'provider_key',r.provider_key,'organization_id',r.organization_id,
        'external_transaction_id',r.external_transaction_id,'external_refund_id',r.external_refund_id,'status',r.status,
        'currency',r.currency,'amount',r.amount,'reason',r.reason,'requested_at',r.requested_at,'livemode',r.livemode
      ) payload,r.requested_at
      from public.billing_provider_refund_requests r
      order by r.requested_at desc
      limit 30
    ) x),'[]'::jsonb),
    'recent_disputes',coalesce((select jsonb_agg(x.payload order by x.created_at desc) from (
      select jsonb_build_object(
        'provider_key',t.provider_key,'organization_id',t.organization_id,'external_transaction_id',t.external_transaction_id,
        'external_parent_transaction_id',t.external_parent_transaction_id,'status',t.status,'provider_reason',t.provider_reason,
        'currency',t.currency,'amount',t.amount,'provider_created_at',t.provider_created_at,'livemode',t.livemode
      ) payload,coalesce(t.provider_created_at,t.last_synced_at) created_at
      from public.billing_provider_transactions t
      where t.transaction_kind='dispute'
      order by coalesce(t.provider_created_at,t.last_synced_at) desc
      limit 30
    ) x),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.request_provider_refund(provider_key text,external_transaction_id text,amount numeric default null,reason text default 'requested_by_customer')
returns jsonb language sql volatile security invoker set search_path='' as $$
  select app_private.request_provider_refund(provider_key,external_transaction_id,amount,reason);
$$;
create or replace function public.sync_provider_transaction(organization_id uuid,provider_key text,livemode boolean,external_transaction_id text,external_subscription_id text,external_parent_transaction_id text,transaction_kind text,status text,currency text,amount numeric,refundable_amount numeric,provider_reason text,provider_status_detail text,provider_created_at timestamptz)
returns uuid language sql volatile security invoker set search_path='' as $$
  select app_private.sync_provider_transaction(organization_id,provider_key,livemode,external_transaction_id,external_subscription_id,external_parent_transaction_id,transaction_kind,status,currency,amount,refundable_amount,provider_reason,provider_status_detail,provider_created_at);
$$;
create or replace function public.complete_provider_refund(refund_request_id uuid,external_refund_id text,status text,amount numeric,currency text)
returns uuid language sql volatile security invoker set search_path='' as $$
  select app_private.complete_provider_refund(refund_request_id,external_refund_id,status,amount,currency);
$$;
create or replace function public.sync_provider_refund_event(provider_key text,livemode boolean,external_refund_id text,external_parent_transaction_id text,status text,currency text,amount numeric,provider_created_at timestamptz)
returns uuid language sql volatile security invoker set search_path='' as $$
  select app_private.sync_provider_refund_event(provider_key,livemode,external_refund_id,external_parent_transaction_id,status,currency,amount,provider_created_at);
$$;
create or replace function public.get_platform_admin_provider_financial_operations()
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.get_platform_admin_provider_financial_operations();
$$;

revoke all on function app_private.request_provider_refund(text,text,numeric,text),app_private.get_platform_admin_provider_financial_operations() from public,anon,authenticated,service_role;
revoke all on function public.request_provider_refund(text,text,numeric,text),public.get_platform_admin_provider_financial_operations() from public,anon,authenticated,service_role;
grant execute on function app_private.request_provider_refund(text,text,numeric,text),app_private.get_platform_admin_provider_financial_operations() to authenticated;
grant execute on function public.request_provider_refund(text,text,numeric,text),public.get_platform_admin_provider_financial_operations() to authenticated;

revoke all on function app_private.sync_provider_transaction(uuid,text,boolean,text,text,text,text,text,text,numeric,numeric,text,text,timestamptz),app_private.complete_provider_refund(uuid,text,text,numeric,text),app_private.sync_provider_refund_event(text,boolean,text,text,text,text,numeric,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.sync_provider_transaction(uuid,text,boolean,text,text,text,text,text,text,numeric,numeric,text,text,timestamptz),public.complete_provider_refund(uuid,text,text,numeric,text),public.sync_provider_refund_event(text,boolean,text,text,text,text,numeric,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.sync_provider_transaction(uuid,text,boolean,text,text,text,text,text,text,numeric,numeric,text,text,timestamptz),app_private.complete_provider_refund(uuid,text,text,numeric,text),app_private.sync_provider_refund_event(text,boolean,text,text,text,text,numeric,timestamptz) to service_role;
grant execute on function public.sync_provider_transaction(uuid,text,boolean,text,text,text,text,text,text,numeric,numeric,text,text,timestamptz),public.complete_provider_refund(uuid,text,text,numeric,text),public.sync_provider_refund_event(text,boolean,text,text,text,text,numeric,timestamptz) to service_role;
