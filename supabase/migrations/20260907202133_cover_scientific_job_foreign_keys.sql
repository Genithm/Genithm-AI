create index scientific_jobs_project_org_fk_idx on public.scientific_jobs(project_id, organization_id);
create index scientific_jobs_tool_fk_idx on public.scientific_jobs(tool_id, tool_version);
create index scientific_job_inputs_job_project_org_fk_idx on public.scientific_job_inputs(job_id, project_id, organization_id);
create index scientific_job_inputs_upload_project_org_fk_idx on public.scientific_job_inputs(sequence_upload_id, project_id, organization_id);
