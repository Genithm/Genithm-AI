create extension if not exists pgmq;

select pgmq.create('sequence_validation');

alter table public.sequence_uploads
  alter column status set default 'pending_upload';

alter table public.sequence_uploads
  add column processing_attempts integer not null default 0,
  add column processing_started_at timestamptz,
  add column processing_finished_at timestamptz,
  add column processing_error text;

alter table public.sequence_uploads
  drop constraint sequence_uploads_status,
  drop constraint sequence_uploads_validation_state_consistency,
  drop constraint sequence_uploads_ready_has_no_error,
  drop constraint sequence_uploads_rejected_has_error;

alter table public.sequence_uploads
  add constraint sequence_uploads_status
    check (status = any (array['pending_upload'::text, 'pending_validation'::text, 'validating'::text, 'ready'::text, 'rejected'::text, 'error'::text])),
  add constraint sequence_uploads_processing_attempts
    check (processing_attempts >= 0),
  add constraint sequence_uploads_ready_has_no_error
    check ((status <> 'ready'::text) or (validation_error is null and processing_error is null)),
  add constraint sequence_uploads_rejected_has_error
    check ((status <> 'rejected'::text) or (validation_error is not null and processing_error is null)),
  add constraint sequence_uploads_processing_error_state
    check ((status <> 'error'::text) or (processing_error is not null)),
  add constraint sequence_uploads_validation_state_consistency
    check (
      (status in ('pending_upload', 'pending_validation') and validated_at is null and processing_started_at is null and processing_finished_at is null)
      or (status = 'validating' and validated_at is null and processing_started_at is not null and processing_finished_at is null)
      or (status in ('ready', 'rejected') and validated_at is not null and validator_version is not null and processing_started_at is not null and processing_finished_at is not null)
      or (status = 'error' and validated_at is null and processing_started_at is not null and processing_finished_at is not null)
    );

create or replace function app_private.enqueue_sequence_validation(p_upload_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  upload_row public.sequence_uploads%rowtype;
  queue_message_id bigint;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select *
    into upload_row
    from public.sequence_uploads
   where id = p_upload_id
   for update;

  if not found then
    raise exception 'upload not found' using errcode = 'P0002';
  end if;

  if upload_row.created_by <> caller_id then
    raise exception 'upload access denied' using errcode = '42501';
  end if;

  if upload_row.status <> 'pending_upload' then
    return upload_row.status;
  end if;

  if not exists (
    select 1
      from storage.objects o
     where o.bucket_id = 'sequence-inputs'
       and o.name = upload_row.object_path
       and (o.owner = caller_id or o.owner_id = caller_id::text)
  ) then
    raise exception 'uploaded object not found' using errcode = 'P0002';
  end if;

  update public.sequence_uploads
     set status = 'pending_validation',
         updated_at = now()
   where id = p_upload_id;

  select pgmq.send(
    queue_name => 'sequence_validation',
    msg => jsonb_build_object('upload_id', p_upload_id)
  ) into queue_message_id;

  if queue_message_id is null then
    raise exception 'failed to enqueue validation job';
  end if;

  return 'pending_validation';
end;
$$;

revoke all on function app_private.enqueue_sequence_validation(uuid) from public, anon;
grant execute on function app_private.enqueue_sequence_validation(uuid) to authenticated;

create or replace function public.complete_sequence_upload(upload_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
  select app_private.enqueue_sequence_validation(upload_id);
$$;

revoke all on function public.complete_sequence_upload(uuid) from public, anon;
grant execute on function public.complete_sequence_upload(uuid) to authenticated;
