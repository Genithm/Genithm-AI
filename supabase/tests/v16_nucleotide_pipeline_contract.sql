-- Science V16: disposable local Supabase contract checks after all migrations.
-- No user records, scientific jobs or upstream NCBI requests are created.
do $v16$
declare
  dispatcher text;
  terminal_handler text;
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.research_pipeline_runs'::regclass
      and conname='research_pipeline_template_ck'
      and pg_get_constraintdef(oid) like '%ncbi_nucleotide_orf_v1%'
      and pg_get_constraintdef(oid) like '%ncbi_protein_profile_v1%'
  ) then raise exception 'Both approved pipeline templates must be constrained'; end if;
  if not exists(
    select 1 from pg_class
    where oid='public.research_pipeline_runs'::regclass
      and relrowsecurity and relforcerowsecurity
  ) then raise exception 'Autonomous runs require forced RLS'; end if;
  if has_table_privilege('anon','public.research_pipeline_runs','SELECT') or
     has_table_privilege('authenticated','public.research_pipeline_runs','INSERT') or
     has_table_privilege('authenticated','public.research_pipeline_runs','UPDATE') then
    raise exception 'V16 must not expand direct pipeline table grants'; end if;
  if to_regprocedure('public.request_research_nucleotide_pipeline(uuid,text)') is null
    or not has_function_privilege('authenticated',
      'public.request_research_nucleotide_pipeline(uuid,text)','EXECUTE')
    or has_function_privilege('anon',
      'public.request_research_nucleotide_pipeline(uuid,text)','EXECUTE')
    or has_function_privilege('service_role',
      'app_private.advance_research_protein_pipeline(uuid)','EXECUTE') then
    raise exception 'Nucleotide launch or internal workflow grants are unsafe'; end if;
  select pg_get_functiondef('app_private.advance_research_protein_pipeline(uuid)'::regprocedure)
    into dispatcher;
  if position('request_protein_properties' in dispatcher)=0
     or position('request_sequence_insights' in dispatcher)=0
     or position('orf_scan' in dispatcher)=0
     or position('FOR UPDATE' in upper(dispatcher))=0
     or position('i.input_sha256=seq.sha256' in dispatcher)=0
     or position('coalesce(seq.residue_count,0) between 1 and 50000' in dispatcher)=0 then
    raise exception 'Locked, bounded two-template dispatch invariants missing'; end if;
  select pg_get_functiondef('app_private.on_protein_pipeline_scientific_finished()'::regprocedure)
    into terminal_handler;
  if position('sequence_insights' in terminal_handler)=0
     or position('orf_scan' in terminal_handler)=0
     or position('protein_properties' in terminal_handler)=0
     or position('i.input_sha256=target.sequence_sha256' in terminal_handler)=0 then
    raise exception 'Both scientific terminal states must verify provenance'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and
      tgname in ('research_pipeline_source_completed',
                 'research_pipeline_fasta_validated',
                 'research_pipeline_scientific_finished'))<>3 then
    raise exception 'Unexpected source, validation or completion trigger topology'; end if;
end
$v16$;
