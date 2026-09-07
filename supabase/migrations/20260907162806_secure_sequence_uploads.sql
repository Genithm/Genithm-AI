alter table public.projects add constraint projects_id_organization_key unique (id, organization_id);

create table public.sequence_uploads (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  original_filename text not null,
  object_path text not null unique,
  file_size_bytes bigint not null,
  content_type text,
  status text not null default 'pending_validation',
  sha256 text,
  sequence_type text,
  sequence_count integer,
  residue_count bigint,
  validation_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sequence_uploads_project_org_fkey foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete cascade,
  constraint sequence_uploads_filename_length check (char_length(original_filename) between 1 and 255),
  constraint sequence_uploads_file_size check (file_size_bytes between 1 and 52428800),
  constraint sequence_uploads_status check (status in ('pending_validation','validating','ready','rejected')),
  constraint sequence_uploads_type check (sequence_type is null or sequence_type in ('dna','rna','protein','mixed','unknown')),
  constraint sequence_uploads_sha256 check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint sequence_uploads_counts check (
    (sequence_count is null or sequence_count >= 0) and
    (residue_count is null or residue_count >= 0)
  ),
  constraint sequence_uploads_path_scope check (
    object_path like organization_id::text || '/' || project_id::text || '/' || created_by::text || '/' || id::text || '/%'
  )
);

create index sequence_uploads_project_created_idx on public.sequence_uploads(project_id, created_at desc);
create index sequence_uploads_org_created_idx on public.sequence_uploads(organization_id, created_at desc);
create index sequence_uploads_created_by_idx on public.sequence_uploads(created_by);
create index sequence_uploads_status_idx on public.sequence_uploads(status) where status <> 'ready';

create trigger sequence_uploads_set_updated_at
before update on public.sequence_uploads
for each row execute function app_private.set_updated_at();

alter table public.sequence_uploads enable row level security;
alter table public.sequence_uploads force row level security;

create policy sequence_uploads_select_project_member
on public.sequence_uploads for select to authenticated
using (app_private.is_org_member(organization_id));

create policy sequence_uploads_insert_project_writer
on public.sequence_uploads for insert to authenticated
with check (
  created_by = (select auth.uid())
  and app_private.can_write_org(organization_id)
  and exists (
    select 1 from public.projects p
    where p.id = sequence_uploads.project_id
      and p.organization_id = sequence_uploads.organization_id
  )
);

revoke all on table public.sequence_uploads from anon, authenticated;
grant select on table public.sequence_uploads to authenticated;
grant insert (id, organization_id, project_id, created_by, original_filename, object_path, file_size_bytes, content_type)
on table public.sequence_uploads to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sequence-inputs', 'sequence-inputs', false, 52428800, null)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy sequence_inputs_insert_registered_owner
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sequence-inputs'
  and exists (
    select 1
    from public.sequence_uploads su
    where su.object_path = name
      and su.created_by = (select auth.uid())
      and app_private.can_write_org(su.organization_id)
  )
);

create policy sequence_inputs_select_project_member
on storage.objects for select to authenticated
using (
  bucket_id = 'sequence-inputs'
  and exists (
    select 1
    from public.sequence_uploads su
    where su.object_path = name
      and app_private.is_org_member(su.organization_id)
  )
);
