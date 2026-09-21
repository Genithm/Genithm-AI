create or replace function app_private.record_worker_heartbeat(
  worker_kind text,
  worker_version text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if worker_kind is null or worker_kind not in (
    'sequence_worker',
    'source_worker',
    'blast_worker',
    'scientific_worker',
    'audit_worker',
    'ai_worker'
  ) then
    raise exception 'invalid worker kind' using errcode = '22023';
  end if;

  if worker_version is null
     or length(worker_version) not between 1 and 128
     or worker_version !~ '^[A-Za-z0-9._:/+\\-]+$' then
    raise exception 'invalid worker version' using errcode = '22023';
  end if;

  insert into app_private.worker_runtime_heartbeats as heartbeat (
    worker_kind,
    worker_version,
    first_seen_at,
    last_seen_at,
    heartbeat_count
  )
  values (
    worker_kind,
    worker_version,
    clock_timestamp(),
    clock_timestamp(),
    1
  )
  on conflict on constraint worker_runtime_heartbeats_pkey do update
  set worker_version = excluded.worker_version,
      last_seen_at = clock_timestamp(),
      heartbeat_count = heartbeat.heartbeat_count + 1;
end;
$$;

revoke all on function app_private.record_worker_heartbeat(text, text) from public, anon, authenticated, service_role;
grant execute on function app_private.record_worker_heartbeat(text, text) to service_role;

comment on function app_private.record_worker_heartbeat(text, text) is
  'Service-role worker heartbeat writer. Uses the table primary-key constraint explicitly to avoid PL/pgSQL parameter/column ambiguity.';
