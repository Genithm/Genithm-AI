-- Security Operations Admin Boundary V1
-- Restrict operational security reads to platform administrators and add bounded event/signal readers.

create or replace function app_private.get_security_operations_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  return jsonb_build_object(
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
end;
$$;

create or replace function app_private.get_recent_security_events(p_limit integer default 50)
returns table (
  event_id uuid,
  event_type text,
  severity text,
  source text,
  occurred_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  select
    security_event.event_id,
    security_event.event_type,
    security_event.severity,
    security_event.source,
    security_event.occurred_at
  from app_private.security_events as security_event
  order by security_event.occurred_at desc
  limit p_limit;
end;
$$;

create or replace function app_private.get_recent_security_detection_signals(p_limit integer default 50)
returns table (
  signal_id uuid,
  signal_type text,
  confidence numeric,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  select
    signal.signal_id,
    signal.signal_type,
    signal.confidence,
    signal.created_at
  from app_private.security_detection_signals as signal
  order by signal.created_at desc
  limit p_limit;
end;
$$;

revoke all on function app_private.get_recent_security_events(integer)
from public, anon, authenticated, service_role;
revoke all on function app_private.get_recent_security_detection_signals(integer)
from public, anon, authenticated, service_role;

grant execute on function app_private.get_recent_security_events(integer) to authenticated;
grant execute on function app_private.get_recent_security_detection_signals(integer) to authenticated;

create or replace function public.get_recent_security_events(event_limit integer default 50)
returns table (
  event_id uuid,
  event_type text,
  severity text,
  source text,
  occurred_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.get_recent_security_events(event_limit);
$$;

create or replace function public.get_recent_security_detection_signals(signal_limit integer default 50)
returns table (
  signal_id uuid,
  signal_type text,
  confidence numeric,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.get_recent_security_detection_signals(signal_limit);
$$;

revoke all on function public.get_recent_security_events(integer)
from public, anon, authenticated, service_role;
revoke all on function public.get_recent_security_detection_signals(integer)
from public, anon, authenticated, service_role;

grant execute on function public.get_recent_security_events(integer) to authenticated;
grant execute on function public.get_recent_security_detection_signals(integer) to authenticated;

comment on function public.get_recent_security_events(integer) is
  'Platform-admin-only bounded security event reader. Private event metadata is never returned.';
comment on function public.get_recent_security_detection_signals(integer) is
  'Platform-admin-only bounded security detection signal reader.';
