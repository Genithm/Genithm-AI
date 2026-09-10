-- Scope reconciliation-based webhook resolution to event families actually re-read by V1.
-- Uncovered financial event families stay unresolved rather than being falsely cleared.

create or replace function app_private.resolve_failed_provider_webhooks(
  p_provider_key text,
  p_livemode boolean,
  p_reconciliation_run_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  run_started timestamptz;
  run_status text;
  run_provider text;
  run_mode boolean;
  affected integer := 0;
  changed integer := 0;
begin
  select started_at,status,provider_key,livemode
  into run_started,run_status,run_provider,run_mode
  from public.billing_provider_reconciliation_runs
  where id=p_reconciliation_run_id;

  if run_started is null or run_status <> 'succeeded' or run_provider <> p_provider_key or run_mode <> p_livemode then
    raise exception 'successful matching reconciliation run is required';
  end if;

  if p_provider_key='paypal' then
    update public.billing_provider_webhook_events
    set resolved_at=now(),
        resolution_code='authoritative_subscription_reconciliation',
        resolved_by_reconciliation_run_id=p_reconciliation_run_id
    where provider_key='paypal'
      and livemode=p_livemode
      and processing_status='failed'
      and resolved_at is null
      and last_received_at <= run_started
      and event_type like 'BILLING.SUBSCRIPTION.%';
    get diagnostics affected = row_count;

  elsif p_provider_key='wise' then
    update public.billing_provider_webhook_events
    set resolved_at=now(),
        resolution_code='authoritative_transfer_reconciliation',
        resolved_by_reconciliation_run_id=p_reconciliation_run_id
    where provider_key='wise'
      and livemode=p_livemode
      and processing_status='failed'
      and resolved_at is null
      and last_received_at <= run_started
      and event_type in ('transfers#state-change','transfers#payout-failure','transfers#refund');
    get diagnostics affected = row_count;

  elsif p_provider_key='stripe' then
    update public.billing_provider_events
    set resolved_at=now(),
        resolution_code='authoritative_subscription_reconciliation',
        resolved_by_reconciliation_run_id=p_reconciliation_run_id
    where provider='stripe'
      and livemode=p_livemode
      and processing_status='failed'
      and resolved_at is null
      and last_received_at <= run_started
      and event_type in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted');
    get diagnostics changed = row_count;
    affected := affected + changed;
  else
    raise exception 'unsupported payment provider';
  end if;

  return affected;
end;
$$;

comment on function public.resolve_failed_provider_webhooks(text,boolean,uuid) is
  'Marks only failed webhook event families covered by the successful V1 authoritative reconciliation. Uncovered financial event failures remain unresolved.';
