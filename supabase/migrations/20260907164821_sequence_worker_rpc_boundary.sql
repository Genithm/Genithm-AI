create or replace function app_private.claim_sequence_validation_job(p_visibility_seconds integer default 300)
returns table (
  message_id bigint,
  read_count integer,
  upload_id uuid,
  object_path text,
  file_size_bytes bigint,
  content_type text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  job record;
  target public.sequence_uploads%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_visibility_seconds < 30 or p_visibility_seconds > 3600 then
    raise exception 'visibility timeout must be between 30 and 3600 seconds';
  end if;

  select * into job
  from pgmq.read(
    queue_name => 'sequence_validation',
    vt => p_visibility_seconds,
    qty => 1
  )
  limit 1;

  if not found then
    return;
  end if;

  select * into target
  from public.sequence_uploads
  where id = (job.message->>'upload_id')::uuid
  for update;

  if not found then
    perform pgmq.delete('sequence_validation', job.msg_id);
    return;
  end if;

  if target.status not in ('pending_validation', 'validating') then
    perform pgmq.delete('sequence_validation', job.msg_id);
    return;
  end if;

  update public.sequence_uploads
     set status = 'validating',
         processing_attempts = processing_attempts + 1,
         processing_started_at = coalesce(processing_started_at, now()),
         processing_finished_at = null,
         processing_error = null,
         updated_at = now()
   where id = target.id
   returning * into target;

  return query select
    job.msg_id::bigint,
    job.read_ct::integer,
    target.id,
    target.object_path,
    target.file_size_bytes,
    target.content_type;
end;
$$;

create or replace function app_private.finish_sequence_validation_success(
  p_message_id bigint,
  p_upload_id uuid,
  p_sha256 text,
  p_sequence_type text,
  p_sequence_count integer,
  p_residue_count bigint,
  p_validator_version text,
  p_warnings jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.sequence_uploads
     set status = 'ready',
         sha256 = p_sha256,
         sequence_type = p_sequence_type,
         sequence_count = p_sequence_count,
         residue_count = p_residue_count,
         validation_error = null,
         validator_version = p_validator_version,
         validation_warnings = coalesce(p_warnings, '[]'::jsonb),
         validated_at = now(),
         processing_finished_at = now(),
         processing_error = null,
         updated_at = now()
   where id = p_upload_id
     and status = 'validating';

  if not found then
    raise exception 'validation job is not active' using errcode = 'P0002';
  end if;

  if not pgmq.delete('sequence_validation', p_message_id) then
    raise exception 'queue message delete failed';
  end if;
end;
$$;

create or replace function app_private.finish_sequence_validation_rejected(
  p_message_id bigint,
  p_upload_id uuid,
  p_validation_error text,
  p_validator_version text,
  p_sha256 text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if nullif(trim(p_validation_error), '') is null then
    raise exception 'validation error is required';
  end if;

  update public.sequence_uploads
     set status = 'rejected',
         sha256 = p_sha256,
         sequence_type = null,
         sequence_count = null,
         residue_count = null,
         validation_error = left(p_validation_error, 2000),
         validator_version = p_validator_version,
         validation_warnings = '[]'::jsonb,
         validated_at = now(),
         processing_finished_at = now(),
         processing_error = null,
         updated_at = now()
   where id = p_upload_id
     and status = 'validating';

  if not found then
    raise exception 'validation job is not active' using errcode = 'P0002';
  end if;

  if not pgmq.delete('sequence_validation', p_message_id) then
    raise exception 'queue message delete failed';
  end if;
end;
$$;

create or replace function app_private.finish_sequence_validation_error(
  p_message_id bigint,
  p_upload_id uuid,
  p_processing_error text,
  p_max_attempts integer default 3
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempts integer;
begin
  if current_user <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_max_attempts < 1 or p_max_attempts > 10 then
    raise exception 'max attempts must be between 1 and 10';
  end if;

  select processing_attempts into attempts
  from public.sequence_uploads
  where id = p_upload_id
  for update;

  if not found then
    perform pgmq.delete('sequence_validation', p_message_id);
    return 'discarded';
  end if;

  if attempts >= p_max_attempts then
    update public.sequence_uploads
       set status = 'error',
           processing_finished_at = now(),
           processing_error = left(coalesce(nullif(trim(p_processing_error), ''), 'worker processing failed'), 2000),
           updated_at = now()
     where id = p_upload_id
       and status = 'validating';

    perform pgmq.delete('sequence_validation', p_message_id);
    return 'error';
  end if;

  update public.sequence_uploads
     set status = 'pending_validation',
         processing_started_at = null,
         processing_finished_at = null,
         processing_error = left(coalesce(nullif(trim(p_processing_error), ''), 'worker processing failed'), 2000),
         updated_at = now()
   where id = p_upload_id
     and status = 'validating';

  return 'retry';
end;
$$;

create or replace function public.claim_sequence_validation_job(visibility_seconds integer default 300)
returns table (
  message_id bigint,
  read_count integer,
  upload_id uuid,
  object_path text,
  file_size_bytes bigint,
  content_type text
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.claim_sequence_validation_job(visibility_seconds);
$$;

create or replace function public.finish_sequence_validation_success(
  message_id bigint,
  upload_id uuid,
  sha256 text,
  sequence_type text,
  sequence_count integer,
  residue_count bigint,
  validator_version text,
  warnings jsonb default '[]'::jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_sequence_validation_success(message_id, upload_id, sha256, sequence_type, sequence_count, residue_count, validator_version, warnings);
$$;

create or replace function public.finish_sequence_validation_rejected(
  message_id bigint,
  upload_id uuid,
  validation_error text,
  validator_version text,
  sha256 text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_sequence_validation_rejected(message_id, upload_id, validation_error, validator_version, sha256);
$$;

create or replace function public.finish_sequence_validation_error(
  message_id bigint,
  upload_id uuid,
  processing_error text,
  max_attempts integer default 3
)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_sequence_validation_error(message_id, upload_id, processing_error, max_attempts);
$$;

revoke all on function app_private.claim_sequence_validation_job(integer) from public, anon, authenticated;
revoke all on function app_private.finish_sequence_validation_success(bigint, uuid, text, text, integer, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function app_private.finish_sequence_validation_rejected(bigint, uuid, text, text, text) from public, anon, authenticated;
revoke all on function app_private.finish_sequence_validation_error(bigint, uuid, text, integer) from public, anon, authenticated;

grant execute on function app_private.claim_sequence_validation_job(integer) to service_role;
grant execute on function app_private.finish_sequence_validation_success(bigint, uuid, text, text, integer, bigint, text, jsonb) to service_role;
grant execute on function app_private.finish_sequence_validation_rejected(bigint, uuid, text, text, text) to service_role;
grant execute on function app_private.finish_sequence_validation_error(bigint, uuid, text, integer) to service_role;

revoke all on function public.claim_sequence_validation_job(integer) from public, anon, authenticated;
revoke all on function public.finish_sequence_validation_success(bigint, uuid, text, text, integer, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.finish_sequence_validation_rejected(bigint, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.finish_sequence_validation_error(bigint, uuid, text, integer) from public, anon, authenticated;

grant execute on function public.claim_sequence_validation_job(integer) to service_role;
grant execute on function public.finish_sequence_validation_success(bigint, uuid, text, text, integer, bigint, text, jsonb) to service_role;
grant execute on function public.finish_sequence_validation_rejected(bigint, uuid, text, text, text) to service_role;
grant execute on function public.finish_sequence_validation_error(bigint, uuid, text, integer) to service_role;
