create or replace function public.get_ai_operational_health(target_project_id uuid default null)
returns table (
  organization_id uuid,
  organization_name text,
  visibility_scope text,
  pipeline text,
  queued_count bigint,
  active_count bigint,
  terminal_24h_count bigint,
  error_24h_count bigint,
  oldest_queued_seconds bigint,
  oldest_active_seconds bigint,
  max_attempts integer,
  health text,
  refreshed_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  return query
  with request_rows as (
    select
      p.organization_id,
      'planner'::text as pipeline,
      p.status,
      p.processing_attempts,
      p.created_at,
      p.processing_started_at,
      p.updated_at,
      (p.status = 'queued') as is_queued,
      (p.status = 'planning') as is_active,
      (p.status in ('ready','unsupported','dispatched')) as is_terminal,
      (p.status = 'error') as is_error
    from public.ai_plan_requests p
    where p.requested_by = caller_id
      and (target_project_id is null or p.project_id = target_project_id)

    union all

    select
      i.organization_id,
      'interpretation'::text,
      i.status,
      i.processing_attempts,
      i.created_at,
      i.processing_started_at,
      i.updated_at,
      (i.status = 'queued'),
      (i.status = 'interpreting'),
      (i.status = 'completed'),
      (i.status = 'error')
    from public.ai_interpretation_requests i
    where i.requested_by = caller_id
      and (target_project_id is null or i.project_id = target_project_id)

    union all

    select
      f.organization_id,
      'evidence_followup'::text,
      f.status,
      f.processing_attempts,
      f.created_at,
      f.processing_started_at,
      f.updated_at,
      (f.status = 'queued'),
      (f.status = 'answering'),
      (f.status = 'completed'),
      (f.status = 'error')
    from public.ai_evidence_followup_requests f
    where f.requested_by = caller_id
      and (target_project_id is null or f.project_id = target_project_id)
  ), visible_orgs as (
    select distinct rr.organization_id, o.name
    from request_rows rr
    join public.organizations o on o.id = rr.organization_id
  ), pipelines(pipeline) as (
    values ('planner'::text), ('interpretation'::text), ('evidence_followup'::text)
  ), metrics as (
    select
      vo.organization_id,
      vo.name as organization_name,
      pl.pipeline,
      count(rr.*) filter (where rr.is_queued) as queued_count,
      count(rr.*) filter (where rr.is_active) as active_count,
      count(rr.*) filter (where rr.is_terminal and rr.updated_at >= now() - interval '24 hours') as terminal_24h_count,
      count(rr.*) filter (where rr.is_error and rr.updated_at >= now() - interval '24 hours') as error_24h_count,
      coalesce(max(rr.processing_attempts),0)::integer as max_attempts,
      min(rr.created_at) filter (where rr.is_queued) as oldest_queued_at,
      min(coalesce(rr.processing_started_at,rr.updated_at)) filter (where rr.is_active) as oldest_active_at
    from visible_orgs vo
    cross join pipelines pl
    left join request_rows rr on rr.organization_id = vo.organization_id and rr.pipeline = pl.pipeline
    group by vo.organization_id, vo.name, pl.pipeline
  )
  select
    m.organization_id,
    m.organization_name,
    'self'::text,
    m.pipeline,
    m.queued_count,
    m.active_count,
    m.terminal_24h_count,
    m.error_24h_count,
    case when m.oldest_queued_at is null then null else greatest(0, floor(extract(epoch from (now() - m.oldest_queued_at)))::bigint) end,
    case when m.oldest_active_at is null then null else greatest(0, floor(extract(epoch from (now() - m.oldest_active_at)))::bigint) end,
    m.max_attempts,
    case
      when m.error_24h_count > 0 then 'attention'
      when m.oldest_queued_at is not null and now() - m.oldest_queued_at > interval '5 minutes' then 'attention'
      when m.oldest_active_at is not null and now() - m.oldest_active_at > interval '15 minutes' then 'attention'
      else 'healthy'
    end,
    now()
  from metrics m
  order by m.organization_name, m.pipeline;
end;
$$;

revoke all on function public.get_ai_operational_health(uuid) from public, anon, service_role;
grant execute on function public.get_ai_operational_health(uuid) to authenticated;

comment on function public.get_ai_operational_health(uuid) is
  'Returns bounded AI lifecycle aggregate health for the authenticated caller only. SECURITY INVOKER preserves underlying RLS as the final authorization boundary; no prompts, evidence, answers, or scientific result bodies are exposed.';
