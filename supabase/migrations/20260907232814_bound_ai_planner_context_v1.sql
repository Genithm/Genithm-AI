create or replace function app_private.claim_ai_plan_request(p_visibility_seconds integer default 300)
returns table(message_id bigint,plan_request_id uuid,conversation_id uuid,organization_id uuid,project_id uuid,requested_by uuid,user_message text,authorized_context jsonb)
language plpgsql security definer set search_path='' as $$
declare q record; target public.ai_plan_requests%rowtype; target_id uuid; msg text; context jsonb;
begin
  if p_visibility_seconds<60 or p_visibility_seconds>900 then raise exception 'visibility timeout must be between 60 and 900 seconds'; end if;
  select * into q from pgmq.read(queue_name=>'ai_planning',vt=>p_visibility_seconds,qty=>1) limit 1;
  if not found then return; end if;
  begin target_id:=(q.message->>'plan_request_id')::uuid; exception when others then perform pgmq.delete('ai_planning',q.msg_id); return; end;
  select * into target from public.ai_plan_requests where id=target_id for update;
  if not found or target.status<>'queued' then perform pgmq.delete('ai_planning',q.msg_id); return; end if;
  select content into msg from public.ai_messages where id=target.user_message_id and role='user';
  if msg is null then
    update public.ai_plan_requests set status='error',processing_error='User message is missing.',processing_finished_at=now(),updated_at=now() where id=target.id;
    perform pgmq.delete('ai_planning',q.msg_id); return;
  end if;

  select jsonb_build_object(
    'project',jsonb_build_object('id',target.project_id),
    'conversation_history',coalesce((
      select jsonb_agg(jsonb_build_object('role',h.role,'kind',h.message_kind,'content',left(h.content,4000)) order by h.created_at asc)
      from (
        select role,message_kind,content,created_at
        from public.ai_messages
        where conversation_id=target.conversation_id and id<>target.user_message_id
        order by created_at desc
        limit 8
      ) h
    ),'[]'::jsonb),
    'sequences',coalesce((
      select jsonb_agg(jsonb_build_object('id',u.id,'filename',left(u.original_filename,255),'sequence_type',u.sequence_type,'residue_count',u.residue_count,'sha256',u.sha256) order by u.created_at desc)
      from (
        select id,original_filename,sequence_type,residue_count,sha256,created_at
        from public.sequence_uploads
        where project_id=target.project_id and organization_id=target.organization_id and status='ready' and sequence_count=1 and sha256 is not null
        order by created_at desc
        limit 100
      ) u
    ),'[]'::jsonb),
    'scientific_jobs',coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'job_type',s.job_type,'status',s.status,'tool_id',s.tool_id,'tool_version',s.tool_version,'result_sha256',s.result_sha256,'result_summary',s.result_summary) order by s.created_at desc)
      from (
        select id,job_type,status,tool_id,tool_version,result_sha256,result_summary,created_at
        from public.scientific_jobs
        where project_id=target.project_id and organization_id=target.organization_id
        order by created_at desc
        limit 30
      ) s
    ),'[]'::jsonb),
    'ncbi_retrievals',coalesce((
      select jsonb_agg(jsonb_build_object('id',r.id,'source_database',r.source_database,'resolved_accession',r.resolved_accession,'status',r.status,'sequence_upload_id',r.sequence_upload_id) order by r.created_at desc)
      from (
        select id,source_database,resolved_accession,status,sequence_upload_id,created_at
        from public.sequence_retrievals
        where project_id=target.project_id and organization_id=target.organization_id
        order by created_at desc
        limit 30
      ) r
    ),'[]'::jsonb),
    'protein_annotations',coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'sequence_upload_id',a.sequence_upload_id,'status',a.status,'refseq_accession',a.refseq_accession,'uniprot_accession',a.uniprot_accession) order by a.created_at desc)
      from (
        select id,sequence_upload_id,status,refseq_accession,uniprot_accession,created_at
        from public.protein_annotation_jobs
        where project_id=target.project_id and organization_id=target.organization_id
        order by created_at desc
        limit 20
      ) a
    ),'[]'::jsonb)
  ) into context;

  update public.ai_plan_requests set status='planning',processing_attempts=processing_attempts+1,processing_started_at=coalesce(processing_started_at,now()),processing_error=null,updated_at=now() where id=target.id;
  return query select q.msg_id::bigint,target.id,target.conversation_id,target.organization_id,target.project_id,target.requested_by,msg,context;
end;$$;
