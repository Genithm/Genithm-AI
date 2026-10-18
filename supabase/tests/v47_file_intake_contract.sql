-- Run against a freshly replayed isolated Supabase database; no fixture writes.
do $$ declare f record; n integer; begin
 select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
 where ns.nspname='public' and p.proname in ('large_data_reserve_file_v47','large_data_files_page_v47','large_data_heartbeat_file_v47','large_data_claim_file_v47');
 if n<>4 then raise exception 'V47 service functions missing'; end if;
 for f in select p.oid,p.prosecdef,p.proconfig from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
 where ns.nspname='public' and p.proname like 'large_data_%v47' loop
  if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
   or not has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'V47 function permissions invalid'; end if;
  if f.proconfig is null then raise exception 'V47 function search_path not fixed'; end if;
 end loop;
 if exists(select 1 from pg_class where oid in ('public.large_data_uploads'::regclass,'public.large_data_worker_heartbeats'::regclass) and not relrowsecurity)
 then raise exception 'V47 row security missing'; end if;
 if to_regclass('public.large_data_batch_path_v47') is null or to_regclass('public.large_data_file_page_v47') is null
 then raise exception 'V47 indexes missing'; end if;
 if not exists(select 1 from pg_constraint where conrelid='public.large_data_uploads'::regclass and conname='large_data_relative_path_v47')
 then raise exception 'V47 path protection missing'; end if;
end $$;
