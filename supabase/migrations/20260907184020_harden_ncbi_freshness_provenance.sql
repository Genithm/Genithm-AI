alter table public.sequence_retrievals
  add column resolution_mode text generated always as (
    case when position('.' in requested_accession) > 0 then 'exact_version' else 'latest_at_request' end
  ) stored,
  add column freshness_policy text not null default 'live_source_no_cache',
  add column source_checked_at timestamptz,
  add column source_response_sha256 text,
  add column source_response_bytes bigint;

update public.sequence_retrievals
   set source_checked_at = coalesce(source_retrieved_at, processing_finished_at)
 where status in ('retrieved', 'not_found', 'rejected')
   and source_checked_at is null;

alter table public.sequence_retrievals
  add constraint sequence_retrievals_resolution_mode
    check (resolution_mode in ('latest_at_request', 'exact_version')),
  add constraint sequence_retrievals_freshness_policy
    check (freshness_policy = 'live_source_no_cache'),
  add constraint sequence_retrievals_source_checked_terminal
    check (status not in ('retrieved', 'not_found', 'rejected') or source_checked_at is not null),
  add constraint sequence_retrievals_source_checked_time
    check (source_checked_at is null or source_checked_at >= created_at),
  add constraint sequence_retrievals_source_response_pair
    check ((source_response_sha256 is null) = (source_response_bytes is null)),
  add constraint sequence_retrievals_source_response_sha
    check (source_response_sha256 is null or source_response_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint sequence_retrievals_source_response_bytes
    check (source_response_bytes is null or source_response_bytes between 1 and 57671680);

comment on column public.sequence_retrievals.resolution_mode is
  'Derived retrieval semantics: unversioned accession resolves NCBI latest-at-request; accession.version requires the exact sequence version.';
comment on column public.sequence_retrievals.freshness_policy is
  'Genithm V1 policy: every new retrieval request consults the live authoritative source; completed results are not silently reused as fresh.';
comment on column public.sequence_retrievals.source_checked_at is
  'Server timestamp when the authoritative NCBI source produced a terminal scientific response.';
comment on column public.sequence_retrievals.source_response_sha256 is
  'SHA-256 of the raw successful NCBI EFetch response used to derive the stored sequence and metadata.';

create or replace function app_private.finish_ncbi_sequence_retrieval_success(
  p_message_id bigint,
  p_retrieval_id uuid,
  p_sequence_upload_id uuid,
  p_resolved_accession text,
  p_file_size_bytes bigint,
  p_record_title text,
  p_organism text,
  p_reported_length bigint,
  p_record_updated_date text,
  p_connector_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.sequence_retrievals%rowtype;
  normalized_resolved text := upper(trim(p_resolved_accession));
  expected_filename text;
  expected_path text;
  validation_message_id bigint;
begin
  select * into target
  from public.sequence_retrievals
  where id = p_retrieval_id
  for update;

  if not found or target.status <> 'retrieving' then
    raise exception 'retrieval job is not active' using errcode = 'P0002';
  end if;

  if char_length(normalized_resolved) < 1
     or char_length(normalized_resolved) > 64
     or normalized_resolved !~ '^[A-Z0-9_]+(\.[0-9]+)?$'
     or normalized_resolved !~ '[A-Z]' then
    raise exception 'resolved accession format is invalid';
  end if;

  if split_part(normalized_resolved, '.', 1) <> split_part(target.requested_accession, '.', 1) then
    raise exception 'resolved accession does not match requested accession';
  end if;

  if target.resolution_mode = 'exact_version' and normalized_resolved <> target.requested_accession then
    raise exception 'versioned accession mismatch';
  end if;

  if p_file_size_bytes < 1 or p_file_size_bytes > 52428800 then
    raise exception 'retrieved FASTA is outside the 50 MiB limit';
  end if;

  if p_reported_length is null or p_reported_length < 1 then
    raise exception 'NCBI reported length is invalid';
  end if;

  if nullif(trim(p_connector_version), '') is null then
    raise exception 'connector version is required';
  end if;

  expected_filename := 'ncbi-' || lower(normalized_resolved) || '.fasta';
  expected_path := target.organization_id::text || '/' || target.project_id::text || '/' || target.requested_by::text || '/' || p_sequence_upload_id::text || '/' || expected_filename;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'sequence-inputs'
      and o.name = expected_path
  ) then
    raise exception 'retrieved FASTA object not found' using errcode = 'P0002';
  end if;

  insert into public.sequence_uploads (
    id,
    organization_id,
    project_id,
    created_by,
    original_filename,
    object_path,
    file_size_bytes,
    content_type,
    status
  ) values (
    p_sequence_upload_id,
    target.organization_id,
    target.project_id,
    target.requested_by,
    expected_filename,
    expected_path,
    p_file_size_bytes,
    'text/plain',
    'pending_validation'
  );

  update public.sequence_retrievals
     set status = 'retrieved',
         resolved_accession = normalized_resolved,
         record_title = left(nullif(trim(p_record_title), ''), 2000),
         organism = left(nullif(trim(p_organism), ''), 512),
         reported_length = p_reported_length,
         record_updated_date = left(nullif(trim(p_record_updated_date), ''), 64),
         sequence_upload_id = p_sequence_upload_id,
         connector_version = left(trim(p_connector_version), 128),
         source_checked_at = now(),
         source_retrieved_at = now(),
         result_message = null,
         processing_finished_at = now(),
         processing_error = null,
         updated_at = now()
   where id = target.id;

  select pgmq.send(
    queue_name => 'sequence_validation',
    msg => jsonb_build_object('upload_id', p_sequence_upload_id)
  ) into validation_message_id;

  if validation_message_id is null then
    raise exception 'failed to enqueue retrieved sequence validation';
  end if;

  if not pgmq.delete('ncbi_sequence_retrieval', p_message_id) then
    raise exception 'retrieval queue message delete failed';
  end if;

  return p_sequence_upload_id;
end;
$$;

create or replace function app_private.finish_ncbi_sequence_retrieval_not_found(
  p_message_id bigint,
  p_retrieval_id uuid,
  p_connector_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sequence_retrievals
     set status = 'not_found',
         connector_version = left(trim(p_connector_version), 128),
         source_checked_at = now(),
         result_message = 'NCBI did not return a record for this accession.',
         processing_finished_at = now(),
         processing_error = null,
         updated_at = now()
   where id = p_retrieval_id
     and status = 'retrieving';

  if not found then
    raise exception 'retrieval job is not active' using errcode = 'P0002';
  end if;

  if not pgmq.delete('ncbi_sequence_retrieval', p_message_id) then
    raise exception 'retrieval queue message delete failed';
  end if;
end;
$$;

create or replace function app_private.finish_ncbi_sequence_retrieval_rejected(
  p_message_id bigint,
  p_retrieval_id uuid,
  p_reason text,
  p_connector_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'rejection reason is required';
  end if;

  update public.sequence_retrievals
     set status = 'rejected',
         connector_version = left(trim(p_connector_version), 128),
         source_checked_at = now(),
         result_message = left(trim(p_reason), 2000),
         processing_finished_at = now(),
         processing_error = null,
         updated_at = now()
   where id = p_retrieval_id
     and status = 'retrieving';

  if not found then
    raise exception 'retrieval job is not active' using errcode = 'P0002';
  end if;

  if not pgmq.delete('ncbi_sequence_retrieval', p_message_id) then
    raise exception 'retrieval queue message delete failed';
  end if;
end;
$$;

create or replace function app_private.finish_ncbi_sequence_retrieval_success_v2(
  p_message_id bigint,
  p_retrieval_id uuid,
  p_sequence_upload_id uuid,
  p_resolved_accession text,
  p_file_size_bytes bigint,
  p_record_title text,
  p_organism text,
  p_reported_length bigint,
  p_record_updated_date text,
  p_connector_version text,
  p_source_response_sha256 text,
  p_source_response_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_upload_id uuid;
begin
  if p_source_response_sha256 is null or p_source_response_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid NCBI source response checksum';
  end if;

  if p_source_response_bytes is null or p_source_response_bytes < 1 or p_source_response_bytes > 57671680 then
    raise exception 'invalid NCBI source response size';
  end if;

  result_upload_id := app_private.finish_ncbi_sequence_retrieval_success(
    p_message_id,
    p_retrieval_id,
    p_sequence_upload_id,
    p_resolved_accession,
    p_file_size_bytes,
    p_record_title,
    p_organism,
    p_reported_length,
    p_record_updated_date,
    p_connector_version
  );

  update public.sequence_retrievals
     set source_response_sha256 = p_source_response_sha256,
         source_response_bytes = p_source_response_bytes,
         updated_at = now()
   where id = p_retrieval_id
     and status = 'retrieved';

  if not found then
    raise exception 'retrieval result disappeared' using errcode = 'P0002';
  end if;

  return result_upload_id;
end;
$$;

create or replace function public.finish_ncbi_sequence_retrieval_success_v2(
  message_id bigint,
  retrieval_id uuid,
  sequence_upload_id uuid,
  resolved_accession text,
  file_size_bytes bigint,
  record_title text,
  organism text,
  reported_length bigint,
  record_updated_date text,
  connector_version text,
  source_response_sha256 text,
  source_response_bytes bigint
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select app_private.finish_ncbi_sequence_retrieval_success_v2(
    message_id,
    retrieval_id,
    sequence_upload_id,
    resolved_accession,
    file_size_bytes,
    record_title,
    organism,
    reported_length,
    record_updated_date,
    connector_version,
    source_response_sha256,
    source_response_bytes
  );
$$;

revoke all on function app_private.finish_ncbi_sequence_retrieval_success_v2(bigint, uuid, uuid, text, bigint, text, text, bigint, text, text, text, bigint) from public, anon, authenticated;
grant execute on function app_private.finish_ncbi_sequence_retrieval_success_v2(bigint, uuid, uuid, text, bigint, text, text, bigint, text, text, text, bigint) to service_role;
revoke all on function public.finish_ncbi_sequence_retrieval_success_v2(bigint, uuid, uuid, text, bigint, text, text, bigint, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.finish_ncbi_sequence_retrieval_success_v2(bigint, uuid, uuid, text, bigint, text, text, bigint, text, text, text, bigint) to service_role;
