create table public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  plan_key text not null unique,
  name text not null,
  description text not null,
  status text not null default 'draft',
  billing_model text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_key_format check (plan_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint billing_plans_name_length check (char_length(name) between 1 and 80),
  constraint billing_plans_description_length check (char_length(description) between 1 and 1000),
  constraint billing_plans_status check (status in ('draft','active','archived')),
  constraint billing_plans_model check (billing_model in ('free','subscription','hybrid','contract'))
);

create table public.billing_features (
  feature_key text primary key,
  name text not null,
  description text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint billing_features_key_format check (feature_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint billing_features_name_length check (char_length(name) between 1 and 100),
  constraint billing_features_description_length check (char_length(description) between 1 and 1000),
  constraint billing_features_status check (status in ('active','retired'))
);

create table public.billing_usage_metrics (
  metric_key text primary key,
  name text not null,
  unit text not null,
  reset_period text not null,
  aggregation_strategy text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  constraint billing_usage_metrics_key_format check (metric_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint billing_usage_metrics_name_length check (char_length(name) between 1 and 100),
  constraint billing_usage_metrics_unit_format check (unit ~ '^[a-z][a-z0-9_]{0,31}$'),
  constraint billing_usage_metrics_reset check (reset_period in ('none','daily','monthly')),
  constraint billing_usage_metrics_aggregation check (aggregation_strategy in ('sum','latest')),
  constraint billing_usage_metrics_status check (status in ('active','retired'))
);

create table public.billing_plan_entitlements (
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  feature_key text not null references public.billing_features(feature_key) on delete restrict,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, feature_key)
);

create table public.billing_plan_limits (
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  metric_key text not null references public.billing_usage_metrics(metric_key) on delete restrict,
  soft_limit numeric,
  hard_limit numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, metric_key),
  constraint billing_plan_limits_soft_nonnegative check (soft_limit is null or soft_limit >= 0),
  constraint billing_plan_limits_hard_nonnegative check (hard_limit is null or hard_limit >= 0),
  constraint billing_plan_limits_order check (soft_limit is null or hard_limit is null or soft_limit <= hard_limit)
);

create table public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  status text not null default 'active',
  assignment_source text not null default 'system',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_subscriptions_status check (status in ('trialing','active','past_due','paused','cancelled','expired','incomplete')),
  constraint organization_subscriptions_source check (assignment_source in ('system','admin','provider')),
  constraint organization_subscriptions_period_order check (current_period_start is null or current_period_end is null or current_period_start < current_period_end)
);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_key text not null references public.billing_usage_metrics(metric_key) on delete restrict,
  quantity numeric not null,
  idempotency_key text not null,
  source_kind text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint usage_events_quantity_nonnegative check (quantity >= 0),
  constraint usage_events_idempotency_length check (char_length(idempotency_key) between 8 and 200),
  constraint usage_events_source_format check (source_kind ~ '^[a-z][a-z0-9_.:-]{1,63}$'),
  unique (organization_id, idempotency_key)
);

create index billing_plan_entitlements_feature_idx on public.billing_plan_entitlements(feature_key);
create index billing_plan_limits_metric_idx on public.billing_plan_limits(metric_key);
create index organization_subscriptions_plan_idx on public.organization_subscriptions(plan_id);
create index usage_events_org_metric_occurred_idx on public.usage_events(organization_id, metric_key, occurred_at desc);
create index usage_events_metric_idx on public.usage_events(metric_key);

create trigger billing_plans_set_updated_at before update on public.billing_plans for each row execute function app_private.set_updated_at();
create trigger billing_plan_entitlements_set_updated_at before update on public.billing_plan_entitlements for each row execute function app_private.set_updated_at();
create trigger billing_plan_limits_set_updated_at before update on public.billing_plan_limits for each row execute function app_private.set_updated_at();
create trigger organization_subscriptions_set_updated_at before update on public.organization_subscriptions for each row execute function app_private.set_updated_at();

insert into public.billing_plans (plan_key, name, description, status, billing_model, sort_order)
values ('free', 'Free', 'Baseline Genithm access. Commercial quotas are not enforced until explicit plan limits are configured.', 'active', 'free', 0);

