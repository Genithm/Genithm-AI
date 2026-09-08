alter table public.billing_provider_transactions
  add column amount numeric,
  add column refundable_amount numeric;

alter table public.billing_provider_transfers
  add column source_amount numeric,
  add column target_amount numeric,
  add column fee_amount numeric;

alter table public.billing_provider_transactions
  add constraint billing_provider_transactions_decimal_amount check (amount is null or amount >= 0),
  add constraint billing_provider_transactions_decimal_refundable check (refundable_amount is null or refundable_amount >= 0);

alter table public.billing_provider_transfers
  add constraint billing_provider_transfers_decimal_amounts check (
    (source_amount is null or source_amount >= 0)
    and (target_amount is null or target_amount >= 0)
    and (fee_amount is null or fee_amount >= 0)
  );

create or replace function app_private.sync_provider_transfer_amounts(
  p_provider_key text,
  p_livemode boolean,
  p_external_transfer_id text,
  p_external_profile_id text,
  p_external_recipient_id text,
  p_status text,
  p_source_currency text,
  p_target_currency text,
  p_source_amount numeric,
  p_target_amount numeric,
  p_rate numeric,
  p_fee_amount numeric,
  p_estimated_delivery_at timestamptz,
  p_provider_created_at timestamptz
)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare target_id uuid;
begin
  insert into public.billing_provider_transfers(
    provider_key,livemode,external_transfer_id,external_profile_id,external_recipient_id,status,
    source_currency,target_currency,source_amount,target_amount,rate,fee_amount,estimated_delivery_at,provider_created_at,last_synced_at
  ) values(
    p_provider_key,p_livemode,p_external_transfer_id,p_external_profile_id,p_external_recipient_id,p_status,
    upper(p_source_currency),upper(p_target_currency),p_source_amount,p_target_amount,p_rate,p_fee_amount,p_estimated_delivery_at,p_provider_created_at,now()
  )
  on conflict(provider_key,livemode,external_transfer_id) do update set
    status=excluded.status,source_amount=excluded.source_amount,target_amount=excluded.target_amount,rate=excluded.rate,fee_amount=excluded.fee_amount,
    estimated_delivery_at=excluded.estimated_delivery_at,last_synced_at=now()
  returning id into target_id;
  return target_id;
end; $$;

create or replace function public.sync_provider_transfer_amounts(
  provider_key text,livemode boolean,external_transfer_id text,external_profile_id text,external_recipient_id text,status text,
  source_currency text,target_currency text,source_amount numeric,target_amount numeric,rate numeric,fee_amount numeric,
  estimated_delivery_at timestamptz,provider_created_at timestamptz
)
returns uuid language sql volatile security invoker set search_path='' as $$
  select app_private.sync_provider_transfer_amounts(provider_key,livemode,external_transfer_id,external_profile_id,external_recipient_id,status,source_currency,target_currency,source_amount,target_amount,rate,fee_amount,estimated_delivery_at,provider_created_at);
$$;

revoke all on function app_private.sync_provider_transfer_amounts(text,boolean,text,text,text,text,text,text,numeric,numeric,numeric,numeric,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.sync_provider_transfer_amounts(text,boolean,text,text,text,text,text,text,numeric,numeric,numeric,numeric,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function app_private.sync_provider_transfer_amounts(text,boolean,text,text,text,text,text,text,numeric,numeric,numeric,numeric,timestamptz,timestamptz) to service_role;
grant execute on function public.sync_provider_transfer_amounts(text,boolean,text,text,text,text,text,text,numeric,numeric,numeric,numeric,timestamptz,timestamptz) to service_role;
