create table app_private.worker_runtime_heartbeats (
  worker_kind text primary key,
  worker_version text not null,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  heartbeat_count bigint not null default 1,
  constraint worker_runtime_heartbeats_kind_check check (
    worker_kind in (
      'sequence_worker',
      'source_worker',
      'blast_worker',
      'scientific_worker',
      'audit_worker',
      'ai_worker'
    )
  ),
  constraint worker_runtime_heartbeats_version_check check (
    length(worker_version) between 1 and 128
    and worker_version ~ '^[A-Za-z0-9._:/+\\-]+$'
  ),
  constraint worker_runtime_heartbeats_count_check check (heartbeat_count > 0)
);

alter table app_private.worker_runtime_heartbeats enable row level security;
alter table app_private.worker_runtime_heartbeats force row level security;
revoke all on table app_private.worker_runtime_heartbeats from public, anon, authenticated, service_role;

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
  on conflict (worker_kind) do update
  set worker_version = excluded.worker_version,
      last_seen_at = clock_timestamp(),
      heartbeat_count = heartbeat.heartbeat_count + 1;
end;
$$;

revoke all on function app_private.record_worker_heartbeat(text, text) from public, anon, authenticated, service_role;
grant execute on function app_private.record_worker_heartbeat(text, text) to service_role;

create or replace function public.record_worker_heartbeat(
  worker_kind text,
  worker_version text
)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.record_worker_heartbeat(worker_kind, worker_version);
$$;

revoke all on function public.record_worker_heartbeat(text, text) from public, anon, authenticated, service_role;
grant execute on function public.record_worker_heartbeat(text, text) to service_role;

create or replace function app_private.get_release_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  expected_queues constant text[] := array[
    'ai_evidence_followup',
    'ai_interpretation',
    'ai_planning',
    'audit_checkpoint_signing',
    'blast_remote',
    'ncbi_sequence_retrieval',
    'protein_annotation',
    'scientific_standard',
    'sequence_validation'
  ];
  expected_workers constant text[] := array[
    'ai_worker',
    'audit_worker',
    'blast_worker',
    'scientific_worker',
    'sequence_worker',
    'source_worker'
  ];
  heartbeat_stale_after_seconds constant integer := 300;
  missing_queues text[];
  stale_queues text[];
  total_backlog bigint;
  max_oldest_message_age_seconds integer;
  missing_workers text[];
  stale_workers text[];
  max_worker_heartbeat_age_seconds integer;
begin
  select
    coalesce(array_agg(expected.queue_name order by expected.queue_name) filter (where metrics.queue_name is null), array[]::text[]),
    coalesce(array_agg(metrics.queue_name order by metrics.queue_name) filter (
      where metrics.queue_length > 0 and metrics.oldest_msg_age_sec > 900
    ), array[]::text[]),
    coalesce(sum(metrics.queue_length), 0),
    max(metrics.oldest_msg_age_sec)
  into missing_queues, stale_queues, total_backlog, max_oldest_message_age_seconds
  from unnest(expected_queues) as expected(queue_name)
  left join pgmq.metrics_all() as metrics on metrics.queue_name = expected.queue_name;

  select
    coalesce(array_agg(expected.worker_kind order by expected.worker_kind) filter (where heartbeat.worker_kind is null), array[]::text[]),
    coalesce(array_agg(expected.worker_kind order by expected.worker_kind) filter (
      where heartbeat.worker_kind is not null
        and heartbeat.last_seen_at < now() - (heartbeat_stale_after_seconds * interval '1 second')
    ), array[]::text[]),
    max(
      greatest(
        0,
        floor(extract(epoch from (now() - heartbeat.last_seen_at)))::integer
      )
    ) filter (where heartbeat.worker_kind is not null)
  into missing_workers, stale_workers, max_worker_heartbeat_age_seconds
  from unnest(expected_workers) as expected(worker_kind)
  left join app_private.worker_runtime_heartbeats as heartbeat
    on heartbeat.worker_kind = expected.worker_kind;

  return jsonb_build_object(
    'status', case
      when cardinality(missing_queues) = 0
       and cardinality(stale_queues) = 0
       and cardinality(missing_workers) = 0
       and cardinality(stale_workers) = 0 then 'ready'
      else 'not_ready'
    end,
    'expected_queue_count', cardinality(expected_queues),
    'missing_queues', to_jsonb(missing_queues),
    'stale_queues', to_jsonb(stale_queues),
    'total_backlog', total_backlog,
    'max_oldest_message_age_seconds', max_oldest_message_age_seconds,
    'expected_worker_count', cardinality(expected_workers),
    'missing_workers', to_jsonb(missing_workers),
    'stale_workers', to_jsonb(stale_workers),
    'worker_heartbeat_stale_after_seconds', heartbeat_stale_after_seconds,
    'max_worker_heartbeat_age_seconds', max_worker_heartbeat_age_seconds,
    'checked_at', now()
  );
end;
$$;

revoke all on function app_private.get_release_readiness() from public, anon, authenticated, service_role;
grant execute on function app_private.get_release_readiness() to service_role;

comment on table app_private.worker_runtime_heartbeats is
  'Private bounded liveness registry for the six continuous Genithm worker kinds. Contains no queue payloads or user scientific data.';

comment on function public.record_worker_heartbeat(text, text) is
  'Service-only worker liveness signal. Accepts an allowlisted worker kind and bounded runtime version; no user or queue payload data.';

comment on function public.get_release_readiness() is
  'Service-only bounded release-readiness summary. Verifies expected PGMQ queues, flags backlog older than 15 minutes, and requires fresh heartbeats from all six continuous worker kinds without exposing queue message bodies or user data.';
