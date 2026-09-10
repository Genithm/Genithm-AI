-- PayPal refund reconciliation hardening.
-- Make admin refund authorization mode-specific and ledgerize refunds initiated outside Genithm.

drop function if exists public.request_provider_refund(text,text,numeric,text);
drop function if exists app_private.request_provider_refund(text,text,numeric,text);

create or replace function app_private.request_provider_refund(
  p_provider_key text,
  p_livemode boolean,
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
    and livemode=p_livemode
    and external_transaction_id=p_external_transaction_id
    and transaction_kind='payment'
    and lower(status) in ('completed','success','succeeded')
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

create or replace function public.request_provider_refund(
  provider_key text,
  livemode boolean,
  external_transaction_id text,
  amount numeric default null,
  reason text default 'requested_by_customer'
)
returns jsonb
language sql
volatile
security invoker
set search_path=''
as $$
  select app_private.request_provider_refund(provider_key,livemode,external_transaction_id,amount,reason);
$$;

revoke all on function app_private.request_provider_refund(text,boolean,text,numeric,text) from public,anon,authenticated,service_role;
revoke all on function public.request_provider_refund(text,boolean,text,numeric,text) from public,anon,authenticated,service_role;
grant execute on function app_private.request_provider_refund(text,boolean,text,numeric,text) to authenticated;
grant execute on function public.request_provider_refund(text,boolean,text,numeric,text) to authenticated;

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
    when 'reversed' then 'completed'
    else 'pending'
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
        status=normalized_status,
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

    insert into public.billing_provider_refund_requests(
      organization_id,provider_key,livemode,external_transaction_id,external_refund_id,status,
      currency,amount,reason,requested_by,requested_at,last_synced_at
    ) values(
      target_org,p_provider_key,p_livemode,p_external_parent_transaction_id,p_external_refund_id,
      normalized_status,upper(p_currency),p_amount,'other',null,coalesce(p_provider_created_at,now()),now()
    )
    on conflict(provider_key,livemode,external_refund_id) do update
    set status=excluded.status,
        amount=excluded.amount,
        currency=excluded.currency,
        last_synced_at=now();
  end if;

  select app_private.sync_provider_transaction(
    target_org,p_provider_key,p_livemode,p_external_refund_id,null,p_external_parent_transaction_id,
    'refund',p_status,p_currency,p_amount,0,null,null,p_provider_created_at
  ) into target_id;

  return target_id;
end;
$$;
