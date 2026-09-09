-- Security Operations Foundation V1
-- Initial security telemetry boundary for privileged operations and future detection pipelines.

create table if not exists app_private.security_events (
  event_id uuid primary key,
  organization_id uuid,
  actor_user_id uuid,
  event_type text not null,
  severity text not null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint security_events_type_check check (char_length(event_type) between 3 and 128),
  constraint security_events_severity_check check (severity in ('info','low','medium','high','critical')),
  constraint security_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists security_events_time_idx
  on app_private.security_events (occurred_at desc);

create index if not exists security_events_actor_idx
  on app_private.security_events (actor_user_id, occurred_at desc)
  where actor_user_id is not null;

alter table app_private.security_events enable row level security;
alter table app_private.security_events force row level security;

revoke all on table app_private.security_events from public, anon, authenticated, service_role;

create table if not exists app_private.security_detection_signals (
  signal_id uuid primary key,
  event_id uuid not null references app_private.security_events(event_id),
  signal_type text not null,
  confidence numeric not null,
  created_at timestamptz not null default now(),
  constraint security_detection_confidence_check check (confidence >= 0 and confidence <= 1)
);

create index if not exists security_detection_signals_event_idx
  on app_private.security_detection_signals(event_id);

revoke all on table app_private.security_detection_signals from public, anon, authenticated, service_role;

comment on table app_private.security_events is
  'Internal security telemetry stream. Access is restricted to future security operations boundaries.';

comment on table app_private.security_detection_signals is
  'Detection layer output for anomaly and threat classification pipelines.';
