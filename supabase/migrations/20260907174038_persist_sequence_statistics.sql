alter table public.sequence_uploads
  add column statistics_version text,
  add column sequence_statistics jsonb,
  add column statistics_calculated_at timestamptz;

alter table public.sequence_uploads
  add constraint sequence_uploads_statistics_object
    check (sequence_statistics is null or jsonb_typeof(sequence_statistics) = 'object'),
  add constraint sequence_uploads_statistics_consistency
    check (
      (sequence_statistics is null and statistics_version is null and statistics_calculated_at is null)
      or (
        sequence_statistics is not null
        and nullif(trim(statistics_version), '') is not null
        and statistics_calculated_at is not null
      )
    );

create or replace function app_private.finish_sequence_validation_success_v2(
  p_message_id bigint,
  p_upload_id uuid,
  p_sha256 text,
  p_sequence_type text,
  p_sequence_count integer,
  p_residue_count bigint,
  p_validator_version text,
  p_warnings jsonb,
  p_statistics_version text,
  p_statistics jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_statistics is null or jsonb_typeof(p_statistics) <> 'object' then
    raise exception 'statistics payload must be a JSON object';
  end if;

  if nullif(trim(p_statistics_version), '') is null then
    raise exception 'statistics version is required';
  end if;

  if p_statistics->>'statistics_version' is distinct from p_statistics_version then
    raise exception 'statistics version mismatch';
  end if;

  if p_statistics->>'sequence_type' is distinct from p_sequence_type then
    raise exception 'statistics sequence type mismatch';
  end if;

  if (p_statistics->>'sequence_count')::integer is distinct from p_sequence_count then
    raise exception 'statistics sequence count mismatch';
  end if;

  if (p_statistics->>'residue_count')::bigint is distinct from p_residue_count then
    raise exception 'statistics residue count mismatch';
  end if;

  if jsonb_typeof(p_statistics->'record_length') <> 'object'
     or jsonb_typeof(p_statistics->'composition') <> 'object'
     or jsonb_typeof(p_statistics->'frequencies') <> 'object' then
    raise exception 'statistics payload is missing required objects';
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
         statistics_version = p_statistics_version,
         sequence_statistics = p_statistics,
         statistics_calculated_at = now(),
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

create or replace function public.finish_sequence_validation_success_v2(
  message_id bigint,
  upload_id uuid,
  sha256 text,
  sequence_type text,
  sequence_count integer,
  residue_count bigint,
  validator_version text,
  warnings jsonb,
  statistics_version text,
  statistics jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_sequence_validation_success_v2(
    message_id,
    upload_id,
    sha256,
    sequence_type,
    sequence_count,
    residue_count,
    validator_version,
    warnings,
    statistics_version,
    statistics
  );
$$;

revoke all on function app_private.finish_sequence_validation_success_v2(bigint, uuid, text, text, integer, bigint, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function app_private.finish_sequence_validation_success_v2(bigint, uuid, text, text, integer, bigint, text, jsonb, text, jsonb) to service_role;

revoke all on function public.finish_sequence_validation_success_v2(bigint, uuid, text, text, integer, bigint, text, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_sequence_validation_success_v2(bigint, uuid, text, text, integer, bigint, text, jsonb, text, jsonb) to service_role;
