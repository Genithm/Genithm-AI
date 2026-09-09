-- Security Event Ingestion RPC V1
-- Controlled internal boundary for recording security telemetry.

create or replace function app_private.record_security_event(
  p_event_type text,
  p_severity text,
  p_source text,
  p_organization_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_event_id uuid := gen_random_uuid();
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_event_type is null or char_length(p_event_type) < 3 then
    raise exception 'invalid security event type' using errcode = '22023';
  end if;

  if p_severity not in ('info','low','medium','high','critical') then
    raise exception 'invalid security severity' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'security metadata must be an object' using errcode = '22023';
  end if;

  insert into app_private.security_events(
    event_id,
    organization_id,
    actor_user_id,
    event_type,
    severity,
    source,
    metadata
  ) values (
    new_event_id,
    p_organization_id,
    caller_id,
    p_event_type,
    p_severity,
    p_source,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return new_event_id;
end;
$$;

revoke all on function app_private.record_security_event(text,text,text,uuid,jsonb)
from public, anon, authenticated, service_role;

grant execute on function app_private.record_security_event(text,text,text,uuid,jsonb)
to authenticated;

create or replace function public.record_security_event(
  event_type text,
  severity text,
  source text,
  organization_id uuid default null,
  metadata jsonb default '{}'::jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.record_security_event(
    event_type,
    severity,
    source,
    organization_id,
    metadata
  );
$$;

revoke all on function public.record_security_event(text,text,text,uuid,jsonb)
from public, anon;

grant execute on function public.record_security_event(text,text,text,uuid,jsonb)
to authenticated;

comment on function public.record_security_event(text,text,text,uuid,jsonb) is
  'Authenticated security telemetry ingestion boundary. Raw security tables remain private.';
