select pgmq.create('audit_checkpoint_signing');

create table app_private.audit_checkpoint_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  chain_sequence bigint not null,
  chain_head_hash text not null,
  signing_payload text not null,
  payload_sha256 text not null,
  status text not null default 'queued',
  processing_attempts integer not null default 0,
  processing_started_at timestamptz,
  processing_finished_at timestamptz,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint audit_checkpoint_requests_chain_sequence check (chain_sequence > 0),
  constraint audit_checkpoint_requests_chain_hash check (chain_head_hash ~ '^[0-9a-f]{64}$'),
  constraint audit_checkpoint_requests_payload_hash check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint audit_checkpoint_requests_status check (status in ('queued','signing','signed','error')),
  constraint audit_checkpoint_requests_attempts check (processing_attempts >= 0),
  constraint audit_checkpoint_requests_error_length check (processing_error is null or char_length(processing_error) <= 2000),
  constraint audit_checkpoint_requests_org_sequence_unique unique (organization_id, chain_sequence)
);

alter table app_private.audit_checkpoint_requests enable row level security;
alter table app_private.audit_checkpoint_requests force row level security;
revoke all on table app_private.audit_checkpoint_requests from public, anon, authenticated, service_role;

create table public.audit_checkpoints (
  id uuid primary key,
  organization_id uuid not null,
  chain_sequence bigint not null,
  chain_head_hash text not null,
  checkpoint_version text not null default 'ed25519-v1',
  signing_key_id text not null,
  public_key_base64 text not null,
  public_key_sha256 text not null,
  signature_base64 text not null,
  payload_sha256 text not null,
  signed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint audit_checkpoints_chain_sequence check (chain_sequence > 0),
  constraint audit_checkpoints_chain_hash check (chain_head_hash ~ '^[0-9a-f]{64}$'),
  constraint audit_checkpoints_version check (checkpoint_version = 'ed25519-v1'),
  constraint audit_checkpoints_key_id check (char_length(signing_key_id) between 3 and 128 and signing_key_id ~ '^[A-Za-z0-9._:-]+$'),
  constraint audit_checkpoints_public_key_sha check (public_key_sha256 ~ '^[0-9a-f]{64}$'),
  constraint audit_checkpoints_payload_sha check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint audit_checkpoints_public_key_length check (octet_length(decode(public_key_base64, 'base64')) = 32),
  constraint audit_checkpoints_signature_length check (octet_length(decode(signature_base64, 'base64')) = 64),
  constraint audit_checkpoints_org_sequence_unique unique (organization_id, chain_sequence)
);

create index audit_checkpoints_org_signed_idx on public.audit_checkpoints(organization_id, signed_at desc);

alter table public.audit_checkpoints enable row level security;
alter table public.audit_checkpoints force row level security;

create policy audit_checkpoints_select_org_member
on public.audit_checkpoints for select to authenticated
using ((select app_private.is_org_member(organization_id)));

revoke all on table public.audit_checkpoints from public, anon, authenticated, service_role;
grant select on table public.audit_checkpoints to authenticated;

create or replace function app_private.prevent_audit_checkpoint_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'audit checkpoints are append-only';
end;
$$;

revoke all on function app_private.prevent_audit_checkpoint_mutation() from public, anon, authenticated, service_role;

create trigger audit_checkpoints_block_update_delete
before update or delete on public.audit_checkpoints
for each row execute function app_private.prevent_audit_checkpoint_mutation();

create or replace function app_private.queue_audit_checkpoint_for_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id uuid;
  queue_message_id bigint;
  payload text;
  payload_hash text;
begin
  if new.chain_sequence <> 1 and mod(new.chain_sequence, 25) <> 0 then
    return new;
  end if;

  payload := 'genithm-audit-checkpoint-v1' || E'\n'
    || 'organization_id=' || new.organization_id::text || E'\n'
    || 'chain_sequence=' || new.chain_sequence::text || E'\n'
    || 'chain_head_hash=' || new.event_hash || E'\n';

  payload_hash := encode(extensions.digest(convert_to(payload, 'UTF8'), 'sha256'), 'hex');

  insert into app_private.audit_checkpoint_requests (
    organization_id,
    chain_sequence,
    chain_head_hash,
    signing_payload,
    payload_sha256
  ) values (
    new.organization_id,
    new.chain_sequence,
    new.event_hash,
    payload,
    payload_hash
  )
  on conflict (organization_id, chain_sequence) do nothing
  returning id into request_id;

  if request_id is null then
    return new;
  end if;

  begin
    select pgmq.send(
      queue_name => 'audit_checkpoint_signing',
      msg => jsonb_build_object('checkpoint_request_id', request_id)
    ) into queue_message_id;

    if queue_message_id is null then
      raise exception 'checkpoint queue send returned null';
    end if;
  exception when others then
    update app_private.audit_checkpoint_requests
       set status = 'error',
           processing_error = left('checkpoint enqueue failed', 2000),
           processing_finished_at = now(),
           updated_at = now()
     where id = request_id;
  end;

  return new;
end;
$$;

