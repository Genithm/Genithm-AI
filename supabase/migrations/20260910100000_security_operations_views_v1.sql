-- Security Operations Read Models V1
-- Bounded views for future security operations dashboard.

create or replace view app_private.security_event_summary as
select
  date_trunc('hour', occurred_at) as bucket,
  severity,
  event_type,
  count(*)::bigint as event_count
from app_private.security_events
where occurred_at > now() - interval '30 days'
group by date_trunc('hour', occurred_at), severity, event_type;

revoke all on table app_private.security_event_summary from public, anon, authenticated, service_role;

create or replace function app_private.get_security_operations_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'last_24_hours',
      coalesce((
        select jsonb_object_agg(severity, total)
        from (
          select severity, count(*)::bigint as total
          from app_private.security_events
          where occurred_at > now() - interval '24 hours'
          group by severity
        ) grouped
      ), '{}'::jsonb),
    'critical_events',
      (select count(*)::bigint
       from app_private.security_events
       where severity = 'critical'
       and occurred_at > now() - interval '24 hours'),
    'detection_signals',
      (select count(*)::bigint
       from app_private.security_detection_signals
       where created_at > now() - interval '24 hours')
  );
$$;

revoke all on function app_private.get_security_operations_summary()
from public, anon, authenticated, service_role;

grant execute on function app_private.get_security_operations_summary()
to authenticated;

create or replace function public.get_security_operations_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_security_operations_summary();
$$;

revoke all on function public.get_security_operations_summary()
from public, anon;

grant execute on function public.get_security_operations_summary()
to authenticated;

comment on function public.get_security_operations_summary() is
  'Bounded security operations metrics. Does not expose raw security telemetry.';
