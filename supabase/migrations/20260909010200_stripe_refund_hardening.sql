create unique index billing_provider_refunds_one_pending_per_invoice_idx
  on public.billing_provider_refunds(provider, livemode, provider_invoice_id)
  where provider_invoice_id is not null
    and status in ('pending_provider','pending','requires_action');

create or replace function app_private.request_platform_refund(
  p_provider_invoice_id text,
  p_amount_minor bigint default null,
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
  invoice_row public.billing_provider_invoices%rowtype;
  requested_amount bigint;
  reserved_amount bigint;
  refundable_amount bigint;
  request_id uuid;
begin
  select * into invoice_row
  from public.billing_provider_invoices
  where provider = 'stripe' and provider_invoice_id = p_provider_invoice_id
  order by livemode desc
  limit 1
  for update;

  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if invoice_row.provider_payment_intent_id is null or invoice_row.amount_paid_minor <= 0 then raise exception 'invoice has no refundable payment'; end if;

  select coalesce(sum(r.amount_minor), 0) into reserved_amount
  from public.billing_provider_refunds r
  where r.provider = 'stripe'
    and r.livemode = invoice_row.livemode
    and r.provider_invoice_id = invoice_row.provider_invoice_id
    and r.status in ('pending_provider','pending','requires_action','succeeded');

  refundable_amount := greatest(invoice_row.amount_paid_minor - reserved_amount, 0);
  if refundable_amount <= 0 then raise exception 'invoice has no remaining refundable amount'; end if;

  requested_amount := coalesce(p_amount_minor, refundable_amount);
  if requested_amount <= 0 or requested_amount > refundable_amount then
    raise exception 'refund amount exceeds remaining refundable amount' using errcode = '22023';
  end if;
  if p_reason not in ('duplicate','fraudulent','requested_by_customer','other') then raise exception 'invalid refund reason' using errcode = '22023'; end if;

  insert into public.billing_provider_refunds(
    organization_id, provider, livemode, provider_invoice_id, provider_payment_intent_id,
    status, currency, amount_minor, reason, requested_by
  ) values (
    invoice_row.organization_id, 'stripe', invoice_row.livemode, invoice_row.provider_invoice_id,
    invoice_row.provider_payment_intent_id, 'pending_provider', invoice_row.currency,
    requested_amount, p_reason, caller_id
  ) returning id into request_id;

  perform app_private.append_audit_event(
    invoice_row.organization_id, null, caller_id, 'user', 'PLATFORM_BILLING_REFUND_REQUESTED',
    'billing_refund', request_id::text, 'created',
    jsonb_build_object(
      'provider_invoice_id', invoice_row.provider_invoice_id,
      'amount_minor', requested_amount,
      'currency', invoice_row.currency,
      'reason', p_reason
    )
  );

  return jsonb_build_object(
    'refund_request_id', request_id,
    'livemode', invoice_row.livemode,
    'provider_payment_intent_id', invoice_row.provider_payment_intent_id,
    'amount_minor', requested_amount,
    'currency', invoice_row.currency,
    'reason', p_reason
  );
end;
$$;
