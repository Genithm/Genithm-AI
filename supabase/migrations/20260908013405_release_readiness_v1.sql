create or replace function app_private.get_release_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  expected_queues constant text[] := array[
    'ai_evidence_followup',
    'ai_interpretation',
    'ai_planning',
    'audit_checkpoint_signing',
    'blast_remote',
    'ncbi_sequence_retrieval',
    'protein_annotation',
    'scientific_standard',
    'sequence_validation'
  ];
  missing_queues text[];
  stale_queues text[];
  total_backlog bigint;
  max_oldest_message_age_seconds integer;
begin
  select
    coalesce(array_agg(expected.queue_name order by expected.queue_name) filter (where metrics.queue_name is null), array[]::text[]),
    coalesce(array_agg(metrics.queue_name order by metrics.queue_name) filter (
      where metrics.queue_length > 0 and metrics.oldest_msg_age_sec > 900
    ), array[]::text[]),
    coalesce(sum(metrics.queue_length), 0),
    max(metrics.oldest_msg_age_sec)
  into missing_queues, stale_queues, total_backlog, max_oldest_message_age_seconds
  from unnest(expected_queues) as expected(queue_name)
  left join pgmq.metrics_all() as metrics on metrics.queue_name = expected.queue_name;

  return jsonb_build_object(
    'status', case
      when cardinality(missing_queues) = 0 and cardinality(stale_queues) = 0 then 'ready'
      else 'not_ready'
    end,
    'expected_queue_count', cardinality(expected_queues),
    'missing_queues', to_jsonb(missing_queues),
    'stale_queues', to_jsonb(stale_queues),
    'total_backlog', total_backlog,
    'max_oldest_message_age_seconds', max_oldest_message_age_seconds,
    'checked_at', now()
  );
end;
$$;

revoke all on function app_private.get_release_readiness() from public, anon, authenticated, service_role;
grant execute on function app_private.get_release_readiness() to service_role;

create or replace function public.get_release_readiness()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_release_readiness();
$$;

revoke all on function public.get_release_readiness() from public, anon, authenticated;
grant execute on function public.get_release_readiness() to service_role;

comment on function public.get_release_readiness() is
  'Service-only bounded release-readiness summary. Verifies expected durable PGMQ queues exist and flags backlog older than 15 minutes without exposing queue message bodies.';