revoke all on function app_private.queue_audit_checkpoint_for_event() from public, anon, authenticated, service_role;

create trigger audit_events_checkpoint_queue
after insert on public.audit_events
for each row execute function app_private.queue_audit_checkpoint_for_event();

create or replace function app_private.claim_audit_checkpoint_job(p_visibility_seconds integer default 300)
returns table (
  message_id bigint,
  checkpoint_request_id uuid,
  organization_id uuid,
  chain_sequence bigint,
  chain_head_hash text,
  signing_payload text,
  payload_sha256 text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_row record;
  request_id uuid;
  target app_private.audit_checkpoint_requests%rowtype;
begin
  if p_visibility_seconds < 60 or p_visibility_seconds > 900 then
    raise exception 'visibility timeout must be between 60 and 900 seconds';
  end if;

  select * into queue_row
  from pgmq.read(queue_name => 'audit_checkpoint_signing', vt => p_visibility_seconds, qty => 1)
  limit 1;

  if not found then
    return;
  end if;

  begin
    request_id := (queue_row.message->>'checkpoint_request_id')::uuid;
  exception when others then
    perform pgmq.delete('audit_checkpoint_signing', queue_row.msg_id);
    return;
  end;

  select * into target
  from app_private.audit_checkpoint_requests
  where id = request_id
  for update;

  if not found then
    perform pgmq.delete('audit_checkpoint_signing', queue_row.msg_id);
    return;
  end if;

  if target.status = 'signed' then
    perform pgmq.delete('audit_checkpoint_signing', queue_row.msg_id);
    return;
  end if;

  if target.status not in ('queued','signing') then
    perform pgmq.delete('audit_checkpoint_signing', queue_row.msg_id);
    return;
  end if;

  update app_private.audit_checkpoint_requests
     set status = 'signing',
         processing_attempts = processing_attempts + 1,
         processing_started_at = coalesce(processing_started_at, now()),
         processing_error = null,
         updated_at = now()
   where id = target.id
   returning * into target;

  return query select
    queue_row.msg_id::bigint,
    target.id,
    target.organization_id,
    target.chain_sequence,
    target.chain_head_hash,
    target.signing_payload,
    target.payload_sha256;
end;
$$;

create or replace function app_private.finish_audit_checkpoint_success(
  p_message_id bigint,
  p_checkpoint_request_id uuid,
  p_signing_key_id text,
  p_public_key_base64 text,
  p_signature_base64 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target app_private.audit_checkpoint_requests%rowtype;
  calculated_public_key_sha text;
  checkpoint_id uuid;
begin
  select * into target
  from app_private.audit_checkpoint_requests
  where id = p_checkpoint_request_id
  for update;

  if not found then
    raise exception 'checkpoint request not found' using errcode = 'P0002';
  end if;

  if target.status = 'signed' then
    select id into checkpoint_id from public.audit_checkpoints where id = target.id;
    perform pgmq.delete('audit_checkpoint_signing', p_message_id);
    return checkpoint_id;
  end if;

  if target.status <> 'signing' then
    raise exception 'checkpoint request is not active';
  end if;

  if p_signing_key_id is null or char_length(trim(p_signing_key_id)) < 3 or char_length(trim(p_signing_key_id)) > 128
     or trim(p_signing_key_id) !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'invalid signing key id';
  end if;

  begin
    if octet_length(decode(p_public_key_base64, 'base64')) <> 32 then
      raise exception 'invalid Ed25519 public key length';
    end if;
    if octet_length(decode(p_signature_base64, 'base64')) <> 64 then
      raise exception 'invalid Ed25519 signature length';
    end if;
  exception when invalid_parameter_value or data_exception then
    raise exception 'invalid base64 checkpoint signature material';
  end;

  calculated_public_key_sha := encode(
    extensions.digest(decode(p_public_key_base64, 'base64'), 'sha256'),
    'hex'
  );

  checkpoint_id := target.id;

  insert into public.audit_checkpoints (
    id,
    organization_id,
    chain_sequence,
    chain_head_hash,
    signing_key_id,
    public_key_base64,
    public_key_sha256,
    signature_base64,
    payload_sha256,
    signed_at
  ) values (
    checkpoint_id,
    target.organization_id,
    target.chain_sequence,
    target.chain_head_hash,
    trim(p_signing_key_id),
    p_public_key_base64,
    calculated_public_key_sha,
    p_signature_base64,
    target.payload_sha256,
    now()
  );

  update app_private.audit_checkpoint_requests
     set status = 'signed',
         processing_finished_at = now(),
         processing_error = null,
         updated_at = now()
   where id = target.id;

  if not pgmq.delete('audit_checkpoint_signing', p_message_id) then
    raise exception 'checkpoint queue message delete failed';
  end if;

  return checkpoint_id;
end;
$$;

create or replace function app_private.finish_audit_checkpoint_error(
  p_message_id bigint,
  p_checkpoint_request_id uuid,
  p_processing_error text,
  p_max_attempts integer default 5
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target app_private.audit_checkpoint_requests%rowtype;
  queue_message_id bigint;
begin
  if p_max_attempts < 1 or p_max_attempts > 10 then
    raise exception 'max attempts must be between 1 and 10';
  end if;

  select * into target
  from app_private.audit_checkpoint_requests
  where id = p_checkpoint_request_id
  for update;

  if not found then
    perform pgmq.delete('audit_checkpoint_signing', p_message_id);
    return 'discarded';
  end if;

  if target.status = 'signed' then
    perform pgmq.delete('audit_checkpoint_signing', p_message_id);
    return 'signed';
  end if;

  if target.status <> 'signing' then
    perform pgmq.delete('audit_checkpoint_signing', p_message_id);
    return 'discarded';
  end if;

  if target.processing_attempts < p_max_attempts then
    update app_private.audit_checkpoint_requests
       set status = 'queued',
           processing_error = left(coalesce(nullif(trim(p_processing_error), ''), 'checkpoint signing failed'), 2000),
           updated_at = now()
     where id = target.id;

    perform pgmq.delete('audit_checkpoint_signing', p_message_id);
    select pgmq.send(
      queue_name => 'audit_checkpoint_signing',
      msg => jsonb_build_object('checkpoint_request_id', target.id),
      delay => 60
    ) into queue_message_id;

    if queue_message_id is null then
      raise exception 'failed to enqueue checkpoint retry';
    end if;
    return 'retry';
  end if;

  update app_private.audit_checkpoint_requests
     set status = 'error',
         processing_finished_at = now(),
         processing_error = left(coalesce(nullif(trim(p_processing_error), ''), 'checkpoint signing failed'), 2000),
         updated_at = now()
   where id = target.id;

  perform pgmq.delete('audit_checkpoint_signing', p_message_id);
  return 'error';
end;
$$;

create or replace function app_private.requeue_audit_checkpoint_request(p_checkpoint_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_message_id bigint;
begin
  update app_private.audit_checkpoint_requests
     set status = 'queued',
         processing_finished_at = null,
         processing_error = null,
         updated_at = now()
   where id = p_checkpoint_request_id
     and status = 'error';

  if not found then
    raise exception 'checkpoint request is not retryable' using errcode = 'P0002';
  end if;

  select pgmq.send(
    queue_name => 'audit_checkpoint_signing',
    msg => jsonb_build_object('checkpoint_request_id', p_checkpoint_request_id)
  ) into queue_message_id;

  if queue_message_id is null then
    raise exception 'failed to requeue checkpoint request';
  end if;
end;
$$;

create or replace function public.claim_audit_checkpoint_job(visibility_seconds integer default 300)
returns table (
  message_id bigint,
  checkpoint_request_id uuid,
  organization_id uuid,
  chain_sequence bigint,
  chain_head_hash text,
  signing_payload text,
  payload_sha256 text
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.claim_audit_checkpoint_job(visibility_seconds);
$$;

create or replace function public.finish_audit_checkpoint_success(
  message_id bigint,
  checkpoint_request_id uuid,
  signing_key_id text,
  public_key_base64 text,
  signature_base64 text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_audit_checkpoint_success(
    message_id,
    checkpoint_request_id,
    signing_key_id,
    public_key_base64,
    signature_base64
  );
$$;

create or replace function public.finish_audit_checkpoint_error(
  message_id bigint,
  checkpoint_request_id uuid,
  processing_error text,
  max_attempts integer default 5
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_audit_checkpoint_error(
    message_id,
    checkpoint_request_id,
    processing_error,
    max_attempts
  );
$$;

create or replace function public.requeue_audit_checkpoint_request(checkpoint_request_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.requeue_audit_checkpoint_request(checkpoint_request_id);
$$;

revoke all on function app_private.claim_audit_checkpoint_job(integer) from public, anon, authenticated;
revoke all on function app_private.finish_audit_checkpoint_success(bigint,uuid,text,text,text) from public, anon, authenticated;
revoke all on function app_private.finish_audit_checkpoint_error(bigint,uuid,text,integer) from public, anon, authenticated;
revoke all on function app_private.requeue_audit_checkpoint_request(uuid) from public, anon, authenticated;
grant execute on function app_private.claim_audit_checkpoint_job(integer) to service_role;
grant execute on function app_private.finish_audit_checkpoint_success(bigint,uuid,text,text,text) to service_role;
grant execute on function app_private.finish_audit_checkpoint_error(bigint,uuid,text,integer) to service_role;
grant execute on function app_private.requeue_audit_checkpoint_request(uuid) to service_role;

revoke all on function public.claim_audit_checkpoint_job(integer) from public, anon, authenticated;
revoke all on function public.finish_audit_checkpoint_success(bigint,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.finish_audit_checkpoint_error(bigint,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.requeue_audit_checkpoint_request(uuid) from public, anon, authenticated;
grant execute on function public.claim_audit_checkpoint_job(integer) to service_role;
grant execute on function public.finish_audit_checkpoint_success(bigint,uuid,text,text,text) to service_role;
grant execute on function public.finish_audit_checkpoint_error(bigint,uuid,text,integer) to service_role;
grant execute on function public.requeue_audit_checkpoint_request(uuid) to service_role;
