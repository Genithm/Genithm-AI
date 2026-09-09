-- Payment Provider Health & Reconciliation V1
-- Keeps provider repair attempts auditable without retaining raw webhook payloads.

create table public.billing_provider_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null references public.billing_payment_providers(provider_key) on delete restrict,
  livemode boolean not null,
  reconciliation_scope text not null default 'platform',
  organization_id uuid references public.organizations(id) on delete set null,
  trigger_source text not null default 'admin',
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'running',
  target_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  result_summary jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_provider_reconciliation_scope check (reconciliation_scope in ('platform','organization')),
  constraint billing_provider_reconciliation_trigger check (trigger_source in ('admin','member','system')),
  constraint billing_provider_reconciliation_status check (status in ('running','succeeded','partial','failed')),
  constraint billing_provider_reconciliation_counts check (target_count >= 0 and success_count >= 0 and failure_count >= 0 and success_count + failure_count <= target_count),
  constraint billing_provider_reconciliation_scope_org check (
    (reconciliation_scope='platform' and organization_id is null)
    or (reconciliation_scope='organization' and organization_id is not null)
  ),
  constraint billing_provider_reconciliation_error check (error_code is null or char_length(error_code) <= 120),
  constraint billing_provider_reconciliation_result_object check (jsonb_typeof(result_summary)='object')
);

create index billing_provider_reconciliation_provider_started_idx
  on public.billing_provider_reconciliation_runs(provider_key, livemode, started_at desc);
create index billing_provider_reconciliation_status_started_idx
  on public.billing_provider_reconciliation_runs(status, started_at desc);
create index billing_provider_reconciliation_org_started_idx
  on public.billing_provider_reconciliation_runs(organization_id, started_at desc)
  where organization_id is not null;
create index billing_provider_reconciliation_requested_by_idx
  on public.billing_provider_reconciliation_runs(requested_by)
  where requested_by is not null;

create trigger billing_provider_reconciliation_runs_updated_at
before update on public.billing_provider_reconciliation_runs
for each row execute function app_private.set_updated_at();

alter table public.billing_provider_reconciliation_runs enable row level security;
alter table public.billing_provider_reconciliation_runs force row level security;

create policy billing_provider_reconciliation_runs_deny_direct
on public.billing_provider_reconciliation_runs
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table public.billing_provider_reconciliation_runs from public, anon, authenticated, service_role;

alter table public.billing_provider_webhook_events
  add column resolved_at timestamptz,
  add column resolution_code text,
  add column resolved_by_reconciliation_run_id uuid references public.billing_provider_reconciliation_runs(id) on delete set null,
  add constraint billing_provider_webhook_events_resolution_code check (resolution_code is null or char_length(resolution_code) <= 120);

alter table public.billing_provider_events
  add column resolved_at timestamptz,
  add column resolution_code text,
  add column resolved_by_reconciliation_run_id uuid references public.billing_provider_reconciliation_runs(id) on delete set null,
  add constraint billing_provider_events_resolution_code check (resolution_code is null or char_length(resolution_code) <= 120);

create index billing_provider_webhook_events_unresolved_failed_idx
  on public.billing_provider_webhook_events(provider_key, livemode, last_received_at desc)
  where processing_status='failed' and resolved_at is null;
create index billing_provider_webhook_events_reconciliation_idx
  on public.billing_provider_webhook_events(resolved_by_reconciliation_run_id)
  where resolved_by_reconciliation_run_id is not null;
create index billing_provider_events_unresolved_failed_idx
  on public.billing_provider_events(livemode, last_received_at desc)
  where processing_status='failed' and resolved_at is null;
create index billing_provider_events_reconciliation_idx
  on public.billing_provider_events(resolved_by_reconciliation_run_id)
  where resolved_by_reconciliation_run_id is not null;

