create or replace function app_private.validate_ai_interpretation(p_request public.ai_interpretation_requests,p_interpretation jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  finding jsonb;
  evidence_id jsonb;
  limitation jsonb;
  known_ids text[];
  cited_ids text[];
  cited_text text;
begin
  if p_interpretation is null or jsonb_typeof(p_interpretation)<>'object' or p_interpretation->>'schema_version'<>'ai-interpretation-v1' then
    raise exception 'AI interpretation schema is invalid';
  end if;
  if (p_interpretation - array['schema_version','summary','findings','limitations']) <> '{}'::jsonb then
    raise exception 'AI interpretation contains unexpected fields';
  end if;
  if not (p_interpretation ?& array['schema_version','summary','findings','limitations']) then
    raise exception 'AI interpretation is missing required fields';
  end if;
  if char_length(coalesce(p_interpretation->>'summary',''))<1 or char_length(p_interpretation->>'summary')>3000 then
    raise exception 'AI interpretation summary is invalid';
  end if;
  if jsonb_typeof(p_interpretation->'findings')<>'array' or jsonb_array_length(p_interpretation->'findings') not between 1 and 8 then
    raise exception 'AI interpretation findings are invalid';
  end if;
  if jsonb_typeof(p_interpretation->'limitations')<>'array' or jsonb_array_length(p_interpretation->'limitations')>8 then
    raise exception 'AI interpretation limitations are invalid';
  end if;

  select array_agg(f->>'id') into known_ids
  from jsonb_array_elements(p_request.evidence_snapshot->'facts') f;
  if known_ids is null or cardinality(known_ids)<1 or cardinality(known_ids)>64 then
    raise exception 'AI evidence snapshot facts are invalid';
  end if;

  for finding in select value from jsonb_array_elements(p_interpretation->'findings') loop
    if jsonb_typeof(finding)<>'object'
       or (finding - array['statement','evidence_ids']) <> '{}'::jsonb
       or not (finding ?& array['statement','evidence_ids'])
       or char_length(coalesce(finding->>'statement',''))<1
       or char_length(finding->>'statement')>1000
       or jsonb_typeof(finding->'evidence_ids')<>'array'
       or jsonb_array_length(finding->'evidence_ids') not between 1 and 6 then
      raise exception 'AI interpretation finding is invalid';
    end if;

    cited_ids:=array[]::text[];
    for evidence_id in select value from jsonb_array_elements(finding->'evidence_ids') loop
      if jsonb_typeof(evidence_id)<>'string' then
        raise exception 'AI interpretation evidence reference is invalid';
      end if;
      cited_text:=evidence_id #>> '{}';
      if cited_text is null or char_length(cited_text)<1 or char_length(cited_text)>64 or not (cited_text=any(known_ids)) then
        raise exception 'AI interpretation references unknown evidence';
      end if;
      if cited_text=any(cited_ids) then
        raise exception 'AI interpretation contains duplicate evidence references';
      end if;
      cited_ids:=array_append(cited_ids,cited_text);
    end loop;
  end loop;

  for limitation in select value from jsonb_array_elements(p_interpretation->'limitations') loop
    if jsonb_typeof(limitation)<>'string' or char_length(limitation #>> '{}')<1 or char_length(limitation #>> '{}')>500 then
      raise exception 'AI interpretation limitation is invalid';
    end if;
  end loop;
end;$$;
revoke all on function app_private.validate_ai_interpretation(public.ai_interpretation_requests,jsonb) from public,anon,authenticated,service_role;
