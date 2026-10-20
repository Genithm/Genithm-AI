-- Disposable Supabase Local CI only. Test owner/tenant binding and an atomic
-- verified aggregate snapshot. Entire fixture is rolled back at completion.
BEGIN;
DO $$
DECLARE fn oid := to_regprocedure('public.request_ai_chat_turn_with_files_v48(uuid,uuid,text,uuid[],uuid[])');
BEGIN
 IF fn IS NULL THEN RAISE EXCEPTION 'V48 chat evidence RPC is missing'; END IF;
 IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE')
    OR NOT has_function_privilege('authenticated',fn,'EXECUTE') THEN
  RAISE EXCEPTION 'V48 grants do not isolate authenticated chat users';
 END IF;
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid=fn) OR
    NOT (SELECT 'search_path='=ANY(proconfig) FROM pg_proc WHERE oid=fn) THEN
  RAISE EXCEPTION 'V48 function security context invalid';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_messages'::regclass
     AND conname='ai_messages_file_evidence_v48_bounds') THEN
  RAISE EXCEPTION 'V48 evidence size constraint is missing';
 END IF;
 IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.ai_messages'::regclass) THEN
  RAISE EXCEPTION 'AI message RLS policy weakened';
 END IF;
END $$;

INSERT INTO auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
VALUES ('b1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v48-owner@localhost.invalid','',now()),
       ('b1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v48-foreign@localhost.invalid','',now());
INSERT INTO public.organizations(id,name,slug,created_by)
VALUES ('b2000000-0000-4000-8000-000000000001','V48 Org Owner','v48-org-owner','b1000000-0000-4000-8000-000000000001'),
       ('b2000000-0000-4000-8000-000000000002','V48 Org Foreign','v48-org-foreign','b1000000-0000-4000-8000-000000000002');
INSERT INTO public.organization_members(organization_id,user_id,role)
VALUES ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','owner'),
       ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','owner');
INSERT INTO public.projects(id,organization_id,name,created_by)
VALUES ('b3000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','V48 Owner Project','b1000000-0000-4000-8000-000000000001'),
       ('b3000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','V48 Foreign Project','b1000000-0000-4000-8000-000000000002');
INSERT INTO public.large_data_uploads
 (id,organization_id,project_id,created_by,request_id,original_filename,data_format,
 expected_bytes,expected_sha256,storage_identity,object_key,state,checked_bytes,actual_sha256,object_etag,summary)
SELECT id,org,project,owner,gen_random_uuid(),filename,'opaque',12,repeat('a',64),repeat('c',64),
 'quarantine/'||org||'/'||project||'/'||id||'/input',state,CASE WHEN state='ready' THEN 12 ELSE 0 END,
 CASE WHEN state='ready' THEN repeat('a',64) ELSE NULL END,
 CASE WHEN state='ready' THEN '"etag"' ELSE NULL END,
 CASE WHEN state='ready' THEN jsonb_build_object(
   'schema','genithm-large-data-result/1','source_bytes',12,'source_sha256',repeat('a',64),
   'verification','whole_object_sha256','scientific_scope','bytes_only','format','opaque',
   'report_sha256',repeat('b',64),'intake',jsonb_build_object('inspection','integrity_only'),'metrics',NULL)
 ELSE NULL END
FROM (VALUES
 ('b4000000-0000-4000-8000-000000000001'::uuid,'b2000000-0000-4000-8000-000000000001'::uuid,'b3000000-0000-4000-8000-000000000001'::uuid,'b1000000-0000-4000-8000-000000000001'::uuid,'owner.fa','ready'),
 ('b4000000-0000-4000-8000-000000000002'::uuid,'b2000000-0000-4000-8000-000000000002'::uuid,'b3000000-0000-4000-8000-000000000002'::uuid,'b1000000-0000-4000-8000-000000000002'::uuid,'foreign.fa','ready'),
 ('b4000000-0000-4000-8000-000000000003'::uuid,'b2000000-0000-4000-8000-000000000001'::uuid,'b3000000-0000-4000-8000-000000000001'::uuid,'b1000000-0000-4000-8000-000000000001'::uuid,'pending.fa','uploaded')
) AS f(id,org,project,owner,filename,state);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
DO $v48$
DECLARE result record; old_count integer; snapshot jsonb;
BEGIN
 SELECT count(*) INTO old_count FROM public.ai_messages WHERE project_id='b3000000-0000-4000-8000-000000000001';
 SELECT * INTO result FROM public.request_ai_chat_turn_with_files_v48(
   'b3000000-0000-4000-8000-000000000001',NULL,'Explain only what is actually verified',
   '{}'::uuid[],ARRAY['b4000000-0000-4000-8000-000000000001'::uuid]);
 IF result.user_message_id IS NULL OR result.conversation_id IS NULL THEN
   RAISE EXCEPTION 'V48 verified file turn not created'; END IF;
 SELECT file_evidence_v48 INTO snapshot FROM public.ai_messages WHERE id=result.user_message_id;
 IF jsonb_array_length(snapshot)<>1 OR snapshot->0->>'scientific_scope'<>'bytes_only'
    OR snapshot->0->>'source_sha256'<>repeat('a',64)
    OR snapshot IS DISTINCT FROM result.authorized_context->'selected_verified_research_files'
    OR snapshot->0->'fasta'<>'null'::jsonb OR snapshot->0->'fastq'<>'null'::jsonb THEN
   RAISE EXCEPTION 'V48 failed evidence lineage or invented biology'; END IF;
 IF (SELECT count(*) FROM public.ai_messages WHERE project_id='b3000000-0000-4000-8000-000000000001')<>old_count+1 THEN
   RAISE EXCEPTION 'V48 extra messages created'; END IF;
 BEGIN
  PERFORM * FROM public.request_ai_chat_turn_with_files_v48('b3000000-0000-4000-8000-000000000001',NULL,
      'Foreign source', '{}'::uuid[], ARRAY['b4000000-0000-4000-8000-000000000002'::uuid]);
  RAISE EXCEPTION 'Cross-tenant file accepted';
 EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
 BEGIN
  PERFORM * FROM public.request_ai_chat_turn_with_files_v48('b3000000-0000-4000-8000-000000000001',NULL,'Unverified file',
     '{}'::uuid[],ARRAY['b4000000-0000-4000-8000-000000000003'::uuid]);
  RAISE EXCEPTION 'Unverified upload accepted';
 EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
 BEGIN
  PERFORM * FROM public.request_ai_chat_turn_with_files_v48('b3000000-0000-4000-8000-000000000001',NULL,'Duplicate selection',
     '{}'::uuid[],ARRAY['b4000000-0000-4000-8000-000000000001'::uuid,'b4000000-0000-4000-8000-000000000001'::uuid]);
  RAISE EXCEPTION 'Duplicate research file accepted';
 EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
 IF (SELECT count(*) FROM public.ai_messages WHERE project_id='b3000000-0000-4000-8000-000000000001')<>old_count+1 THEN
   RAISE EXCEPTION 'Rejected file turn left a partial message'; END IF;
END $v48$;
RESET ROLE;
ROLLBACK;
