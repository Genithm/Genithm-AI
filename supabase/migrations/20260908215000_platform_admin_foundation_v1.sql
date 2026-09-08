create table app_private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'platform_admin',
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  reason text,
  constraint platform_admins_role_check check (role = 'platform_admin'),
  constraint platform_admins_reason_length check (reason is null or char_length(reason) <= 500)
);

alter table app_private.platform_admins enable row level security;
alter table app_private.platform_admins force row level security;
revoke all on table app_private.platform_admins from public, anon, authenticated, service_role;

create policy platform_admins_explicit_deny
on app_private.platform_admins
as restrictive
for all
to public
using (false)
with check (false);

create or replace function app_private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from app_private.platform_admins as platform_admin
      where platform_admin.user_id = (select auth.uid())
        and platform_admin.role = 'platform_admin'
    );
$$;

revoke all on function app_private.is_platform_admin() from public, anon, authenticated, service_role;
grant execute on function app_private.is_platform_admin() to authenticated;

create or replace function app_private.get_platform_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  fresh_worker_count bigint;
  worker_stale_after_seconds constant integer := 300;
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  select count(*)
  into fresh_worker_count
  from app_private.worker_runtime_heartbeats as heartbeat
  where heartbeat.last_seen_at >= now() - (worker_stale_after_seconds * interval '1 second');

  return jsonb_build_object(
    'schema_version', 'platform-admin-overview-v1',
    'checked_at', now(),
    'accounts', jsonb_build_object(
      'users', (select count(*) from auth.users),
      'organizations', (select count(*) from public.organizations),
      'memberships', (select count(*) from public.organization_members),
      'projects', (select count(*) from public.projects)
    ),
    'scientific_resources', jsonb_build_object(
      'sequence_uploads', (select count(*) from public.sequence_uploads),
      'sequence_retrievals', (select count(*) from public.sequence_retrievals),
      'blast_jobs', (select count(*) from public.blast_jobs),
      'scientific_jobs', (select count(*) from public.scientific_jobs),
      'protein_annotation_jobs', (select count(*) from public.protein_annotation_jobs),
      'scientific_reports', (select count(*) from public.scientific_reports)
    ),
    'ai_resources', jsonb_build_object(
      'plan_requests', (select count(*) from public.ai_plan_requests),
      'interpretation_requests', (select count(*) from public.ai_interpretation_requests),
      'followup_requests', (select count(*) from public.ai_evidence_followup_requests)
    ),
    'audit_event_count', (select count(*) from public.audit_events),
    'workers', jsonb_build_object(
      'expected', 6,
      'fresh', fresh_worker_count,
      'missing_or_stale', greatest(0, 6 - fresh_worker_count),
      'stale_after_seconds', worker_stale_after_seconds
    ),
    'status_counts', jsonb_build_object(
      'sequence_uploads', coalesce((
        select jsonb_object_agg(status_counts.status, status_counts.total)
        from (
          select status, count(*)::bigint as total
          from public.sequence_uploads
          group by status
        ) as status_counts
      ), '{}'::jsonb),
      'sequence_retrievals', coalesce((
        select jsonb_object_agg(status_counts.status, status_counts.total)
        from (
          select status, count(*)::bigint as total
          from public.sequence_retrievals
          group by status
        ) as status_counts
      ), '{}'::jsonb),
      'blast_jobs', coalesce((
        select jsonb_object_agg(status_counts.status, status_counts.total)
        from (
          select status, count(*)::bigint as total
          from public.blast_jobs
          group by status
        ) as status_counts
      ), '{}'::jsonb),
      'scientific_jobs', coalesce((
        select jsonb_object_agg(status_counts.status, status_counts.total)
        from (
          select status, count(*)::bigint as total
          from public.scientific_jobs
          group by status
        ) as status_counts
      ), '{}'::jsonb),
      'protein_annotation_jobs', coalesce((
        select jsonb_object_agg(status_counts.status, status_counts.total)
        from (
          select status, count(*)::bigint as total
          from public.protein_annotation_jobs
          group by status
        ) as status_counts
      ), '{}'::jsonb),
      'ai_plan_requests', coalesce((
        select jsonb_object_agg(status_counts.status, status_counts.total)
        from (
          select status, count(*)::bigint as total
          from public.ai_plan_requests
          group by status
        ) as status_counts
      ), '{}'::jsonb)
    )
  );
end;
$$;

revoke all on function app_private.get_platform_admin_overview() from public, anon, authenticated, service_role;
grant execute on function app_private.get_platform_admin_overview() to authenticated;

create or replace function app_private.get_platform_admin_organizations(
  p_page_size integer,
  p_page_offset integer
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  member_count bigint,
  project_count bigint,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.is_platform_admin() then
    raise exception 'platform admin access required' using errcode = '42501';
  end if;

  if p_page_size < 1 or p_page_size > 100 then
    raise exception 'page size must be between 1 and 100' using errcode = '22023';
  end if;

  if p_page_offset < 0 then
    raise exception 'page offset must be non-negative' using errcode = '22023';
  end if;

  return query
  select
    organization.id,
    organization.name,
    organization.slug,
    (select count(*) from public.organization_members as member where member.organization_id = organization.id),
    (select count(*) from public.projects as project where project.organization_id = organization.id),
    organization.created_at
  from public.organizations as organization
  order by organization.created_at desc, organization.id
  limit p_page_size
  offset p_page_offset;
end;
$$;

revoke all on function app_private.get_platform_admin_organizations(integer, integer) from public, anon, authenticated, service_role;
grant execute on function app_private.get_platform_admin_organizations(integer, integer) to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.is_platform_admin();
$$;

create or replace function public.get_platform_admin_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_platform_admin_overview();
$$;

create or replace function public.get_platform_admin_organizations(
  page_size integer default 50,
  page_offset integer default 0
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  member_count bigint,
  project_count bigint,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_platform_admin_organizations(page_size, page_offset);
$$;

revoke all on function public.is_platform_admin() from public, anon, authenticated, service_role;
revoke all on function public.get_platform_admin_overview() from public, anon, authenticated, service_role;
revoke all on function public.get_platform_admin_organizations(integer, integer) from public, anon, authenticated, service_role;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.get_platform_admin_overview() to authenticated;
grant execute on function public.get_platform_admin_organizations(integer, integer) to authenticated;

comment on table app_private.platform_admins is
  'Operator-managed Genithm platform-admin entitlements. Not exposed through the Data API and never derived from user-editable metadata.';

comment on function public.get_platform_admin_overview() is
  'Platform-admin-only aggregate operational overview. Returns counts and worker liveness only; never returns scientific payloads, prompts, user emails, or result bodies.';

comment on function public.get_platform_admin_organizations(integer, integer) is
  'Platform-admin-only bounded organization summaries with names/slugs and aggregate member/project counts; no member identities or scientific content.';