insert into public.billing_features (feature_key, name, description)
values
  ('ai_assistant', 'Genithm AI', 'Evidence-grounded scientific planning, interpretation, and follow-up.'),
  ('sequence_analysis', 'Sequence analysis', 'Validated FASTA ingestion and deterministic sequence statistics.'),
  ('scientific_retrieval', 'Scientific retrieval', 'Authoritative scientific-source retrieval with freshness and provenance.'),
  ('blast', 'BLAST', 'Authoritative BLAST workflow execution and recorded results.'),
  ('pairwise_alignment', 'Pairwise alignment', 'Deterministic pairwise sequence alignment.'),
  ('multiple_sequence_alignment', 'Multiple sequence alignment', 'Versioned MSA workflow execution.'),
  ('phylogeny', 'Phylogeny', 'Phylogenetic tree workflow from validated alignment results.'),
  ('protein_analysis', 'Protein analysis', 'Deterministic protein-property analysis.'),
  ('protein_annotation', 'Protein annotation', 'Authoritative protein annotation retrieval and evidence capture.'),
  ('scientific_reports', 'Scientific reports', 'Immutable scientific reports with provenance and integrity verification.'),
  ('evidence_explorer', 'Evidence Explorer', 'Frozen evidence inspection and citation deep links.');

insert into public.billing_usage_metrics (metric_key, name, unit, reset_period, aggregation_strategy)
values
  ('ai_requests', 'AI requests', 'requests', 'monthly', 'sum'),
  ('compute_credits', 'Compute credits', 'credits', 'monthly', 'sum'),
  ('workflow_runs', 'Workflow runs', 'runs', 'monthly', 'sum'),
  ('api_requests', 'API requests', 'requests', 'monthly', 'sum'),
  ('storage_bytes', 'Storage', 'bytes', 'none', 'latest'),
  ('concurrent_jobs', 'Concurrent jobs', 'jobs', 'none', 'latest');

insert into public.billing_plan_entitlements (plan_id, feature_key, enabled)
select p.id, f.feature_key, true
from public.billing_plans p
cross join public.billing_features f
where p.plan_key = 'free' and f.status = 'active';

insert into public.billing_plan_limits (plan_id, metric_key, soft_limit, hard_limit)
select p.id, m.metric_key, null, null
from public.billing_plans p
cross join public.billing_usage_metrics m
where p.plan_key = 'free' and m.status = 'active';

insert into public.organization_subscriptions (organization_id, plan_id, status, assignment_source)
select o.id, p.id, 'active', 'system'
from public.organizations o
join public.billing_plans p on p.plan_key = 'free' and p.status = 'active'
on conflict (organization_id) do nothing;

create or replace function app_private.initialize_organization_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_plan_id uuid;
begin
  select p.id into default_plan_id
  from public.billing_plans p
  where p.plan_key = 'free' and p.status = 'active'
  limit 1;

  if default_plan_id is null then
    raise exception 'No active baseline billing plan is configured';
  end if;

  insert into public.organization_subscriptions (organization_id, plan_id, status, assignment_source)
  values (new.id, default_plan_id, 'active', 'system')
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

create trigger organizations_initialize_subscription
after insert on public.organizations
for each row execute function app_private.initialize_organization_subscription();

create or replace function app_private.prevent_usage_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'usage events are immutable';
end;
$$;

create trigger usage_events_immutable
before update or delete on public.usage_events
for each row execute function app_private.prevent_usage_event_mutation();

alter table public.billing_plans enable row level security;
alter table public.billing_plans force row level security;
alter table public.billing_features enable row level security;
alter table public.billing_features force row level security;
alter table public.billing_usage_metrics enable row level security;
alter table public.billing_usage_metrics force row level security;
alter table public.billing_plan_entitlements enable row level security;
alter table public.billing_plan_entitlements force row level security;
alter table public.billing_plan_limits enable row level security;
alter table public.billing_plan_limits force row level security;
alter table public.organization_subscriptions enable row level security;
alter table public.organization_subscriptions force row level security;
alter table public.usage_events enable row level security;
alter table public.usage_events force row level security;

create policy billing_plans_deny_direct on public.billing_plans as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_features_deny_direct on public.billing_features as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_usage_metrics_deny_direct on public.billing_usage_metrics as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_plan_entitlements_deny_direct on public.billing_plan_entitlements as restrictive for all to anon, authenticated using (false) with check (false);
create policy billing_plan_limits_deny_direct on public.billing_plan_limits as restrictive for all to anon, authenticated using (false) with check (false);
create policy organization_subscriptions_deny_direct on public.organization_subscriptions as restrictive for all to anon, authenticated using (false) with check (false);
create policy usage_events_deny_direct on public.usage_events as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table public.billing_plans, public.billing_features, public.billing_usage_metrics, public.billing_plan_entitlements, public.billing_plan_limits, public.organization_subscriptions, public.usage_events from public, anon, authenticated, service_role;

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
      l.soft_limit,
      l.hard_limit,
      case
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
        'soft_limit', q.soft_limit,
        'hard_limit', q.hard_limit,
        'used', q.used,
        'remaining', case when q.hard_limit is null then null else greatest(q.hard_limit - q.used, 0) end,
        'enforcement_active', q.hard_limit is not null
      ) order by q.name)
      from limits_with_usage q
    ), '[]'::jsonb),
    'commercial_enforcement_active', exists(select 1 from limits_with_usage q where q.hard_limit is not null)
  ) into result
  from selected s;

  if result is null then
    raise exception 'organization subscription is not configured';
  end if;

  return result;
