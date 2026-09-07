alter table public.sequence_uploads
  add column validator_version text,
  add column validation_warnings jsonb not null default '[]'::jsonb,
  add column validated_at timestamptz,
  add constraint sequence_uploads_validator_version_length check (validator_version is null or char_length(validator_version) between 1 and 80),
  add constraint sequence_uploads_validation_warnings_array check (jsonb_typeof(validation_warnings) = 'array'),
  add constraint sequence_uploads_validation_state_consistency check (
    (status in ('pending_validation','validating') and validated_at is null)
    or
    (status in ('ready','rejected') and validated_at is not null and validator_version is not null)
  ),
  add constraint sequence_uploads_rejected_has_error check (status <> 'rejected' or validation_error is not null),
  add constraint sequence_uploads_ready_has_no_error check (status <> 'ready' or validation_error is null);
