-- V48: explicit, owner-scoped evidence snapshots for previously verified managed research files.
-- No file bytes or raw identifiers enter the conversation through this migration.
ALTER TABLE public.ai_messages
  ADD COLUMN file_evidence_v48 jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.ai_messages ADD CONSTRAINT ai_messages_file_evidence_v48_bounds
  CHECK (jsonb_typeof(file_evidence_v48) = 'array'
    AND jsonb_array_length(file_evidence_v48) <= 4
    AND pg_column_size(file_evidence_v48) <= 8192);

CREATE FUNCTION public.request_ai_chat_turn_with_files_v48(
  p_project_id uuid,
  p_conversation_id uuid,
  p_user_message text,
  p_attachment_upload_ids uuid[] DEFAULT '{}'::uuid[],
  p_research_file_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS TABLE(conversation_id uuid, user_message_id uuid, user_message text, authorized_context jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  owner_id uuid := auth.uid();
  org_id uuid;
  ids uuid[] := coalesce(p_research_file_ids, '{}'::uuid[]);
  bound_files jsonb := '[]'::jsonb;
  turn record;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION 'authentication required' USING errcode='42501'; END IF;
  IF cardinality(ids) > 4 OR array_position(ids, NULL::uuid) IS NOT NULL
    OR (SELECT count(*) FROM (SELECT DISTINCT unnest(ids) AS id) distinct_ids) <> cardinality(ids)
  THEN RAISE EXCEPTION 'invalid file evidence selection' USING errcode='22023'; END IF;
  IF cardinality(ids) > 0 THEN
    IF length(btrim(coalesce(p_user_message,''))) = 0
    THEN RAISE EXCEPTION 'file evidence requires a message' USING errcode='22023'; END IF;
    SELECT p.organization_id INTO org_id FROM public.projects p WHERE p.id = p_project_id;
    IF org_id IS NULL OR NOT app_private.can_write_org(org_id)
    THEN RAISE EXCEPTION 'project access denied' USING errcode='42501'; END IF;
    -- Verify ready, owned, same-project objects; store only the worker's bounded, immutable
    -- aggregate evidence, never an entire report or any raw file content. FOR SHARE
    -- serializes this binding against cleanup of the stored source during the turn.
    WITH authorized AS (
      SELECT u.* FROM public.large_data_uploads u
      WHERE u.id = any(ids) AND u.created_by = owner_id AND u.project_id = p_project_id
        AND u.organization_id = org_id AND u.state = 'ready'
        AND u.checked_bytes = u.expected_bytes AND u.expected_bytes > 0
        AND u.actual_sha256 = u.expected_sha256 AND u.object_etag IS NOT NULL
        AND jsonb_typeof(u.summary) = 'object'
        AND u.summary->>'schema' = 'genithm-large-data-result/1'
        AND u.summary->>'verification' = 'whole_object_sha256'
        AND u.summary->>'source_sha256' = u.expected_sha256
        AND u.summary->>'source_bytes' = u.expected_bytes::text
        AND u.summary->>'format' = u.data_format
        AND u.summary->>'report_sha256' ~ '^[a-f0-9]{64}$'
      FOR SHARE
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',u.id,'filename',left(u.original_filename,255),
      'source_sha256',u.expected_sha256,'report_sha256',u.summary->>'report_sha256',
      'source_bytes',u.expected_bytes,'format',u.data_format,
      'scientific_scope',u.summary->>'scientific_scope',
      'inspection',coalesce(u.summary->'intake'->>'inspection','legacy'),
      'fastq',CASE WHEN u.summary->>'scientific_scope' = 'full_fastq_aggregate_qc'
        THEN jsonb_build_object('read_count',u.summary#>'{metrics,read_count}',
          'base_count',u.summary#>'{metrics,base_count}',
          'mean_phred',u.summary#>'{metrics,mean_phred}',
          'gc_percent',u.summary#>'{metrics,gc_percent}') ELSE NULL END,
      'fasta',CASE WHEN u.summary->>'scientific_scope' = 'full_fasta_structural_summary'
        THEN jsonb_build_object('record_count',u.summary#>'{intake,fasta,record_count}',
          'symbol_count',u.summary#>'{intake,fasta,symbol_count}',
          'minimum_length',u.summary#>'{intake,fasta,minimum_length}',
          'maximum_length',u.summary#>'{intake,fasta,maximum_length}') ELSE NULL END
    ) ORDER BY array_position(ids,u.id)),'[]'::jsonb)
    INTO bound_files FROM authorized u;
    IF jsonb_array_length(bound_files) <> cardinality(ids)
    THEN RAISE EXCEPTION 'selected research file unavailable or not verified' USING errcode='42501'; END IF;
  END IF;
  -- The established V22+ chat RPC retains its own authentication, conversation,
  -- attachment, rate-limit and tenant checks. Its insertion shares this transaction.
  SELECT * INTO turn FROM app_private.request_ai_chat_turn(
    p_project_id,p_conversation_id,p_user_message,coalesce(p_attachment_upload_ids,'{}'::uuid[]));
  IF turn.user_message_id IS NULL THEN RAISE EXCEPTION 'chat turn was not recorded'; END IF;
  UPDATE public.ai_messages m SET file_evidence_v48=bound_files
    WHERE m.id=turn.user_message_id AND m.role='user' AND m.conversation_owner_id=owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'chat evidence binding failed'; END IF;
  RETURN QUERY SELECT turn.conversation_id::uuid,turn.user_message_id::uuid,turn.user_message::text,
    turn.authorized_context::jsonb || jsonb_build_object('selected_verified_research_files',bound_files);
END;
$$;
REVOKE ALL ON FUNCTION public.request_ai_chat_turn_with_files_v48(uuid,uuid,text,uuid[],uuid[])
  FROM public,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_ai_chat_turn_with_files_v48(uuid,uuid,text,uuid[],uuid[])
  TO authenticated;
COMMENT ON COLUMN public.ai_messages.file_evidence_v48 IS
  'Immutable-at-turn, bounded worker-reported aggregate evidence. No raw source bytes, read IDs, or automatic biological inference.';
