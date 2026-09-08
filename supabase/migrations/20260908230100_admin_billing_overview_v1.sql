create or replace function app_private.get_platform_admin_billing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not app_private.is_platform_admin(auth.uid()) then
    raise exception 'platform admin access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'schema_version', 'genithm-admin-billing-overview/1',
    'checked_at', now(),
    'active_plan_count', (select count(*) from public.billing_plans where status = 'active'),
    'subscription_count', (select count(*) from public.organization_subscriptions),
    'organizations_with_usage', (select count(distinct organization_id) from public.usage_events),
    'usage_event_count', (select count(*) from public.usage_events),
    'subscriptions_by_status', coalesce((
      select jsonb_object_agg(status, count_value order by status)
      from (
        select status, count(*)::bigint as count_value
        from public.organization_subscriptions
        group by status
      ) grouped
    ), '{}'::jsonb),
    'subscriptions_by_plan', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_key', p.plan_key,
        'plan_name', p.name,
        'plan_status', p.status,
        'billing_model', p.billing_model,
        'organization_count', count(s.organization_id)
      ) order by p.sort_order, p.plan_key)
      from public.billing_plans p
      left join public.organization_subscriptions s on s.plan_id = p.id
      group by p.id, p.plan_key, p.name, p.status, p.billing_model, p.sort_order
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.get_platform_admin_billing_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_platform_admin_billing_overview();
$$;

revoke all on function app_private.get_platform_admin_billing_overview() from public, anon, authenticated, service_role;
revoke all on function public.get_platform_admin_billing_overview() from public, anon, authenticated, service_role;
grant execute on function app_private.get_platform_admin_billing_overview() to authenticated;
grant execute on function public.get_platform_admin_billing_overview() to authenticated;
