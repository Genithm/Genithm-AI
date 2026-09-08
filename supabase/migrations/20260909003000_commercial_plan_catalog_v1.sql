alter table public.billing_features
  drop constraint billing_features_status;

alter table public.billing_features
  add constraint billing_features_status
  check (status in ('planned','active','retired'));

create table public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  price_key text not null unique,
  currency text not null,
  unit_amount_minor bigint not null,
  billing_interval text not null,
  interval_count integer not null default 1,
  status text not null default 'draft',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_prices_key_format check (price_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint billing_prices_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint billing_prices_amount_nonnegative check (unit_amount_minor >= 0),
  constraint billing_prices_interval check (billing_interval in ('month','year')),
  constraint billing_prices_interval_count check (interval_count between 1 and 12),
  constraint billing_prices_status check (status in ('draft','active','archived'))
);

create index billing_prices_plan_idx on public.billing_prices(plan_id);

create trigger billing_prices_set_updated_at
before update on public.billing_prices
for each row execute function app_private.set_updated_at();

alter table public.billing_prices enable row level security;
alter table public.billing_prices force row level security;

create policy billing_prices_deny_direct
on public.billing_prices
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table public.billing_prices from public, anon, authenticated, service_role;

insert into public.billing_plans (plan_key, name, description, status, billing_model, sort_order)
values
  ('researcher', 'Researcher', 'Draft individual research tier. Final pricing and quotas will be activated only after commercial review and provider mapping.', 'draft', 'subscription', 10),
  ('professional', 'Professional', 'Draft advanced individual tier for heavier research workflows and future API access. Final pricing and quotas are not configured.', 'draft', 'subscription', 20),
  ('team', 'Team', 'Draft collaborative tier for research groups. Team-specific commercial capabilities remain planned until implemented and reviewed.', 'draft', 'subscription', 30),
  ('enterprise', 'Enterprise', 'Draft institutional tier for negotiated deployments and enterprise controls. Commercial terms remain contract-defined.', 'draft', 'contract', 40)
on conflict (plan_key) do nothing;

insert into public.billing_features (feature_key, name, description, status)
values
  ('api_access', 'API access', 'External developer API access for approved plans and credentials.', 'planned'),
  ('team_collaboration', 'Team collaboration', 'Commercial collaboration capabilities for organization research teams.', 'planned'),
  ('advanced_reports', 'Advanced reports', 'Future enhanced report formats and organization-level reporting controls.', 'planned'),
  ('long_term_archive', 'Long-term archive', 'Extended analysis retention and archive policy beyond baseline lifecycle rules.', 'planned')
on conflict (feature_key) do nothing;

insert into public.billing_plan_entitlements (plan_id, feature_key, enabled)
select p.id, f.feature_key, true
from public.billing_plans p
cross join public.billing_features f
where p.plan_key in ('researcher','professional','team','enterprise')
  and f.status = 'active'
on conflict (plan_id, feature_key) do nothing;

insert into public.billing_plan_entitlements (plan_id, feature_key, enabled)
select p.id, feature.feature_key, true
from public.billing_plans p
join (values
  ('researcher', 'advanced_reports'),
  ('researcher', 'long_term_archive'),
  ('professional', 'advanced_reports'),
  ('professional', 'long_term_archive'),
  ('professional', 'api_access'),
  ('team', 'advanced_reports'),
  ('team', 'long_term_archive'),
  ('team', 'api_access'),
  ('team', 'team_collaboration'),
  ('enterprise', 'advanced_reports'),
  ('enterprise', 'long_term_archive'),
  ('enterprise', 'api_access'),
  ('enterprise', 'team_collaboration')
) as feature(plan_key, feature_key) on feature.plan_key = p.plan_key
on conflict (plan_id, feature_key) do nothing;

insert into public.billing_plan_limits (plan_id, metric_key, soft_limit, hard_limit)
select p.id, m.metric_key, null, null
from public.billing_plans p
cross join public.billing_usage_metrics m
where p.plan_key in ('researcher','professional','team','enterprise')
  and m.status = 'active'
on conflict (plan_id, metric_key) do nothing;

create or replace function app_private.get_platform_admin_plan_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not app_private.is_platform_admin() then
    raise exception 'platform admin access denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'schema_version', 'commercial-plan-catalog/1',
    'checked_at', now(),
    'plans', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'plan_key', p.plan_key,
          'name', p.name,
          'description', p.description,
          'status', p.status,
          'billing_model', p.billing_model,
          'sort_order', p.sort_order,
          'entitlements', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'feature_key', f.feature_key,
                'name', f.name,
                'feature_status', f.status,
                'enabled', e.enabled
              ) order by f.name
            )
            from public.billing_plan_entitlements e
            join public.billing_features f on f.feature_key = e.feature_key
            where e.plan_id = p.id
          ), '[]'::jsonb),
          'limits', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'metric_key', m.metric_key,
                'name', m.name,
                'unit', m.unit,
                'metering_state', m.metering_state,
                'reset_period', m.reset_period,
                'soft_limit', l.soft_limit,
                'hard_limit', l.hard_limit
              ) order by m.name
            )
            from public.billing_plan_limits l
            join public.billing_usage_metrics m on m.metric_key = l.metric_key
            where l.plan_id = p.id
          ), '[]'::jsonb),
          'prices', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'price_key', bp.price_key,
                'currency', bp.currency,
                'unit_amount_minor', bp.unit_amount_minor,
                'billing_interval', bp.billing_interval,
                'interval_count', bp.interval_count,
                'status', bp.status
              ) order by bp.sort_order, bp.price_key
            )
            from public.billing_prices bp
            where bp.plan_id = p.id
          ), '[]'::jsonb)
        ) order by p.sort_order, p.plan_key
      )
      from public.billing_plans p
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.get_platform_admin_plan_catalog()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_platform_admin_plan_catalog();
$$;

revoke all on function app_private.get_platform_admin_plan_catalog() from public, anon, authenticated, service_role;
revoke all on function public.get_platform_admin_plan_catalog() from public, anon, authenticated, service_role;

grant usage on schema app_private to authenticated;
grant execute on function app_private.get_platform_admin_plan_catalog() to authenticated;
grant execute on function public.get_platform_admin_plan_catalog() to authenticated;
