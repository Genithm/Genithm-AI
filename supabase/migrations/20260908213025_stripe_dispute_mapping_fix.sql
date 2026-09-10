alter table public.billing_provider_disputes
  add column provider_payment_intent_id text;

create index billing_provider_disputes_payment_intent_idx
  on public.billing_provider_disputes(provider_payment_intent_id)
  where provider_payment_intent_id is not null;

drop function if exists public.sync_stripe_dispute(boolean,text,text,text,text,text,bigint,timestamptz);
drop function if exists app_private.sync_stripe_dispute(boolean,text,text,text,text,text,bigint,timestamptz);

create or replace function app_private.sync_stripe_dispute(
  p_livemode boolean,
  p_provider_dispute_id text,
  p_provider_charge_id text,
  p_provider_payment_intent_id text,
  p_status text,
  p_reason text,
  p_currency text,
  p_amount_minor bigint,
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
  target_id uuid;
begin
  if p_provider_payment_intent_id is not null then
    select i.organization_id into target_org
    from public.billing_provider_invoices i
    where i.provider = 'stripe'
      and i.livemode = p_livemode
      and i.provider_payment_intent_id = p_provider_payment_intent_id
    order by i.provider_created_at desc nulls last, i.created_at desc
    limit 1;
  end if;

  insert into public.billing_provider_disputes(
    organization_id,
    provider,
    livemode,
    provider_dispute_id,
    provider_charge_id,
    provider_payment_intent_id,
    status,
    reason,
    currency,
    amount_minor,
    provider_created_at,
    last_synced_at
  ) values (
    target_org,
    'stripe',
    p_livemode,
    p_provider_dispute_id,
    p_provider_charge_id,
    p_provider_payment_intent_id,
    p_status,
    p_reason,
    lower(p_currency),
    greatest(p_amount_minor, 0),
    p_provider_created_at,
    now()
  )
  on conflict(provider, livemode, provider_dispute_id) do update
  set organization_id = coalesce(excluded.organization_id, public.billing_provider_disputes.organization_id),
      provider_charge_id = coalesce(excluded.provider_charge_id, public.billing_provider_disputes.provider_charge_id),
      provider_payment_intent_id = coalesce(excluded.provider_payment_intent_id, public.billing_provider_disputes.provider_payment_intent_id),
      status = excluded.status,
      reason = excluded.reason,
      currency = excluded.currency,
      amount_minor = excluded.amount_minor,
      last_synced_at = now()
  returning id into target_id;

  return target_id;
end;
$$;

create or replace function public.sync_stripe_dispute(
  livemode boolean,
  provider_dispute_id text,
  provider_charge_id text,
  provider_payment_intent_id text,
  status text,
  reason text,
  currency text,
  amount_minor bigint,
  provider_created_at timestamptz
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.sync_stripe_dispute(
    livemode,
    provider_dispute_id,
    provider_charge_id,
    provider_payment_intent_id,
    status,
    reason,
    currency,
    amount_minor,
    provider_created_at
  );
$$;

revoke all on function app_private.sync_stripe_dispute(boolean,text,text,text,text,text,text,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.sync_stripe_dispute(boolean,text,text,text,text,text,text,bigint,timestamptz) from public,anon,authenticated,service_role;

grant execute on function app_private.sync_stripe_dispute(boolean,text,text,text,text,text,text,bigint,timestamptz) to service_role;
grant execute on function public.sync_stripe_dispute(boolean,text,text,text,text,text,text,bigint,timestamptz) to service_role;
