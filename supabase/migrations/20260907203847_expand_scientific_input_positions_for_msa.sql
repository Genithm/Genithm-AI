alter table public.scientific_job_inputs drop constraint scientific_job_inputs_position;
alter table public.scientific_job_inputs
  add constraint scientific_job_inputs_position
  check (input_position between 1 and 50);
