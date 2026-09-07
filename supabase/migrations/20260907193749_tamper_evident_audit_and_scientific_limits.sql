create table app_private.audit_chain_heads (
  organization_id uuid primary key,
  last_sequence bigint not null default 0,
  last_hash text not null default repeat('0', 64),
  updated_at timestamptz not null default now(),
  constraint audit_chain_heads_sequence check (last_sequence >= 0),
  constraint audit_chain_heads_hash check (last_hash ~ '^[0-9a-f]{64}$')
);

revoke all on table app_private.audit_chain_heads from public, anon, authenticated, service_role;

create table public.audit_events (
  event_id uuid primary key,
  organization_id uuid not null,
  project_id uuid,
  actor_user_id uuid,
  actor_type text not null,
  event_type text not null,
  resource_type text not null,
  resource_id text not null,
  outcome text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  chain_sequence bigint not null,
  chain_version text not null default 'sha256-v1',
  previous_hash text not null,
  event_hash text not null,
  constraint audit_events_actor_type check (actor_type in ('user','service','system')),
  constraint audit_events_event_type check (char_length(event_type) between 3 and 128 and event_type ~ '^[A-Z0-9_]+$'),
  constraint audit_events_resource_type check (char_length(resource_type) between 2 and 64 and resource_type ~ '^[a-z0-9_]+$'),
  constraint audit_events_resource_id check (char_length(resource_id) between 1 and 256),
  constraint audit_events_outcome check (outcome in ('created','state_change','completed','failed','reused')),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint audit_events_chain_sequence check (chain_sequence > 0),
  constraint audit_events_chain_version check (chain_version = 'sha256-v1'),
  constraint audit_events_previous_hash check (previous_hash ~ '^[0-9a-f]{64}$'),
  constraint audit_events_event_hash check (event_hash ~ '^[0-9a-f]{64}$'),
  constraint audit_events_org_sequence_unique unique (organization_id, chain_sequence),
  constraint audit_events_hash_unique unique (event_hash)
);

create index audit_events_org_occurred_idx on public.audit_events(organization_id, occurred_at desc);
create index audit_events_project_occurred_idx on public.audit_events(project_id, occurred_at desc) where project_id is not null;
create index audit_events_event_type_idx on public.audit_events(event_type, occurred_at desc);

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;

create policy audit_events_select_org_member
on public.audit_events for select to authenticated
using ((select app_private.is_org_member(organization_id)));

revoke all on table public.audit_events from public, anon, authenticated, service_role;
grant select on table public.audit_events to authenticated;

