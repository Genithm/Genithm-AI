-- V24 research archive: disposable local RLS + deep-history + stable paging test.
-- All fixture records, science enqueues, and memberships roll back with this
-- transaction. Synthetic repeated links are test setup only, never application
-- approval behavior.
begin;
insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at)
values
 ('c1000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v24-archive-a@localhost.invalid','',now()),
 ('c1000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','v24-archive-b@localhost.invalid','',now());
insert into public.organizations(id,name,slug,created_by)
values
 ('c2000000-0000-4000-8000-000000000001','V24 archive test A','v24-archive-test-a','c1000000-0000-4000-8000-000000000001'),
 ('c2000000-0000-4000-8000-000000000002','V24 archive test B','v24-archive-test-b','c1000000-0000-4000-8000-000000000002');
insert into public.organization_members(organization_id,user_id,role)
values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','owner'),
 ('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002','owner');
insert into public.projects(id,organization_id,name,created_by)
values
 ('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','V24 archive project A','c1000000-0000-4000-8000-000000000001'),
 ('c3000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','V24 archive project B','c1000000-0000-4000-8000-000000000002');
insert into public.ai_conversations(id,organization_id,project_id,created_by,title,status)
values
 ('c4000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','V24 historical A','active'),
 ('c4000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000002','V24 historical B','active');

-- 275 newer ordinary messages bury the 27 approved messages deeper than the
-- chat UI's most recent 250-message window.
insert into public.ai_messages(
  id,conversation_id,organization_id,project_id,conversation_owner_id,role,content,created_at
)
select gen_random_uuid(),
 'c4000000-0000-4000-8000-000000000001',
 'c2000000-0000-4000-8000-000000000001',
 'c3000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000001',
 'user','Routine chat without scientific approval',
 '2026-10-14T00:00:00Z'::timestamptz + (g * interval '1 second')
from generate_series(1,275) g;

-- All 27 share a timestamp so pagination must use UUID as a tie-breaker.
insert into public.ai_messages(
  id,conversation_id,organization_id,project_id,conversation_owner_id,role,content,created_at,protocol_input_scope
)
select gen_random_uuid(),
 'c4000000-0000-4000-8000-000000000001',
 'c2000000-0000-4000-8000-000000000001',
 'c3000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000001',
 'user','Retrieve NM_000546.6 and run an ORF scan',
 '2026-10-13T00:00:00Z'::timestamptz,'text_only'
from generate_series(1,27);
insert into public.ai_messages(
  id,conversation_id,organization_id,project_id,conversation_owner_id,role,content,created_at,protocol_input_scope
)
values (
 'c5000000-0000-4000-8000-000000000002',
 'c4000000-0000-4000-8000-000000000002',
 'c2000000-0000-4000-8000-000000000002',
 'c3000000-0000-4000-8000-000000000002',
 'c1000000-0000-4000-8000-000000000002',
 'user','Retrieve NM_000546.6 and run an ORF scan',
 '2026-10-13T00:00:00Z','text_only'
);

-- Exercise an actual user-approved run, then populate repeated, consent-
-- compatible historical fixture links without hitting NCBI rate limits.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
do $approve_once$
declare message_id uuid; run_id uuid;
begin
  select id into message_id from public.ai_messages
  where conversation_id='c4000000-0000-4000-8000-000000000001'
    and content='Retrieve NM_000546.6 and run an ORF scan'
  limit 1;
  run_id := public.approve_chat_research_pipeline(message_id);
  if run_id is null then raise exception 'V24 setup failed to create approved run'; end if;
end
$approve_once$;
reset role;

update public.ai_messages set research_pipeline_run_id=(
  select research_pipeline_run_id from public.ai_messages
  where conversation_id='c4000000-0000-4000-8000-000000000001'
    and research_pipeline_run_id is not null limit 1
)
where conversation_id='c4000000-0000-4000-8000-000000000001'
  and content='Retrieve NM_000546.6 and run an ORF scan'
  and protocol_input_scope='text_only';

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
do $paging$
declare
  cut_time timestamptz;
  cut_id uuid;
  linked_count integer;
  recent_count integer;
  first_count integer;
  second_count integer;
  overlap_count integer;
begin
  select count(*) into linked_count from public.ai_messages
  where conversation_owner_id=auth.uid() and role='user'
    and research_pipeline_run_id is not null;
  if linked_count<>27 then
    raise exception 'V24 archive should see all 27 links, got %',linked_count;
  end if;

  select count(*) into recent_count from (
    select research_pipeline_run_id from public.ai_messages
    where conversation_owner_id=auth.uid()
    order by created_at desc,id desc limit 250
  ) recent where research_pipeline_run_id is not null;
  if recent_count<>0 then
    raise exception 'V24 fixture does not place history outside the 250-message window';
  end if;

  select created_at,id into cut_time,cut_id
  from public.ai_messages
  where conversation_owner_id=auth.uid()
    and research_pipeline_run_id is not null
  order by created_at desc,id desc offset 24 limit 1;

  select count(*) into first_count from (
    select id from public.ai_messages
    where conversation_owner_id=auth.uid()
      and research_pipeline_run_id is not null
    order by created_at desc,id desc limit 25
  ) first_page;
  select count(*) into second_count from public.ai_messages
  where conversation_owner_id=auth.uid()
    and research_pipeline_run_id is not null
    and (created_at<cut_time or (created_at=cut_time and id<cut_id));
  select count(*) into overlap_count
  from (
    select id from public.ai_messages where conversation_owner_id=auth.uid()
      and research_pipeline_run_id is not null
    order by created_at desc,id desc limit 25
  ) first_page
  join public.ai_messages older on older.id=first_page.id
  where older.created_at<cut_time or (older.created_at=cut_time and older.id<cut_id);
  if first_count<>25 or second_count<>2 or overlap_count<>0 then
    raise exception 'V24 cursor paging failed (first %, second %, overlap %)',
      first_count,second_count,overlap_count;
  end if;

  if exists(select 1 from public.ai_messages
    where conversation_id='c4000000-0000-4000-8000-000000000002') then
    raise exception 'V24 archive leaked a foreign conversation message';
  end if;
  if (select count(*) from public.ai_messages
       where conversation_id='c4000000-0000-4000-8000-000000000001'
         and research_pipeline_run_id is not null)<>27 then
    raise exception 'V24 original conversation links are not recoverable under RLS';
  end if;
end
$paging$;
reset role;

-- The foreign authenticated user cannot discover or relink A's archive.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
do $foreign_archive$
begin
  if exists(select 1 from public.ai_messages
    where research_pipeline_run_id is not null) then
    raise exception 'Cross-tenant approved archive message became visible';
  end if;
  if exists(select 1 from public.research_pipeline_runs
    where project_id='c3000000-0000-4000-8000-000000000001') then
    raise exception 'Cross-tenant pipeline was visible under authenticated RLS';
  end if;
end
$foreign_archive$;
reset role;
rollback;
