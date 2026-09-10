create or replace function app_private.get_provider_checkout_context(p_organization_id uuid,p_provider_key text,p_price_key text,p_livemode boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not app_private.can_manage_org(p_organization_id) then
    raise exception 'billing manager access required' using errcode='42501';
  end if;

  if exists(
    select 1 from public.billing_provider_external_subscriptions s
    where s.organization_id=p_organization_id
      and lower(s.provider_status) in ('approval_pending','approved','incomplete','trialing','active','past_due','unpaid','paused','suspended')
  ) then
    raise exception 'existing paid subscription must be managed before starting another provider checkout' using errcode='22023';
  end if;

  select jsonb_build_object(
    'organization_id',p_organization_id,
    'provider_key',p_provider_key,
    'external_product_id',m.external_product_id,
    'external_price_id',m.external_price_id,
    'price_key',bp.price_key,
    'plan_key',p.plan_key,
    'plan_name',p.name,
    'currency',bp.currency,
    'unit_amount_minor',bp.unit_amount_minor,
    'billing_interval',bp.billing_interval,
    'interval_count',bp.interval_count
  ) into result
  from public.billing_provider_plan_mappings m
  join public.billing_prices bp on bp.id=m.billing_price_id
  join public.billing_plans p on p.id=bp.plan_id
  join public.billing_provider_connections c on c.provider_key=m.provider_key and c.livemode=m.livemode and c.connection_status='verified'
  where m.provider_key=p_provider_key and m.livemode=p_livemode and m.status='active'
    and bp.price_key=p_price_key and bp.status='active' and p.status='active';

  if result is null then raise exception 'verified provider checkout price is not configured' using errcode='P0002'; end if;
  return result;
end; $$;