create or replace function app_private.compute_audit_hash(
  p_event_id uuid,
  p_organization_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_actor_type text,
  p_event_type text,
  p_resource_type text,
  p_resource_id text,
  p_outcome text,
  p_metadata jsonb,
  p_occurred_at timestamptz,
  p_chain_sequence bigint,
  p_previous_hash text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        concat_ws(
          E'\x1f',
          'sha256-v1',
          p_event_id::text,
          p_organization_id::text,
          coalesce(p_project_id::text, ''),
          coalesce(p_actor_user_id::text, ''),
          p_actor_type,
          p_event_type,
          p_resource_type,
          p_resource_id,
          p_outcome,
          coalesce(p_metadata, '{}'::jsonb)::text,
          extract(epoch from p_occurred_at)::text,
          p_chain_sequence::text,
          p_previous_hash
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function app_private.compute_audit_hash(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb,timestamptz,bigint,text) from public, anon, authenticated, service_role;

create or replace function app_private.append_audit_event(
  p_organization_id uuid,
  p_project_id uuid,
  p_actor_user_id uuid,
  p_actor_type text,
  p_event_type text,
  p_resource_type text,
  p_resource_id text,
  p_outcome text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_event_id uuid := gen_random_uuid();
  event_time timestamptz := clock_timestamp();
  prior_hash text;
  prior_sequence bigint;
  next_sequence bigint;
  calculated_hash text;
  normalized_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if p_organization_id is null then
    raise exception 'audit organization is required';
  end if;
  if p_actor_type not in ('user','service','system') then
    raise exception 'invalid audit actor type';
  end if;
  if p_event_type is null or char_length(p_event_type) < 3 or char_length(p_event_type) > 128 or p_event_type !~ '^[A-Z0-9_]+$' then
    raise exception 'invalid audit event type';
  end if;
  if p_resource_type is null or char_length(p_resource_type) < 2 or char_length(p_resource_type) > 64 or p_resource_type !~ '^[a-z0-9_]+$' then
    raise exception 'invalid audit resource type';
  end if;
  if p_resource_id is null or char_length(p_resource_id) < 1 or char_length(p_resource_id) > 256 then
    raise exception 'invalid audit resource id';
  end if;
  if p_outcome not in ('created','state_change','completed','failed','reused') then
    raise exception 'invalid audit outcome';
  end if;
  if jsonb_typeof(normalized_metadata) <> 'object' then
    raise exception 'audit metadata must be an object';
  end if;

  insert into app_private.audit_chain_heads (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;

  select last_sequence, last_hash
    into prior_sequence, prior_hash
    from app_private.audit_chain_heads
   where organization_id = p_organization_id
   for update;

  next_sequence := prior_sequence + 1;
  calculated_hash := app_private.compute_audit_hash(
    new_event_id,
    p_organization_id,
    p_project_id,
    p_actor_user_id,
    p_actor_type,
    p_event_type,
    p_resource_type,
    p_resource_id,
    p_outcome,
    normalized_metadata,
    event_time,
    next_sequence,
    prior_hash
  );

  insert into public.audit_events (
    event_id,
    organization_id,
    project_id,
    actor_user_id,
    actor_type,
    event_type,
    resource_type,
    resource_id,
    outcome,
    metadata,
    occurred_at,
    chain_sequence,
    previous_hash,
    event_hash
  ) values (
    new_event_id,
    p_organization_id,
    p_project_id,
    p_actor_user_id,
    p_actor_type,
    p_event_type,
    p_resource_type,
    p_resource_id,
    p_outcome,
    normalized_metadata,
    event_time,
    next_sequence,
    prior_hash,
    calculated_hash
  );

  update app_private.audit_chain_heads
     set last_sequence = next_sequence,
         last_hash = calculated_hash,
         updated_at = event_time
   where organization_id = p_organization_id;

  return new_event_id;
end;
$$;

revoke all on function app_private.append_audit_event(uuid,uuid,uuid,text,text,text,text,text,jsonb) from public, anon, authenticated, service_role;

create or replace function app_private.prevent_audit_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'audit events are append-only';
end;
$$;

revoke all on function app_private.prevent_audit_event_mutation() from public, anon, authenticated, service_role;

create trigger audit_events_block_update_delete
before update or delete on public.audit_events
for each row execute function app_private.prevent_audit_event_mutation();

create or replace function app_private.verify_audit_chain(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  rec record;
  expected_sequence bigint := 1;
  expected_previous text := repeat('0', 64);
  calculated_hash text;
  event_total bigint := 0;
  head_sequence bigint := 0;
  head_hash text := repeat('0', 64);
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app_private.is_org_member(p_organization_id) then
    raise exception 'organization access denied' using errcode = '42501';
  end if;

  for rec in
    select *
      from public.audit_events
     where organization_id = p_organization_id
     order by chain_sequence
  loop
    calculated_hash := app_private.compute_audit_hash(
      rec.event_id,
      rec.organization_id,
      rec.project_id,
      rec.actor_user_id,
      rec.actor_type,
      rec.event_type,
      rec.resource_type,
      rec.resource_id,
      rec.outcome,
      rec.metadata,
      rec.occurred_at,
      rec.chain_sequence,
      rec.previous_hash
    );

    if rec.chain_sequence <> expected_sequence
       or rec.previous_hash <> expected_previous
       or rec.event_hash <> calculated_hash then
      return jsonb_build_object(
        'valid', false,
        'event_count', event_total,
        'failed_sequence', rec.chain_sequence,
        'chain_version', 'sha256-v1'
      );
    end if;

    event_total := event_total + 1;
    expected_sequence := expected_sequence + 1;
    expected_previous := rec.event_hash;
  end loop;

  select last_sequence, last_hash
    into head_sequence, head_hash
    from app_private.audit_chain_heads
   where organization_id = p_organization_id;

  if not found then
    head_sequence := 0;
    head_hash := repeat('0', 64);
  end if;

  return jsonb_build_object(
    'valid', head_sequence = event_total and head_hash = expected_previous,
    'event_count', event_total,
    'head_sequence', head_sequence,
    'head_hash', head_hash,
    'chain_version', 'sha256-v1'
  );
end;
$$;

revoke all on function app_private.verify_audit_chain(uuid) from public, anon;
grant execute on function app_private.verify_audit_chain(uuid) to authenticated;

create or replace function public.verify_audit_chain(organization_id uuid)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.verify_audit_chain(organization_id);
$$;

revoke all on function public.verify_audit_chain(uuid) from public, anon;
grant execute on function public.verify_audit_chain(uuid) to authenticated;

create table app_private.scientific_rate_limit_policies (
  action text primary key,
  window_seconds integer not null,
  user_limit integer not null,
  organization_limit integer not null,
  constraint scientific_rate_limit_policy_action check (action ~ '^[a-z0-9_]+$'),
  constraint scientific_rate_limit_policy_window check (window_seconds between 1 and 86400),
  constraint scientific_rate_limit_policy_user_limit check (user_limit between 1 and 100000),
  constraint scientific_rate_limit_policy_org_limit check (organization_limit between 1 and 100000)
);

insert into app_private.scientific_rate_limit_policies(action, window_seconds, user_limit, organization_limit)
values
  ('ncbi_retrieval', 300, 30, 120),
  ('blast_analysis', 3600, 10, 50);

revoke all on table app_private.scientific_rate_limit_policies from public, anon, authenticated, service_role;

create table app_private.scientific_rate_limit_buckets (
  action text not null,
  scope_type text not null,
  scope_id uuid not null,
  bucket_start timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (action, scope_type, scope_id, bucket_start),
  constraint scientific_rate_limit_bucket_scope check (scope_type in ('user','organization')),
  constraint scientific_rate_limit_bucket_count check (request_count > 0)
);

create index scientific_rate_limit_buckets_cleanup_idx on app_private.scientific_rate_limit_buckets(bucket_start);
revoke all on table app_private.scientific_rate_limit_buckets from public, anon, authenticated, service_role;

create or replace function app_private.consume_scientific_rate_limit(
  p_action text,
  p_user_id uuid,
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  policy_row app_private.scientific_rate_limit_policies%rowtype;
  bucket_time timestamptz;
  accepted_count integer;
begin
  if p_user_id is null or p_organization_id is null then
    raise exception 'rate limit identity is required';
  end if;

  select * into policy_row
  from app_private.scientific_rate_limit_policies
  where action = p_action;

  if not found then
    raise exception 'unknown scientific rate limit policy';
  end if;

  bucket_time := to_timestamp(
    floor(extract(epoch from statement_timestamp()) / policy_row.window_seconds) * policy_row.window_seconds
  );

  insert into app_private.scientific_rate_limit_buckets(action, scope_type, scope_id, bucket_start, request_count, updated_at)
  values (p_action, 'user', p_user_id, bucket_time, 1, now())
  on conflict (action, scope_type, scope_id, bucket_start)
  do update set request_count = app_private.scientific_rate_limit_buckets.request_count + 1,
                updated_at = now()
  where app_private.scientific_rate_limit_buckets.request_count < policy_row.user_limit
  returning request_count into accepted_count;

  if accepted_count is null then
    raise sqlstate 'PGRST' using
      message = jsonb_build_object('code','RATE_LIMITED','message','Scientific request rate limit exceeded for this user.')::text,
      detail = jsonb_build_object('status',429)::text;
  end if;

  accepted_count := null;
  insert into app_private.scientific_rate_limit_buckets(action, scope_type, scope_id, bucket_start, request_count, updated_at)
  values (p_action, 'organization', p_organization_id, bucket_time, 1, now())
  on conflict (action, scope_type, scope_id, bucket_start)
  do update set request_count = app_private.scientific_rate_limit_buckets.request_count + 1,
                updated_at = now()
  where app_private.scientific_rate_limit_buckets.request_count < policy_row.organization_limit
  returning request_count into accepted_count;

  if accepted_count is null then
    raise sqlstate 'PGRST' using
      message = jsonb_build_object('code','RATE_LIMITED','message','Scientific request rate limit exceeded for this organization.')::text,
      detail = jsonb_build_object('status',429)::text;
  end if;

  delete from app_private.scientific_rate_limit_buckets
   where action = p_action
     and scope_id in (p_user_id, p_organization_id)
     and bucket_start < now() - interval '2 days';
end;
$$;

revoke all on function app_private.consume_scientific_rate_limit(text,uuid,uuid) from public, anon, authenticated, service_role;

create or replace function app_private.audit_sequence_upload_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_kind text;
  event_name text;
  event_outcome text;
  details jsonb;
begin
  actor_kind := case when actor_id is null then 'service' else 'user' end;

  if tg_op = 'INSERT' then
    event_name := 'SEQUENCE_UPLOAD_CREATED';
    event_outcome := 'created';
    actor_id := coalesce(actor_id, new.created_by);
    actor_kind := case when actor_id is null then 'service' else 'user' end;
    details := jsonb_build_object(
      'status', new.status,
      'file_size_bytes', new.file_size_bytes,
      'content_type', new.content_type
    );
  elsif new.status is distinct from old.status then
    event_name := 'SEQUENCE_UPLOAD_STATUS_CHANGED';
    event_outcome := case when new.status = 'ready' then 'completed' when new.status in ('rejected','error') then 'failed' else 'state_change' end;
    details := jsonb_strip_nulls(jsonb_build_object(
      'from_status', old.status,
      'to_status', new.status,
      'sha256', new.sha256,
      'sequence_type', new.sequence_type,
      'sequence_count', new.sequence_count,
      'residue_count', new.residue_count,
      'validator_version', new.validator_version,
      'statistics_version', new.statistics_version
    ));
  else
    return new;
  end if;

  perform app_private.append_audit_event(
    new.organization_id,
    new.project_id,
    actor_id,
    actor_kind,
    event_name,
    'sequence_upload',
    new.id::text,
    event_outcome,
    details
  );
  return new;
end;
$$;

revoke all on function app_private.audit_sequence_upload_change() from public, anon, authenticated, service_role;

create trigger sequence_uploads_audit_events
after insert or update on public.sequence_uploads
for each row execute function app_private.audit_sequence_upload_change();

create or replace function app_private.audit_sequence_retrieval_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_kind text;
  event_name text;
  event_outcome text;
  details jsonb;
begin
  actor_kind := case when actor_id is null then 'service' else 'user' end;

  if tg_op = 'INSERT' then
    actor_id := coalesce(actor_id, new.requested_by);
    actor_kind := case when actor_id is null then 'service' else 'user' end;
    event_name := 'NCBI_RETRIEVAL_CREATED';
    event_outcome := 'created';
    details := jsonb_build_object(
      'database', new.source_database,
      'requested_accession', new.requested_accession,
      'resolution_mode', new.resolution_mode,
      'freshness_policy', new.freshness_policy,
      'status', new.status
    );
  elsif new.status is distinct from old.status then
    event_name := 'NCBI_RETRIEVAL_STATUS_CHANGED';
    event_outcome := case when new.status = 'retrieved' then 'completed' when new.status in ('not_found','rejected','error') then 'failed' else 'state_change' end;
    details := jsonb_strip_nulls(jsonb_build_object(
      'from_status', old.status,
      'to_status', new.status,
      'resolved_accession', new.resolved_accession,
      'connector_version', new.connector_version,
      'source_checked_at', new.source_checked_at,
      'source_response_sha256', new.source_response_sha256,
      'sequence_upload_id', new.sequence_upload_id
    ));
  else
    return new;
  end if;

  perform app_private.append_audit_event(
    new.organization_id,
    new.project_id,
    actor_id,
    actor_kind,
    event_name,
    'sequence_retrieval',
    new.id::text,
    event_outcome,
    details
  );
  return new;
end;
$$;

revoke all on function app_private.audit_sequence_retrieval_change() from public, anon, authenticated, service_role;

create trigger sequence_retrievals_audit_events
after insert or update on public.sequence_retrievals
for each row execute function app_private.audit_sequence_retrieval_change();

create or replace function app_private.audit_blast_job_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_kind text;
  event_name text;
  event_outcome text;
  details jsonb;
begin
  actor_kind := case when actor_id is null then 'service' else 'user' end;

  if tg_op = 'INSERT' then
    actor_id := coalesce(actor_id, new.requested_by);
    actor_kind := case when actor_id is null then 'service' else 'user' end;
    event_name := 'BLAST_JOB_CREATED';
    event_outcome := 'created';
    details := jsonb_build_object(
      'program', new.program,
      'database', new.database_name,
      'query_sha256', new.query_sha256,
      'expect_value', new.expect_value,
      'max_targets', new.max_targets,
      'low_complexity_filter', new.low_complexity_filter,
      'status', new.status
    );
  elsif new.status is distinct from old.status then
    event_name := 'BLAST_JOB_STATUS_CHANGED';
    event_outcome := case when new.status = 'completed' then 'completed' when new.status = 'error' then 'failed' else 'state_change' end;
    details := jsonb_strip_nulls(jsonb_build_object(
      'from_status', old.status,
      'to_status', new.status,
      'service_version', new.service_version,
      'blast_version', new.blast_version,
      'database_reported', new.database_reported,
      'raw_result_sha256', new.raw_result_sha256,
      'hit_count', new.result_summary->'hit_count'
    ));
  else
    return new;
  end if;

  perform app_private.append_audit_event(
    new.organization_id,
    new.project_id,
    actor_id,
    actor_kind,
    event_name,
    'blast_job',
    new.id::text,
    event_outcome,
    details
  );
  return new;
end;
$$;

revoke all on function app_private.audit_blast_job_change() from public, anon, authenticated, service_role;

create trigger blast_jobs_audit_events
after insert or update on public.blast_jobs
for each row execute function app_private.audit_blast_job_change();

create unique index sequence_retrievals_active_dedupe_idx
  on public.sequence_retrievals(project_id, source_database, requested_accession)
  where status in ('queued','retrieving');

create or replace function app_private.request_ncbi_sequence_retrieval(
  p_project_id uuid,
  p_database_name text,
  p_accession text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  normalized_database text := lower(trim(p_database_name));
  normalized_accession text := upper(trim(p_accession));
  existing_id uuid;
  retrieval_id uuid;
  queue_message_id bigint;
  user_active integer;
  org_active integer;
  lock_key text;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if normalized_database not in ('nucleotide', 'protein') then
    raise exception 'unsupported NCBI database';
  end if;

  if char_length(normalized_accession) < 1
     or char_length(normalized_accession) > 64
     or normalized_accession !~ '^[A-Z0-9_]+(\.[0-9]+)?$'
     or normalized_accession !~ '[A-Z]' then
    raise exception 'invalid accession format';
  end if;

  select p.organization_id
    into org_id
    from public.projects p
   where p.id = p_project_id;

  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if not app_private.can_write_org(org_id) then
    raise exception 'project write access denied' using errcode = '42501';
  end if;

  perform app_private.consume_scientific_rate_limit('ncbi_retrieval', caller_id, org_id);

  lock_key := p_project_id::text || '|ncbi|' || normalized_database || '|' || normalized_accession;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_key, 4217));

  select sr.id
    into existing_id
    from public.sequence_retrievals sr
   where sr.project_id = p_project_id
     and sr.source_database = normalized_database
     and sr.requested_accession = normalized_accession
     and sr.status in ('queued', 'retrieving')
   order by sr.created_at desc
   limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  select count(*) into user_active
  from public.sequence_retrievals
  where requested_by = caller_id and status in ('queued','retrieving');

  select count(*) into org_active
  from public.sequence_retrievals
  where organization_id = org_id and status in ('queued','retrieving');

  if user_active >= 5 or org_active >= 25 then
    raise sqlstate 'PGRST' using
      message = jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active NCBI retrievals. Wait for current retrievals to finish.')::text,
      detail = jsonb_build_object('status',429)::text;
  end if;

  insert into public.sequence_retrievals (
    organization_id,
    project_id,
    requested_by,
    source_provider,
    source_database,
    requested_accession
  )
  values (
    org_id,
    p_project_id,
    caller_id,
    'ncbi',
    normalized_database,
    normalized_accession
  )
  returning id into retrieval_id;

  select pgmq.send(
    queue_name => 'ncbi_sequence_retrieval',
    msg => jsonb_build_object('retrieval_id', retrieval_id)
  ) into queue_message_id;

  if queue_message_id is null then
    raise exception 'failed to enqueue NCBI retrieval';
  end if;

  return retrieval_id;
end;
$$;

create or replace function app_private.request_blast_job(
  p_project_id uuid,
  p_query_upload_id uuid,
  p_program text,
  p_database_name text,
  p_expect_value numeric default 10,
  p_max_targets integer default 20,
  p_low_complexity_filter boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  org_id uuid;
  upload_row public.sequence_uploads%rowtype;
  normalized_program text := lower(trim(p_program));
  normalized_database text := lower(trim(p_database_name));
  existing_id uuid;
  job_id uuid;
  queue_message_id bigint;
  lock_key text;
  user_active integer;
  org_active integer;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select p.organization_id into org_id
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if not app_private.can_write_org(org_id) then
    raise exception 'project write access denied' using errcode = '42501';
  end if;

  select * into upload_row
  from public.sequence_uploads
  where id = p_query_upload_id
    and project_id = p_project_id
    and organization_id = org_id;

  if not found then
    raise exception 'query sequence not found' using errcode = 'P0002';
  end if;

  if upload_row.status <> 'ready'
     or upload_row.sha256 is null
     or upload_row.sequence_count <> 1
     or upload_row.residue_count is null
     or upload_row.residue_count < 10
     or upload_row.residue_count > 20000 then
    raise exception 'BLAST V1 requires one validated sequence between 10 and 20000 residues/bases';
  end if;

  if normalized_program = 'blastn' then
    if normalized_database <> 'core_nt' or upload_row.sequence_type not in ('dna','rna') then
      raise exception 'blastn V1 requires a DNA/RNA query and core_nt database';
    end if;
    if upload_row.residue_count < 30 then
      raise exception 'blastn V1 requires at least 30 bases';
    end if;
  elsif normalized_program = 'blastp' then
    if normalized_database <> 'swissprot' or upload_row.sequence_type <> 'protein' then
      raise exception 'blastp V1 requires a protein query and swissprot database';
    end if;
  else
    raise exception 'unsupported BLAST program';
  end if;

  if p_expect_value is null or p_expect_value < 1e-180 or p_expect_value > 1000 then
    raise exception 'E-value must be between 1e-180 and 1000';
  end if;

  if p_max_targets is null or p_max_targets < 1 or p_max_targets > 20 then
    raise exception 'max targets must be between 1 and 20';
  end if;

  perform app_private.consume_scientific_rate_limit('blast_analysis', caller_id, org_id);

  lock_key := p_query_upload_id::text || '|' || normalized_program || '|' || normalized_database || '|' || p_expect_value::text || '|' || p_max_targets::text || '|' || p_low_complexity_filter::text;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lock_key, 0));

  select bj.id into existing_id
  from public.blast_jobs bj
  where bj.query_upload_id = p_query_upload_id
    and bj.program = normalized_program
    and bj.database_name = normalized_database
    and bj.expect_value = p_expect_value
    and bj.max_targets = p_max_targets
    and bj.low_complexity_filter = p_low_complexity_filter
    and bj.status in ('queued','submitting','remote_pending','retrieving')
  order by bj.created_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  select count(*) into user_active
  from public.blast_jobs
  where requested_by = caller_id and status in ('queued','submitting','remote_pending','retrieving');

  select count(*) into org_active
  from public.blast_jobs
  where organization_id = org_id and status in ('queued','submitting','remote_pending','retrieving');

  if user_active >= 3 or org_active >= 12 then
    raise sqlstate 'PGRST' using
      message = jsonb_build_object('code','CONCURRENCY_LIMIT','message','Too many active BLAST analyses. Wait for current analyses to finish.')::text,
      detail = jsonb_build_object('status',429)::text;
  end if;

  insert into public.blast_jobs (
    organization_id,
    project_id,
    requested_by,
    query_upload_id,
    program,
    database_name,
    expect_value,
    max_targets,
    low_complexity_filter,
    query_sha256
  ) values (
    org_id,
    p_project_id,
    caller_id,
    p_query_upload_id,
    normalized_program,
    normalized_database,
    p_expect_value,
    p_max_targets,
    p_low_complexity_filter,
    upload_row.sha256
  ) returning id into job_id;

  select pgmq.send(
    queue_name => 'blast_remote',
    msg => jsonb_build_object('job_id', job_id, 'stage', 'submit')
  ) into queue_message_id;

  if queue_message_id is null then
    raise exception 'failed to enqueue BLAST job';
  end if;

  return job_id;
end;
$$;