create or replace function app_private.begin_provider_reconciliation(
  p_provider_key text,
  p_livemode boolean,
  p_reconciliation_scope text,
  p_organization_id uuid,
  p_trigger_source text,
  p_requested_by uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path=''
as $$
declare target_id uuid;
begin
  if not exists(select 1 from public.billing_payment_providers p where p.provider_key=p_provider_key and p.status<>'disabled') then
    raise exception 'unsupported payment provider';
  end if;
  if p_reconciliation_scope not in ('platform','organization') then raise exception 'invalid reconciliation scope'; end if;
  if p_trigger_source not in ('admin','member','system') then raise exception 'invalid reconciliation trigger'; end if;
  if (p_reconciliation_scope='platform' and p_organization_id is not null)
     or (p_reconciliation_scope='organization' and p_organization_id is null) then
    raise exception 'reconciliation scope and organization do not match';
  end if;

  insert into public.billing_provider_reconciliation_runs(
    provider_key,livemode,reconciliation_scope,organization_id,trigger_source,requested_by,status
  ) values(
    p_provider_key,p_livemode,p_reconciliation_scope,p_organization_id,p_trigger_source,p_requested_by,'running'
  ) returning id into target_id;
  return target_id;
end;
$$;

create or replace function app_private.finish_provider_reconciliation(
  p_run_id uuid,
  p_status text,
  p_target_count integer,
  p_success_count integer,
  p_failure_count integer,
  p_result_summary jsonb default '{}'::jsonb,
  p_error_code text default null
)
returns void
language plpgsql
volatile
security definer
set search_path=''
as $$
begin
  if p_status not in ('succeeded','partial','failed') then raise exception 'invalid reconciliation completion status'; end if;
  if p_target_count < 0 or p_success_count < 0 or p_failure_count < 0 or p_success_count + p_failure_count > p_target_count then
    raise exception 'invalid reconciliation counts';
  end if;
  if jsonb_typeof(coalesce(p_result_summary,'{}'::jsonb)) <> 'object' then raise exception 'reconciliation summary must be an object'; end if;

  update public.billing_provider_reconciliation_runs
  set status=p_status,
      target_count=p_target_count,
      success_count=p_success_count,
      failure_count=p_failure_count,
      result_summary=coalesce(p_result_summary,'{}'::jsonb),
      error_code=case when p_status in ('partial','failed') then left(coalesce(p_error_code,'provider_reconciliation_failed'),120) else null end,
      finished_at=now(),
      updated_at=now()
  where id=p_run_id and status='running';
  if not found then raise exception 'running provider reconciliation was not found'; end if;
end;
$$;

create or replace function app_private.mark_payment_provider_connection_degraded(
  p_provider_key text,
  p_livemode boolean,
  p_error_code text
)
returns uuid
language plpgsql
volatile
security definer
set search_path=''
as $$
declare target_id uuid;
begin
  if not exists(select 1 from public.billing_payment_providers where provider_key=p_provider_key) then raise exception 'unsupported payment provider'; end if;
  insert into public.billing_provider_connections(
    provider_key,livemode,connection_scope,connection_status,capabilities,last_error_code
  ) values(
    p_provider_key,p_livemode,'platform','degraded','{}'::text[],left(coalesce(p_error_code,'provider_verification_failed'),120)
  )
  on conflict(provider_key,livemode,connection_scope) do update
  set connection_status='degraded',
      last_error_code=excluded.last_error_code,
      updated_at=now()
  returning id into target_id;
  return target_id;
end;
$$;

create or replace function app_private.get_provider_reconciliation_targets(
  p_provider_key text,
  p_livemode boolean,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare result jsonb; safe_limit integer := least(greatest(coalesce(p_limit,100),1),250);
begin
  if p_provider_key not in ('stripe','paypal','wise') then raise exception 'unsupported payment provider'; end if;

  select jsonb_build_object(
    'provider_key',p_provider_key,
    'livemode',p_livemode,
    'subscriptions',coalesce((
      select jsonb_agg(x.payload order by x.last_synced_at desc)
      from (
        select jsonb_build_object(
          'organization_id',s.organization_id,
          'external_subscription_id',s.external_subscription_id,
          'external_customer_id',s.external_customer_id,
          'external_price_id',m.external_price_id,
          'provider_status',s.provider_status,
          'last_synced_at',s.last_synced_at
        ) payload,s.last_synced_at
        from public.billing_provider_external_subscriptions s
        left join public.billing_provider_plan_mappings m
          on m.billing_price_id=s.billing_price_id and m.provider_key=s.provider_key and m.livemode=s.livemode
        where s.provider_key=p_provider_key and s.livemode=p_livemode
        order by s.last_synced_at desc
        limit safe_limit
      ) x
    ),'[]'::jsonb),
    'stripe_customers',case when p_provider_key='stripe' then coalesce((
      select jsonb_agg(x.payload order by x.updated_at desc)
      from (
        select jsonb_build_object('organization_id',c.organization_id,'provider_customer_id',c.provider_customer_id) payload,c.updated_at
        from public.billing_provider_customers c
        where c.provider='stripe' and c.livemode=p_livemode
        order by c.updated_at desc
        limit safe_limit
      ) x
    ),'[]'::jsonb) else '[]'::jsonb end,
    'transfers',case when p_provider_key='wise' then coalesce((
      select jsonb_agg(x.payload order by x.last_synced_at desc)
      from (
        select jsonb_build_object(
          'external_transfer_id',t.external_transfer_id,
          'external_profile_id',t.external_profile_id,
          'external_recipient_id',t.external_recipient_id,
          'status',t.status,
          'last_synced_at',t.last_synced_at
        ) payload,t.last_synced_at
        from public.billing_provider_transfers t
        where t.provider_key='wise' and t.livemode=p_livemode
        order by t.last_synced_at desc
        limit safe_limit
      ) x
    ),'[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end;
$$;

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
declare run_started timestamptz; run_status text; run_provider text; run_mode boolean; affected integer := 0; changed integer := 0;
begin
  select started_at,status,provider_key,livemode into run_started,run_status,run_provider,run_mode
  from public.billing_provider_reconciliation_runs where id=p_reconciliation_run_id;
  if run_started is null or run_status <> 'succeeded' or run_provider <> p_provider_key or run_mode <> p_livemode then
    raise exception 'successful matching reconciliation run is required';
  end if;

  update public.billing_provider_webhook_events
  set resolved_at=now(),resolution_code='authoritative_reconciliation',resolved_by_reconciliation_run_id=p_reconciliation_run_id
  where provider_key=p_provider_key and livemode=p_livemode and processing_status='failed' and resolved_at is null and last_received_at <= run_started;
  get diagnostics affected = row_count;

  if p_provider_key='stripe' then
    update public.billing_provider_events
    set resolved_at=now(),resolution_code='authoritative_reconciliation',resolved_by_reconciliation_run_id=p_reconciliation_run_id
    where provider='stripe' and livemode=p_livemode and processing_status='failed' and resolved_at is null and last_received_at <= run_started;
    get diagnostics changed = row_count;
    affected := affected + changed;
  end if;

  return affected;
end;
$$;

create or replace function app_private.get_platform_admin_provider_health()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not app_private.is_platform_admin() then
    raise exception 'platform admin access denied' using errcode='42501';
  end if;

  with connection_rows as (
    select p.provider_key,p.display_name,p.provider_kind,p.capabilities as supported_capabilities,
           c.id as connection_id,c.livemode,c.connection_status,c.capabilities as connection_capabilities,
           c.last_verified_at,c.last_error_code
    from public.billing_payment_providers p
    left join public.billing_provider_connections c on c.provider_key=p.provider_key and c.connection_scope='platform'
    where p.status<>'disabled'
  ), health_metrics as (
    select cr.*,
      coalesce(wh.unresolved_failed_webhooks,0) unresolved_failed_webhooks,
      wh.last_webhook_at,
      coalesce(sm.active_subscriptions,0) active_subscriptions,
      coalesce(sm.stale_subscriptions,0) stale_subscriptions,
      coalesce(dm.subscription_drift_count,0) subscription_drift_count,
      coalesce(tm.inflight_transfers,0) inflight_transfers,
      coalesce(tm.stale_transfers,0) stale_transfers,
      rr.last_reconciliation_at,rr.last_reconciliation_status,rr.last_reconciliation_error
    from connection_rows cr
    left join lateral (
      select count(*) filter(where e.processing_status='failed' and e.resolved_at is null) unresolved_failed_webhooks,
             max(e.last_received_at) last_webhook_at
      from (
        select processing_status,resolved_at,last_received_at
        from public.billing_provider_webhook_events g
        where cr.livemode is not null and g.provider_key=cr.provider_key and g.livemode=cr.livemode
        union all
        select processing_status,resolved_at,last_received_at
        from public.billing_provider_events s
        where cr.livemode is not null and cr.provider_key='stripe' and s.provider='stripe' and s.livemode=cr.livemode
      ) e
    ) wh on true
    left join lateral (
      select count(*) filter(where lower(s.provider_status) in ('approval_pending','approved','incomplete','trialing','active','past_due','unpaid','paused','suspended')) active_subscriptions,
             count(*) filter(where lower(s.provider_status) in ('approval_pending','approved','incomplete','trialing','active','past_due','unpaid','paused','suspended') and s.last_synced_at < now()-interval '24 hours') stale_subscriptions
      from public.billing_provider_external_subscriptions s
      where cr.livemode is not null and s.provider_key=cr.provider_key and s.livemode=cr.livemode
    ) sm on true
    left join lateral (
      select count(*) subscription_drift_count
      from (
        select distinct on (s.organization_id) s.organization_id,s.provider_status,s.billing_price_id,bp.plan_id,s.last_synced_at
        from public.billing_provider_external_subscriptions s
        join public.billing_prices bp on bp.id=s.billing_price_id
        where cr.livemode is not null and s.provider_key=cr.provider_key and s.livemode=cr.livemode
        order by s.organization_id,s.last_synced_at desc
      ) latest
      left join public.organization_subscriptions os on os.organization_id=latest.organization_id
      where (
        lower(latest.provider_status) in ('approval_pending','approved','incomplete','trialing','active','past_due','unpaid','paused','suspended')
        and (os.organization_id is null or os.plan_id<>latest.plan_id or os.assignment_source<>'provider')
      ) or (
        lower(latest.provider_status) in ('cancelled','canceled','expired','incomplete_expired')
        and os.organization_id is not null and os.plan_id=latest.plan_id and os.assignment_source='provider'
      )
    ) dm on true
    left join lateral (
      select count(*) filter(where lower(t.status) not in ('outgoing_payment_sent','completed','delivered','cancelled','canceled','funds_refunded','refunded','bounced_back','charged_back','failed')) inflight_transfers,
             count(*) filter(where lower(t.status) not in ('outgoing_payment_sent','completed','delivered','cancelled','canceled','funds_refunded','refunded','bounced_back','charged_back','failed') and t.last_synced_at < now()-interval '24 hours') stale_transfers
      from public.billing_provider_transfers t
      where cr.livemode is not null and cr.provider_key='wise' and t.provider_key='wise' and t.livemode=cr.livemode
    ) tm on true
    left join lateral (
      select r.finished_at last_reconciliation_at,r.status last_reconciliation_status,r.error_code last_reconciliation_error
      from public.billing_provider_reconciliation_runs r
      where cr.livemode is not null and r.provider_key=cr.provider_key and r.livemode=cr.livemode
      order by r.started_at desc limit 1
    ) rr on true
  ), health_entries as (
    select hm.*,
      case
        when hm.connection_id is null then 'unconfigured'
        when hm.connection_status in ('credentials_missing','degraded','disabled') then 'degraded'
        when hm.connection_status <> 'verified' then 'warning'
        when hm.unresolved_failed_webhooks > 0 or hm.subscription_drift_count > 0 or hm.last_reconciliation_status in ('failed','partial') then 'degraded'
        when hm.last_verified_at is null or hm.last_verified_at < now()-interval '24 hours' or hm.stale_subscriptions > 0 or hm.stale_transfers > 0 then 'warning'
        else 'healthy'
      end health_status
    from health_metrics hm
  )
  select jsonb_build_object(
    'generated_at',now(),
    'thresholds',jsonb_build_object('verification_stale_hours',24,'sync_stale_hours',24),
    'healthy_count',(select count(*) from health_entries where health_status='healthy'),
    'warning_count',(select count(*) from health_entries where health_status='warning'),
    'degraded_count',(select count(*) from health_entries where health_status='degraded'),
    'unconfigured_count',(select count(*) from health_entries where health_status='unconfigured'),
    'providers',coalesce((select jsonb_agg(jsonb_build_object(
      'provider_key',h.provider_key,
      'display_name',h.display_name,
      'provider_kind',h.provider_kind,
      'supported_capabilities',h.supported_capabilities,
      'livemode',h.livemode,
      'connection_status',coalesce(h.connection_status,'credentials_missing'),
      'connection_capabilities',coalesce(h.connection_capabilities,'{}'::text[]),
      'last_verified_at',h.last_verified_at,
      'verification_stale',case when h.connection_id is null then null else (h.last_verified_at is null or h.last_verified_at < now()-interval '24 hours') end,
      'last_error_code',h.last_error_code,
      'unresolved_failed_webhooks',h.unresolved_failed_webhooks,
      'last_webhook_at',h.last_webhook_at,
      'active_subscriptions',h.active_subscriptions,
      'stale_subscriptions',h.stale_subscriptions,
      'subscription_drift_count',h.subscription_drift_count,
      'inflight_transfers',h.inflight_transfers,
      'stale_transfers',h.stale_transfers,
      'last_reconciliation_at',h.last_reconciliation_at,
      'last_reconciliation_status',h.last_reconciliation_status,
      'last_reconciliation_error',h.last_reconciliation_error,
      'health_status',h.health_status
    ) order by h.provider_key,h.livemode nulls first) from health_entries h),'[]'::jsonb),
    'recent_reconciliations',coalesce((select jsonb_agg(x.payload order by x.started_at desc) from (
      select jsonb_build_object(
        'run_id',r.id,'provider_key',r.provider_key,'livemode',r.livemode,'status',r.status,
        'trigger_source',r.trigger_source,'target_count',r.target_count,'success_count',r.success_count,
        'failure_count',r.failure_count,'error_code',r.error_code,'started_at',r.started_at,'finished_at',r.finished_at,
        'result_summary',r.result_summary
      ) payload,r.started_at
      from public.billing_provider_reconciliation_runs r order by r.started_at desc limit 20
    ) x),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.get_platform_admin_provider_health()
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.get_platform_admin_provider_health();
$$;
create or replace function public.begin_provider_reconciliation(provider_key text,livemode boolean,reconciliation_scope text,organization_id uuid,trigger_source text,requested_by uuid)
returns uuid language sql volatile security invoker set search_path='' as $$
  select app_private.begin_provider_reconciliation(provider_key,livemode,reconciliation_scope,organization_id,trigger_source,requested_by);
$$;
create or replace function public.finish_provider_reconciliation(run_id uuid,status text,target_count integer,success_count integer,failure_count integer,result_summary jsonb default '{}'::jsonb,error_code text default null)
returns void language sql volatile security invoker set search_path='' as $$
  select app_private.finish_provider_reconciliation(run_id,status,target_count,success_count,failure_count,result_summary,error_code);
$$;
create or replace function public.mark_payment_provider_connection_degraded(provider_key text,livemode boolean,error_code text)
returns uuid language sql volatile security invoker set search_path='' as $$
  select app_private.mark_payment_provider_connection_degraded(provider_key,livemode,error_code);
$$;
create or replace function public.get_provider_reconciliation_targets(provider_key text,livemode boolean,limit_count integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
  select app_private.get_provider_reconciliation_targets(provider_key,livemode,limit_count);
$$;
create or replace function public.resolve_failed_provider_webhooks(provider_key text,livemode boolean,reconciliation_run_id uuid)
returns integer language sql volatile security invoker set search_path='' as $$
  select app_private.resolve_failed_provider_webhooks(provider_key,livemode,reconciliation_run_id);
$$;

revoke all on function app_private.get_platform_admin_provider_health(),public.get_platform_admin_provider_health() from public,anon,authenticated,service_role;
grant execute on function app_private.get_platform_admin_provider_health(),public.get_platform_admin_provider_health() to authenticated;

revoke all on function app_private.begin_provider_reconciliation(text,boolean,text,uuid,text,uuid),
  app_private.finish_provider_reconciliation(uuid,text,integer,integer,integer,jsonb,text),
  app_private.mark_payment_provider_connection_degraded(text,boolean,text),
  app_private.get_provider_reconciliation_targets(text,boolean,integer),
  app_private.resolve_failed_provider_webhooks(text,boolean,uuid)
from public,anon,authenticated,service_role;
revoke all on function public.begin_provider_reconciliation(text,boolean,text,uuid,text,uuid),
  public.finish_provider_reconciliation(uuid,text,integer,integer,integer,jsonb,text),
  public.mark_payment_provider_connection_degraded(text,boolean,text),
  public.get_provider_reconciliation_targets(text,boolean,integer),
  public.resolve_failed_provider_webhooks(text,boolean,uuid)
from public,anon,authenticated,service_role;

grant execute on function app_private.begin_provider_reconciliation(text,boolean,text,uuid,text,uuid),
  app_private.finish_provider_reconciliation(uuid,text,integer,integer,integer,jsonb,text),
  app_private.mark_payment_provider_connection_degraded(text,boolean,text),
  app_private.get_provider_reconciliation_targets(text,boolean,integer),
  app_private.resolve_failed_provider_webhooks(text,boolean,uuid)
to service_role;
grant execute on function public.begin_provider_reconciliation(text,boolean,text,uuid,text,uuid),
  public.finish_provider_reconciliation(uuid,text,integer,integer,integer,jsonb,text),
  public.mark_payment_provider_connection_degraded(text,boolean,text),
  public.get_provider_reconciliation_targets(text,boolean,integer),
  public.resolve_failed_provider_webhooks(text,boolean,uuid)
to service_role;

comment on table public.billing_provider_reconciliation_runs is 'Audit ledger for authoritative provider re-reads. Raw provider payloads and credentials are never stored.';
comment on function public.get_platform_admin_provider_health() is 'Platform-admin health view across provider connections, webhooks, subscriptions, transfers and reconciliation runs.';
