create or replace function app_private.finish_protein_annotation_success(
  p_message_id bigint,p_job_id uuid,p_connector_version text,p_mapping_candidate_count integer,p_mapping_response_sha256 text,p_mapping_response_bytes bigint,
  p_uniprot_accession text,p_uniprot_entry_id text,p_uniprot_reviewed boolean,p_uniprot_release text,p_uniprot_release_date text,p_uniprot_sequence_sha256 text,p_uniprot_response_sha256 text,p_uniprot_response_bytes bigint,
  p_protein_name text,p_gene_names jsonb,p_organism_name text,p_interpro_entries jsonb,p_interpro_response_sha256 text,p_interpro_response_bytes bigint,p_pfam_entries jsonb,p_pfam_response_sha256 text,p_pfam_response_bytes bigint,p_annotation_summary jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare target public.protein_annotation_jobs%rowtype; interpro_count integer; pfam_count integer;
begin
  select * into target from public.protein_annotation_jobs where id=p_job_id for update;
  if not found or target.status<>'retrieving' then raise exception 'protein annotation job is not active' using errcode='P0002'; end if;
  if nullif(trim(p_connector_version),'') is null or char_length(trim(p_connector_version))>128 then raise exception 'connector version is invalid'; end if;
  if p_mapping_candidate_count<1 or p_mapping_candidate_count>100 then raise exception 'mapping candidate count is invalid'; end if;
  if p_mapping_response_sha256 !~ '^[0-9a-f]{64}$' or p_mapping_response_bytes<1 or p_mapping_response_bytes>10485760 then raise exception 'mapping response provenance is invalid'; end if;
  if nullif(trim(p_uniprot_accession),'') is null or char_length(trim(p_uniprot_accession))>20 or trim(p_uniprot_accession) !~ '^[A-Z0-9-]+$' then raise exception 'UniProt accession is invalid'; end if;
  if nullif(trim(p_uniprot_entry_id),'') is null or char_length(trim(p_uniprot_entry_id))>64 then raise exception 'UniProt entry identifier is invalid'; end if;
  if p_uniprot_sequence_sha256 is distinct from target.input_sha256 then raise exception 'UniProt sequence does not match immutable Genithm input'; end if;
  if p_uniprot_response_sha256 !~ '^[0-9a-f]{64}$' or p_uniprot_response_bytes<1 or p_uniprot_response_bytes>10485760 then raise exception 'UniProt response provenance is invalid'; end if;
  if p_interpro_response_sha256 !~ '^[0-9a-f]{64}$' or p_interpro_response_bytes<1 or p_interpro_response_bytes>20971520 then raise exception 'InterPro response provenance is invalid'; end if;
  if p_pfam_response_sha256 !~ '^[0-9a-f]{64}$' or p_pfam_response_bytes<1 or p_pfam_response_bytes>20971520 then raise exception 'Pfam response provenance is invalid'; end if;
  if p_gene_names is null or jsonb_typeof(p_gene_names)<>'array' or jsonb_array_length(p_gene_names)>100 then raise exception 'gene-name evidence is invalid'; end if;
  if p_interpro_entries is null or jsonb_typeof(p_interpro_entries)<>'array' or jsonb_array_length(p_interpro_entries)>1000 then raise exception 'InterPro evidence is invalid'; end if;
  if p_pfam_entries is null or jsonb_typeof(p_pfam_entries)<>'array' or jsonb_array_length(p_pfam_entries)>1000 then raise exception 'Pfam evidence is invalid'; end if;
  if p_annotation_summary is null or jsonb_typeof(p_annotation_summary)<>'object' then raise exception 'annotation summary is invalid'; end if;
  interpro_count := jsonb_array_length(p_interpro_entries); pfam_count := jsonb_array_length(p_pfam_entries);
  begin
    if (p_annotation_summary->>'interpro_entry_count')::integer<>interpro_count or (p_annotation_summary->>'pfam_entry_count')::integer<>pfam_count or p_annotation_summary->>'uniprot_accession' is distinct from trim(p_uniprot_accession) or p_annotation_summary->>'input_sha256' is distinct from target.input_sha256 then raise exception 'annotation summary provenance mismatch'; end if;
  exception when others then raise exception 'annotation summary metrics are invalid'; end;
  update public.protein_annotation_jobs set status='completed',freshness_policy='live_source_no_cache',source_checked_at=now(),mapping_candidate_count=p_mapping_candidate_count,mapping_response_sha256=p_mapping_response_sha256,mapping_response_bytes=p_mapping_response_bytes,uniprot_accession=trim(p_uniprot_accession),uniprot_entry_id=trim(p_uniprot_entry_id),uniprot_reviewed=p_uniprot_reviewed,uniprot_release=nullif(trim(p_uniprot_release),''),uniprot_release_date=nullif(trim(p_uniprot_release_date),''),uniprot_sequence_sha256=p_uniprot_sequence_sha256,uniprot_response_sha256=p_uniprot_response_sha256,uniprot_response_bytes=p_uniprot_response_bytes,protein_name=nullif(trim(p_protein_name),''),gene_names=p_gene_names,organism_name=nullif(trim(p_organism_name),''),interpro_entries=p_interpro_entries,interpro_response_sha256=p_interpro_response_sha256,interpro_response_bytes=p_interpro_response_bytes,pfam_entries=p_pfam_entries,pfam_response_sha256=p_pfam_response_sha256,pfam_response_bytes=p_pfam_response_bytes,annotation_summary=p_annotation_summary,connector_version=trim(p_connector_version),result_message='Evidence-backed protein annotation retrieved from live UniProt and InterPro/Pfam sources.',processing_finished_at=now(),processing_error=null,updated_at=now() where id=target.id;
  if not pgmq.delete('protein_annotation',p_message_id) then raise exception 'protein annotation queue message delete failed'; end if;
end;$$;

create or replace function public.finish_protein_annotation_success(
  message_id bigint,job_id uuid,connector_version text,mapping_candidate_count integer,mapping_response_sha256 text,mapping_response_bytes bigint,
  uniprot_accession text,uniprot_entry_id text,uniprot_reviewed boolean,uniprot_release text,uniprot_release_date text,uniprot_sequence_sha256 text,uniprot_response_sha256 text,uniprot_response_bytes bigint,
  protein_name text,gene_names jsonb,organism_name text,interpro_entries jsonb,interpro_response_sha256 text,interpro_response_bytes bigint,pfam_entries jsonb,pfam_response_sha256 text,pfam_response_bytes bigint,annotation_summary jsonb)
returns void language sql security invoker set search_path='' as $$ select app_private.finish_protein_annotation_success(message_id,job_id,connector_version,mapping_candidate_count,mapping_response_sha256,mapping_response_bytes,uniprot_accession,uniprot_entry_id,uniprot_reviewed,uniprot_release,uniprot_release_date,uniprot_sequence_sha256,uniprot_response_sha256,uniprot_response_bytes,protein_name,gene_names,organism_name,interpro_entries,interpro_response_sha256,interpro_response_bytes,pfam_entries,pfam_response_sha256,pfam_response_bytes,annotation_summary); $$;
revoke all on function app_private.finish_protein_annotation_success(bigint,uuid,text,integer,text,bigint,text,text,boolean,text,text,text,text,bigint,text,jsonb,text,jsonb,text,bigint,jsonb,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function app_private.finish_protein_annotation_success(bigint,uuid,text,integer,text,bigint,text,text,boolean,text,text,text,text,bigint,text,jsonb,text,jsonb,text,bigint,jsonb,text,bigint,jsonb) to service_role;
revoke all on function public.finish_protein_annotation_success(bigint,uuid,text,integer,text,bigint,text,text,boolean,text,text,text,text,bigint,text,jsonb,text,jsonb,text,bigint,jsonb,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.finish_protein_annotation_success(bigint,uuid,text,integer,text,bigint,text,text,boolean,text,text,text,text,bigint,text,jsonb,text,jsonb,text,bigint,jsonb,text,bigint,jsonb) to service_role;
