alter table public.billing_usage_metrics
  add column metering_state text not null default 'planned';

alter table public.billing_usage_metrics
  add constraint billing_usage_metrics_metering_state
  check (metering_state in ('planned','active'));

update public.billing_usage_metrics
set metering_state = 'active'
where metric_key in ('ai_requests','workflow_runs');

create or replace function app_private.get_organization_plan_summary(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not app_private.is_org_member(target_organization_id) then
    raise exception 'organization access denied' using errcode = '42501';
  end if;

  with selected as (
    select
      s.organization_id,
      s.status as subscription_status,
      s.assignment_source,
      s.current_period_start,
      s.current_period_end,
      s.cancel_at,
      p.id as plan_id,
      p.plan_key,
      p.name as plan_name,
      p.description as plan_description,
      p.status as plan_status,
      p.billing_model
    from public.organization_subscriptions s
    join public.billing_plans p on p.id = s.plan_id
    where s.organization_id = target_organization_id
  ),
  limits_with_usage as (
    select
      m.metric_key,
      m.name,
      m.unit,
      m.reset_period,
      m.aggregation_strategy,
      m.metering_state,
      l.soft_limit,
      l.hard_limit,
      case m.reset_period
        when 'daily' then date_trunc('day', now())
        when 'monthly' then date_trunc('month', now())
        else null
      end as period_start,
      case m.reset_period
        when 'daily' then date_trunc('day', now()) + interval '1 day'
        when 'monthly' then date_trunc('month', now()) + interval '1 month'
        else null
      end as period_end,
      case
        when m.metering_state <> 'active' then 0::numeric
        when m.aggregation_strategy = 'latest' then coalesce((
          select ue.quantity
          from public.usage_events ue
          where ue.organization_id = target_organization_id
            and ue.metric_key = m.metric_key
          order by ue.occurred_at desc, ue.created_at desc
          limit 1
        ), 0::numeric)
        else coalesce((
          select sum(ue.quantity)
          from public.usage_events ue
          where ue.organization_id = target_organization_id
            and ue.metric_key = m.metric_key
            and ue.occurred_at >= case m.reset_period
              when 'daily' then date_trunc('day', now())
              when 'monthly' then date_trunc('month', now())
              else '-infinity'::timestamptz
            end
        ), 0::numeric)
      end as used
    from selected s
    join public.billing_plan_limits l on l.plan_id = s.plan_id
    join public.billing_usage_metrics m on m.metric_key = l.metric_key and m.status = 'active'
  )
  select jsonb_build_object(
    'organization_id', s.organization_id,
    'plan', jsonb_build_object(
      'key', s.plan_key,
      'name', s.plan_name,
      'description', s.plan_description,
      'status', s.plan_status,
      'billing_model', s.billing_model
    ),
    'subscription', jsonb_build_object(
      'status', s.subscription_status,
      'assignment_source', s.assignment_source,
      'current_period_start', s.current_period_start,
      'current_period_end', s.current_period_end,
      'cancel_at', s.cancel_at
    ),
    'entitlements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'feature_key', f.feature_key,
        'name', f.name,
        'description', f.description,
        'enabled', e.enabled
      ) order by f.name)
      from public.billing_plan_entitlements e
      join public.billing_features f on f.feature_key = e.feature_key and f.status = 'active'
      where e.plan_id = s.plan_id
    ), '[]'::jsonb),
    'limits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'metric_key', q.metric_key,
        'name', q.name,
        'unit', q.unit,
        'reset_period', q.reset_period,
        'aggregation_strategy', q.aggregation_strategy,
        'metering_state', q.metering_state,
        'period_start', q.period_start,
        'period_end', q.period_end,
        'soft_limit', q.soft_limit,
        'hard_limit', q.hard_limit,
        'used', q.used,
        'remaining', case when q.hard_limit is null then null else greatest(q.hard_limit - q.used, 0) end,
        'soft_limit_reached', q.soft_limit is not null and q.used >= q.soft_limit,
        'hard_limit_reached', q.hard_limit is not null and q.used >= q.hard_limit,
        'enforcement_active', q.metering_state = 'active' and q.hard_limit is not null
      ) order by q.name)
      from limits_with_usage q
    ), '[]'::jsonb),
    'active_meter_count', (select count(*) from limits_with_usage q where q.metering_state = 'active'),
    'planned_meter_count', (select count(*) from limits_with_usage q where q.metering_state = 'planned'),
    'commercial_enforcement_active', exists(
      select 1 from limits_with_usage q
      where q.metering_state = 'active' and q.hard_limit is not null
    )
  ) into result
  from selected s;

  if result is null then
    raise exception 'organization subscription is not configured';
  end if;

  return result;
end;
$$;

revoke all on function app_private.get_organization_plan_summary(uuid) from public, anon, service_role;
grant execute on function app_private.get_organization_plan_summary(uuid) to authenticated;
