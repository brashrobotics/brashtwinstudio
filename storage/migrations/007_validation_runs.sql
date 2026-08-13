BEGIN;

CREATE TABLE twin_validation_runs (
  job_id text PRIMARY KEY REFERENCES twin_processing_jobs(job_id),
  draft_id text NOT NULL,
  report_binding_id text NOT NULL,
  report_sha256 char(64) NOT NULL REFERENCES twin_artifacts(sha256),
  outcome text NOT NULL CHECK (outcome IN ('PASSED', 'FAILED')),
  validator_name text NOT NULL CHECK (length(btrim(validator_name)) > 0),
  validator_version text NOT NULL CHECK (length(btrim(validator_version)) > 0),
  configuration_sha256 char(64) NOT NULL CHECK (configuration_sha256 ~ '^[a-f0-9]{64}$'),
  error_count integer NOT NULL CHECK (error_count >= 0),
  warning_count integer NOT NULL CHECK (warning_count >= 0),
  info_count integer NOT NULL CHECK (info_count >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK (completed_at >= started_at),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  CONSTRAINT twin_validation_runs_draft_binding_fk
    FOREIGN KEY (draft_id, report_binding_id)
    REFERENCES twin_draft_artifacts(draft_id, binding_id),
  CONSTRAINT twin_validation_runs_report_identity_fk
    FOREIGN KEY (report_binding_id, report_sha256)
    REFERENCES twin_draft_artifacts(binding_id, artifact_sha256),
  CHECK (job_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (draft_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (report_binding_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (report_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK ((outcome = 'PASSED' AND error_count = 0) OR outcome = 'FAILED')
);

CREATE INDEX twin_validation_runs_draft_completed_idx
  ON twin_validation_runs(draft_id, completed_at DESC);

CREATE FUNCTION twin_require_valid_validation_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  artifact_role text;
  job_record twin_processing_jobs%ROWTYPE;
BEGIN
  SELECT role INTO artifact_role
  FROM twin_draft_artifacts
  WHERE binding_id = NEW.report_binding_id;

  SELECT * INTO job_record
  FROM twin_processing_jobs
  WHERE job_id = NEW.job_id;

  IF artifact_role <> 'VALIDATION_REPORT' THEN
    RAISE EXCEPTION 'Validation runs must reference a VALIDATION_REPORT artifact.'
      USING ERRCODE = '23514';
  END IF;
  IF job_record.job_type <> 'RELEASE_VALIDATION'
    OR job_record.status <> 'SUCCEEDED'
    OR job_record.draft_id <> NEW.draft_id THEN
    RAISE EXCEPTION 'Validation run job metadata is inconsistent.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_validation_runs_consistency_guard
BEFORE INSERT ON twin_validation_runs
FOR EACH ROW EXECUTE FUNCTION twin_require_valid_validation_run();

CREATE FUNCTION twin_reject_validation_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Validation run records are immutable.'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER twin_validation_runs_immutable
BEFORE UPDATE OR DELETE ON twin_validation_runs
FOR EACH ROW EXECUTE FUNCTION twin_reject_validation_run_mutation();

COMMIT;
