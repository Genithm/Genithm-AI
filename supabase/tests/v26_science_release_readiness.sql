-- Science V26: read-only release readiness fingerprint.
-- Use against a disposable local or explicitly approved staging database ONLY.
-- This does not apply migrations, modify data, or start scientific jobs.
begin transaction read only;
with facts as (
  select
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='ai_messages'
        and column_name='protocol_input_scope'
    ) as has_scope_column,
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='ai_messages'
        and column_name='research_pipeline_run_id'
    ) as has_run_column,
    to_regprocedure('public.approve_chat_research_pipeline(uuid)') is not null as has_approval,
    to_regprocedure('public.mark_chat_protocol_input_scope(uuid,uuid,boolean)') is not null as has_attestation,
    exists (
      select 1 from pg_class where oid='public.ai_messages'::regclass
        and relrowsecurity and relforcerowsecurity
    ) as has_forced_rls,
    exists (
      select 1 from pg_constraint
      where conrelid='public.ai_messages'::regclass
        and conname='ai_messages_scoped_research_run_fk' and contype='f'
    ) as has_scoped_run_fk,
    exists (
      select 1 from pg_constraint
      where conrelid='public.ai_messages'::regclass
        and conname='ai_messages_authorized_research_link_ck' and contype='c'
    ) as has_consent_constraint
), privilege_checks as (
  select
    case when (select has_approval from facts)
      then has_function_privilege('authenticated','public.approve_chat_research_pipeline(uuid)','EXECUTE')
      else false end as authenticated_can_approve,
    case when (select has_attestation from facts)
      then has_function_privilege('service_role','public.mark_chat_protocol_input_scope(uuid,uuid,boolean)','EXECUTE')
      else false end as service_can_attest,
    case when (select has_attestation from facts)
      then has_function_privilege('authenticated','public.mark_chat_protocol_input_scope(uuid,uuid,boolean)','EXECUTE')
      else true end as browser_can_attest
)
select
  case when has_scope_column and has_run_column and has_approval
       and has_attestation and has_forced_rls
       and has_scoped_run_fk and has_consent_constraint
       and authenticated_can_approve and service_can_attest
       and not browser_can_attest
  then 'SCIENCE_V26_READY'
  else 'SCIENCE_V26_BLOCKED'
  end as readiness,
  has_scope_column, has_run_column, has_approval, has_attestation,
  has_forced_rls, has_scoped_run_fk, has_consent_constraint,
  authenticated_can_approve, service_can_attest, browser_can_attest
from facts cross join privilege_checks;
commit;
