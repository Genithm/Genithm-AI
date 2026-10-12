-- V14: run against disposable local Supabase after replaying all migrations.
-- No user identities, real jobs or external provider calls are created.
do $v14$
declare
  dispatch_definition text;
  source_trigger_count integer;
  upload_trigger_count integer;
  science_trigger_count integer;
begin
  if to_regclass('public.research_pipeline_runs') is null then
    raise exception 'V14 research pipeline table is missing';
  end if;
  if not exists(
    select 1 from pg_class c where c.oid='public.research_pipeline_runs'::regclass
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'V14 pipeline RLS must be enabled and forced';
  end if;
  if not has_table_privilege('authenticated','public.research_pipeline_runs','SELECT')
     or has_table_privilege('authenticated','public.research_pipeline_runs','INSERT')
     or has_table_privilege('authenticated','public.research_pipeline_runs','UPDATE')
     or has_table_privilege('authenticated','public.research_pipeline_runs','DELETE')
     or has_table_privilege('anon','public.research_pipeline_runs','SELECT') then
    raise exception 'V14 pipeline client grants exceed owner-only read permissions';
  end if;
  if not exists(
    select 1 from pg_policies where schemaname='public' and tablename='research_pipeline_runs'
      and cmd='SELECT' and roles @> array['authenticated']::name[]
      and position('auth.uid()' in qual)>0
  ) then
    raise exception 'V14 authenticated owner SELECT policy is missing';
  end if;

  if to_regprocedure('public.request_research_protein_pipeline(uuid,text)') is null or
     to_regprocedure('app_private.advance_research_protein_pipeline(uuid)') is null then
    raise exception 'V14 narrow request/advancement functions are missing';
  end if;
  if not has_function_privilege('authenticated',
    'public.request_research_protein_pipeline(uuid,text)','EXECUTE')
     or has_function_privilege('anon',
       'public.request_research_protein_pipeline(uuid,text)','EXECUTE')
     or has_function_privilege('service_role',
       'app_private.advance_research_protein_pipeline(uuid)','EXECUTE')
     or has_function_privilege('authenticated',
       'app_private.advance_research_protein_pipeline(uuid)','EXECUTE') then
    raise exception 'V14 public request or privileged advancement grants are unsafe';
  end if;
  select count(*) into source_trigger_count from pg_trigger
    where tgrelid='public.sequence_retrievals'::regclass
      and tgname='research_pipeline_source_completed' and not tgisinternal;
  select count(*) into upload_trigger_count from pg_trigger
    where tgrelid='public.sequence_uploads'::regclass
      and tgname='research_pipeline_fasta_validated' and not tgisinternal;
  select count(*) into science_trigger_count from pg_trigger
    where tgrelid='public.scientific_jobs'::regclass
      and tgname='research_pipeline_scientific_finished' and not tgisinternal;
  if source_trigger_count<>1 or upload_trigger_count<>1 or science_trigger_count<>1 then
    raise exception 'V14 exact source, validation and scientific triggers not found';
  end if;
  dispatch_definition := pg_get_functiondef(
    'app_private.advance_research_protein_pipeline(uuid)'::regprocedure
  );
  if position('FOR UPDATE' in upper(dispatch_definition))=0
     or position('request_protein_properties' in dispatch_definition)=0
     or position('set_config' in dispatch_definition)=0
     or position('run.requested_by' in dispatch_definition)=0 then
    raise exception 'V14 actor-bound serialized dispatch contract is missing';
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.research_pipeline_runs'::regclass
      and conname='research_pipeline_finish_ck'
  ) or not exists(
    select 1 from pg_constraint
    where conrelid='public.research_pipeline_runs'::regclass
      and conname='research_pipeline_status_job_ck'
  ) then
    raise exception 'V14 terminal and downstream dependency constraints are missing';
  end if;
end
$v14$;