end;
$$;

create or replace function app_private.has_organization_entitlement(target_organization_id uuid, requested_feature_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app_private.is_org_member(target_organization_id) then
    raise exception 'organization access denied' using errcode = '42501';
  end if;

  return exists (
    select 1
    from public.organization_subscriptions s
    join public.billing_plan_entitlements e on e.plan_id = s.plan_id
    join public.billing_features f on f.feature_key = e.feature_key
    where s.organization_id = target_organization_id
      and s.status in ('trialing','active')
      and f.feature_key = requested_feature_key
      and f.status = 'active'
      and e.enabled
  );
end;
$$;

create or replace function app_private.record_organization_usage(
  target_organization_id uuid,
  requested_metric_key text,
  quantity_value numeric,
  event_key text,
  source_value text,
  occurred_at_value timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.usage_events%rowtype;
  new_id uuid;
begin
  if target_organization_id is null or requested_metric_key is null or event_key is null or source_value is null or occurred_at_value is null then
    raise exception 'usage event fields are required';
  end if;
  if quantity_value is null or quantity_value < 0 then
    raise exception 'usage quantity must be non-negative';
  end if;
  if char_length(event_key) < 8 or char_length(event_key) > 200 then
    raise exception 'invalid usage idempotency key';
  end if;
  if source_value !~ '^[a-z][a-z0-9_.:-]{1,63}$' then
    raise exception 'invalid usage source';
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_organization_id) then
    raise exception 'organization not found';
  end if;
  if not exists (select 1 from public.billing_usage_metrics m where m.metric_key = requested_metric_key and m.status = 'active') then
    raise exception 'unknown or inactive usage metric';
  end if;

  select * into existing
  from public.usage_events ue
  where ue.organization_id = target_organization_id and ue.idempotency_key = event_key;

  if found then
    if existing.metric_key <> requested_metric_key or existing.quantity <> quantity_value or existing.source_kind <> source_value then
      raise exception 'idempotency key already exists with different usage data';
    end if;
    return existing.id;
  end if;

  insert into public.usage_events (organization_id, metric_key, quantity, idempotency_key, source_kind, occurred_at)
  values (target_organization_id, requested_metric_key, quantity_value, event_key, source_value, occurred_at_value)
  returning id into new_id;

  return new_id;
exception
  when unique_violation then
    select * into existing
    from public.usage_events ue
    where ue.organization_id = target_organization_id and ue.idempotency_key = event_key;
    if found and existing.metric_key = requested_metric_key and existing.quantity = quantity_value and existing.source_kind = source_value then
      return existing.id;
    end if;
    raise;
end;
$$;

create or replace function public.get_organization_plan_summary(target_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_organization_plan_summary(target_organization_id);
$$;

create or replace function public.has_organization_entitlement(target_organization_id uuid, requested_feature_key text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.has_organization_entitlement(target_organization_id, requested_feature_key);
$$;

create or replace function public.record_organization_usage(
  target_organization_id uuid,
  requested_metric_key text,
  quantity_value numeric,
  event_key text,
  source_value text,
  occurred_at_value timestamptz
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.record_organization_usage(target_organization_id, requested_metric_key, quantity_value, event_key, source_value, occurred_at_value);
$$;

revoke all on function app_private.initialize_organization_subscription() from public, anon, authenticated, service_role;
revoke all on function app_private.prevent_usage_event_mutation() from public, anon, authenticated, service_role;
revoke all on function app_private.get_organization_plan_summary(uuid) from public, anon, authenticated, service_role;
revoke all on function app_private.has_organization_entitlement(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app_private.record_organization_usage(uuid, text, numeric, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.get_organization_plan_summary(uuid) from public, anon, authenticated, service_role;
revoke all on function public.has_organization_entitlement(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_organization_usage(uuid, text, numeric, text, text, timestamptz) from public, anon, authenticated, service_role;

grant usage on schema app_private to authenticated, service_role;
grant execute on function app_private.get_organization_plan_summary(uuid) to authenticated;
grant execute on function app_private.has_organization_entitlement(uuid, text) to authenticated;
grant execute on function app_private.record_organization_usage(uuid, text, numeric, text, text, timestamptz) to service_role;
grant execute on function public.get_organization_plan_summary(uuid) to authenticated;
grant execute on function public.has_organization_entitlement(uuid, text) to authenticated;
grant execute on function public.record_organization_usage(uuid, text, numeric, text, text, timestamptz) to service_role;
