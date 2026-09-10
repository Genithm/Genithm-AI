alter table public.sequence_uploads
  add column storage_provider text not null default 'supabase',
  add column storage_bucket text not null default 'sequence-inputs';

alter table public.sequence_uploads
  add constraint sequence_uploads_storage_provider
    check (storage_provider in ('supabase', 'r2')),
  add constraint sequence_uploads_storage_bucket
    check (char_length(storage_bucket) between 1 and 128),
  add constraint sequence_uploads_storage_provider_bucket
    check (storage_bucket = 'sequence-inputs');

comment on column public.sequence_uploads.storage_provider is
  'Object-storage provider. Existing V1 uploads remain supabase; Storage Gateway uploads use r2.';
comment on column public.sequence_uploads.storage_bucket is
  'Provider-neutral logical bucket. Physical provider bucket names remain behind the Storage Gateway.';

revoke insert (storage_provider, storage_bucket) on table public.sequence_uploads from authenticated;

create or replace function app_private.reserve_r2_sequence_upload(
  p_project_id uuid,
  p_original_filename text,
  p_file_size_bytes bigint,
  p_content_type text default null
)
returns table (
  upload_id uuid,
  organization_id uuid,
  project_id uuid,
  object_path text,
  file_size_bytes bigint,
  content_type text,
  storage_provider text,
  storage_bucket text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  project_org uuid;
  new_upload_id uuid := pg_catalog.gen_random_uuid();
  safe_filename text := left(trim(coalesce(p_original_filename, '')), 255);
  safe_content_type text := nullif(left(trim(coalesce(p_content_type, '')), 255), '');
  new_object_path text;
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if safe_filename = '' then
    raise exception 'original filename is required' using errcode = '22023';
  end if;
  if p_file_size_bytes < 1 or p_file_size_bytes > 52428800 then
    raise exception 'file size must be between 1 and 52428800 bytes' using errcode = '22023';
  end if;

  select p.organization_id into project_org
  from public.projects p
  where p.id = p_project_id;

  if project_org is null or not app_private.can_write_org(project_org) then
    raise exception 'project write access denied' using errcode = '42501';
  end if;

  new_object_path := project_org::text || '/' || p_project_id::text || '/' || caller_id::text || '/' || new_upload_id::text || '/input.fasta';

  insert into public.sequence_uploads (
    id, organization_id, project_id, created_by, original_filename, object_path,
    file_size_bytes, content_type, status, storage_provider, storage_bucket
  ) values (
    new_upload_id, project_org, p_project_id, caller_id, safe_filename, new_object_path,
    p_file_size_bytes, safe_content_type, 'pending_upload', 'r2', 'sequence-inputs'
  );

  return query select
    new_upload_id, project_org, p_project_id, new_object_path, p_file_size_bytes,
    safe_content_type, 'r2'::text, 'sequence-inputs'::text;
end;
$$;

create or replace function public.reserve_r2_sequence_upload(
  project_id uuid,
  original_filename text,
  file_size_bytes bigint,
  content_type text default null
)
returns table (
  upload_id uuid,
  organization_id uuid,
  project_id uuid,
  object_path text,
  file_size_bytes bigint,
  content_type text,
  storage_provider text,
  storage_bucket text
)
language sql
security invoker
set search_path = ''
as $$
  select * from app_private.reserve_r2_sequence_upload(project_id, original_filename, file_size_bytes, content_type);
$$;

revoke all on function app_private.reserve_r2_sequence_upload(uuid, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function app_private.reserve_r2_sequence_upload(uuid, text, bigint, text) to authenticated;
revoke all on function public.reserve_r2_sequence_upload(uuid, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.reserve_r2_sequence_upload(uuid, text, bigint, text) to authenticated;

drop function if exists public.claim_sequence_validation_job(integer);
drop function if exists app_private.claim_sequence_validation_job(integer);

create function app_private.claim_sequence_validation_job(p_visibility_seconds integer default 300)
returns table (
  message_id bigint,
  read_count integer,
  upload_id uuid,
  storage_provider text,
  storage_bucket text,
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
  if p_visibility_seconds < 30 or p_visibility_seconds > 3600 then
    raise exception 'visibility timeout must be between 30 and 3600 seconds';
  end if;
  select * into job from pgmq.read(queue_name => 'sequence_validation', vt => p_visibility_seconds, qty => 1) limit 1;
  if not found then return; end if;
  select * into target from public.sequence_uploads where id = (job.message->>'upload_id')::uuid for update;
  if not found then perform pgmq.delete('sequence_validation', job.msg_id); return; end if;
  if target.status not in ('pending_validation', 'validating') then perform pgmq.delete('sequence_validation', job.msg_id); return; end if;
  update public.sequence_uploads
     set status = 'validating', processing_attempts = processing_attempts + 1,
         processing_started_at = coalesce(processing_started_at, now()), processing_finished_at = null,
         processing_error = null, updated_at = now()
   where id = target.id returning * into target;
  return query select job.msg_id::bigint, job.read_ct::integer, target.id, target.storage_provider,
    target.storage_bucket, target.object_path, target.file_size_bytes, target.content_type;
end;
$$;

create function public.claim_sequence_validation_job(visibility_seconds integer default 300)
returns table (
  message_id bigint, read_count integer, upload_id uuid, storage_provider text, storage_bucket text,
  object_path text, file_size_bytes bigint, content_type text
)
language sql
security invoker
set search_path = ''
as $$ select * from app_private.claim_sequence_validation_job(visibility_seconds); $$;

revoke all on function app_private.claim_sequence_validation_job(integer) from public, anon, authenticated, service_role;
grant execute on function app_private.claim_sequence_validation_job(integer) to service_role;
revoke all on function public.claim_sequence_validation_job(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_sequence_validation_job(integer) to service_role;

create or replace function app_private.enqueue_r2_sequence_validation(p_upload_id uuid, p_expected_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_row public.sequence_uploads%rowtype;
  queue_message_id bigint;
begin
  if p_expected_user_id is null then raise exception 'expected user id is required' using errcode = '22023'; end if;
  select * into upload_row from public.sequence_uploads where id = p_upload_id for update;
  if not found then raise exception 'upload not found' using errcode = 'P0002'; end if;
  if upload_row.created_by <> p_expected_user_id then raise exception 'upload access denied' using errcode = '42501'; end if;
  if upload_row.storage_provider <> 'r2' then raise exception 'upload is not stored in R2' using errcode = '22023'; end if;
  if upload_row.status <> 'pending_upload' then return upload_row.status; end if;
  update public.sequence_uploads set status = 'pending_validation', updated_at = now() where id = p_upload_id;
  select pgmq.send(queue_name => 'sequence_validation', msg => jsonb_build_object('upload_id', p_upload_id)) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue validation job'; end if;
  return 'pending_validation';
end;
$$;

create or replace function public.complete_r2_sequence_upload(upload_id uuid, expected_user_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $$ select app_private.enqueue_r2_sequence_validation(upload_id, expected_user_id); $$;

revoke all on function app_private.enqueue_r2_sequence_validation(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function app_private.enqueue_r2_sequence_validation(uuid, uuid) to service_role;
revoke all on function public.complete_r2_sequence_upload(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.complete_r2_sequence_upload(uuid, uuid) to service_role;

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
  if caller_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into upload_row from public.sequence_uploads where id = p_upload_id for update;
  if not found then raise exception 'upload not found' using errcode = 'P0002'; end if;
  if upload_row.created_by <> caller_id then raise exception 'upload access denied' using errcode = '42501'; end if;
  if upload_row.storage_provider <> 'supabase' or upload_row.storage_bucket <> 'sequence-inputs' then
    raise exception 'non-Supabase uploads must be completed through the Storage Gateway' using errcode = '42501';
  end if;
  if upload_row.status <> 'pending_upload' then return upload_row.status; end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id = 'sequence-inputs' and o.name = upload_row.object_path
      and (o.owner = caller_id or o.owner_id = caller_id::text)
  ) then raise exception 'uploaded object not found' using errcode = 'P0002'; end if;
  update public.sequence_uploads set status = 'pending_validation', updated_at = now() where id = p_upload_id;
  select pgmq.send(queue_name => 'sequence_validation', msg => jsonb_build_object('upload_id', p_upload_id)) into queue_message_id;
  if queue_message_id is null then raise exception 'failed to enqueue validation job'; end if;
  return 'pending_validation';
end;
$$;

revoke all on function app_private.enqueue_sequence_validation(uuid) from public, anon, authenticated;
grant execute on function app_private.enqueue_sequence_validation(uuid) to authenticated;
