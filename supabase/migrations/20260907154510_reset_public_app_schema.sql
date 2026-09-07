-- Destructive reset used once before the fresh Genithm implementation began.
-- It intentionally touches only user-created objects in public; Supabase-managed schemas remain intact.
do $$
declare r record;
begin
  for r in
    select n.nspname as schema_name, p.proname as object_name,
           pg_get_function_identity_arguments(p.oid) as identity_args, p.prokind
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format(
      'drop %s if exists %I.%I(%s) cascade',
      case when r.prokind = 'p' then 'procedure' else 'function' end,
      r.schema_name, r.object_name, r.identity_args
    );
  end loop;

  for r in select schemaname, viewname as object_name from pg_views where schemaname = 'public'
  loop execute format('drop view if exists %I.%I cascade', r.schemaname, r.object_name); end loop;

  for r in select schemaname, matviewname as object_name from pg_matviews where schemaname = 'public'
  loop execute format('drop materialized view if exists %I.%I cascade', r.schemaname, r.object_name); end loop;

  for r in select schemaname, tablename as object_name from pg_tables where schemaname = 'public'
  loop execute format('drop table if exists %I.%I cascade', r.schemaname, r.object_name); end loop;

  for r in select sequence_schema, sequence_name as object_name from information_schema.sequences where sequence_schema = 'public'
  loop execute format('drop sequence if exists %I.%I cascade', r.sequence_schema, r.object_name); end loop;

  for r in
    select n.nspname as schema_name, t.typname as object_name
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype in ('e','d')
  loop execute format('drop type if exists %I.%I cascade', r.schema_name, r.object_name); end loop;
end $$;
