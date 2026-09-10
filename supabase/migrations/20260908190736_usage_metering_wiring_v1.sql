-- Usage Metering Wiring V1
-- Records billing usage only when authoritative AI/scientific work reaches a successful terminal state.
-- Commercial hard limits remain disabled until explicit non-null plan limits are configured.

create or replace function app_private.meter_ai_usage_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_key text;
  source_value text;
begin
  if tg_table_name = 'ai_plan_requests' then
    if new.status not in ('ready', 'unsupported')
       or old.status in ('ready', 'unsupported') then
      return new;
    end if;
    event_key := 'ai_plan:' || new.id::text || ':terminal';
    source_value := 'ai.plan';
  elsif tg_table_name = 'ai_interpretation_requests' then
    if new.status <> 'completed' or old.status = 'completed' then
      return new;
    end if;
    event_key := 'ai_interpretation:' || new.id::text || ':completed';
    source_value := 'ai.interpretation';
  elsif tg_table_name = 'ai_evidence_followup_requests' then
    if new.status <> 'completed' or old.status = 'completed' then
      return new;
    end if;
    event_key := 'ai_followup:' || new.id::text || ':completed';
    source_value := 'ai.followup';
  else
    raise exception 'unsupported AI usage metering source table';
  end if;

  perform app_private.record_organization_usage(
    new.organization_id,
    'ai_requests',
    1,
    event_key,
    source_value,
    coalesce(new.processing_finished_at, now())
  );

  return new;
end;
$$;

create or replace function app_private.meter_scientific_usage_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  perform app_private.record_organization_usage(
    new.organization_id,
    'workflow_runs',
    1,
    'scientific_job:' || new.id::text || ':completed',
    'scientific.' || new.job_type,
    coalesce(new.processing_finished_at, now())
  );

  return new;
end;
$$;

revoke all on function app_private.meter_ai_usage_event() from public, anon, authenticated, service_role;
revoke all on function app_private.meter_scientific_usage_event() from public, anon, authenticated, service_role;

create trigger ai_plan_requests_meter_usage
after update of status on public.ai_plan_requests
for each row
when (old.status is distinct from new.status)
execute function app_private.meter_ai_usage_event();

create trigger ai_interpretation_requests_meter_usage
after update of status on public.ai_interpretation_requests
for each row
when (old.status is distinct from new.status)
execute function app_private.meter_ai_usage_event();

create trigger ai_evidence_followup_requests_meter_usage
after update of status on public.ai_evidence_followup_requests
for each row
when (old.status is distinct from new.status)
execute function app_private.meter_ai_usage_event();

create trigger scientific_jobs_meter_usage
after update of status on public.scientific_jobs
for each row
when (old.status is distinct from new.status)
execute function app_private.meter_scientific_usage_event();
