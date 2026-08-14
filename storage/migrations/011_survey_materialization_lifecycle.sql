BEGIN;

DROP TRIGGER twin_survey_materialization_immutable
  ON twin_survey_materialization_jobs;
DROP FUNCTION twin_reject_survey_materialization_mutation();

ALTER TABLE twin_survey_materialization_jobs
  DROP CONSTRAINT IF EXISTS twin_survey_materialization_jobs_status_check,
  DROP CONSTRAINT IF EXISTS twin_survey_materialization_jobs_row_version_check,
  ADD COLUMN output jsonb,
  ADD COLUMN output_upload_id text,
  ADD COLUMN output_artifact_sha256 char(64),
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN maximum_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN failure_reason text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT twin_survey_materialization_jobs_status_check
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  ADD CONSTRAINT twin_survey_materialization_jobs_row_version_check
    CHECK (row_version > 0),
  ADD CONSTRAINT twin_survey_materialization_jobs_attempts_check
    CHECK (attempt_count >= 0 AND maximum_attempts BETWEEN 1 AND 10
      AND attempt_count <= maximum_attempts),
  ADD CONSTRAINT twin_survey_materialization_jobs_output_hash_check
    CHECK (output_artifact_sha256 IS NULL
      OR output_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT twin_survey_materialization_jobs_lifecycle_check
    CHECK (
      (status = 'PENDING'
        AND attempt_count < maximum_attempts
        AND output IS NULL
        AND output_upload_id IS NULL
        AND output_artifact_sha256 IS NULL
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND completed_at IS NULL)
      OR
      (status = 'RUNNING'
        AND attempt_count BETWEEN 1 AND maximum_attempts
        AND output IS NULL
        AND output_upload_id IS NULL
        AND output_artifact_sha256 IS NULL
        AND lease_owner IS NOT NULL
        AND length(btrim(lease_owner)) > 0
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at > started_at
        AND started_at IS NOT NULL
        AND completed_at IS NULL)
      OR
      (status = 'SUCCEEDED'
        AND attempt_count BETWEEN 1 AND maximum_attempts
        AND output IS NOT NULL
        AND jsonb_typeof(output) = 'object'
        AND output_upload_id IS NOT NULL
        AND output_artifact_sha256 IS NOT NULL
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND completed_at >= started_at
        AND failure_reason IS NULL)
      OR
      (status = 'FAILED'
        AND attempt_count = maximum_attempts
        AND output IS NULL
        AND output_upload_id IS NULL
        AND output_artifact_sha256 IS NULL
        AND lease_owner IS NULL
        AND lease_expires_at IS NULL
        AND started_at IS NOT NULL
        AND completed_at IS NOT NULL
        AND completed_at >= started_at
        AND failure_reason IS NOT NULL
        AND length(btrim(failure_reason)) > 0)
    );

ALTER TABLE twin_survey_materialization_jobs
  ADD CONSTRAINT twin_survey_materialization_jobs_output_identity_check
  CHECK (status <> 'SUCCEEDED' OR (
    output ? 'schemaVersion'
    AND output ? 'mediaType'
    AND output ? 'previewUploadId'
    AND output ? 'previewSha256'
    AND output->>'schemaVersion' = 'brash.survey-materialization-preview/v1'
    AND output->>'mediaType' = 'application/vnd.brash.survey-materialization-preview+json'
    AND output->>'previewUploadId' = output_upload_id
    AND output->>'previewSha256' = output_artifact_sha256
  ));

ALTER TABLE twin_survey_materialization_jobs
  ADD CONSTRAINT twin_survey_materialization_output_upload_fk
  FOREIGN KEY (output_upload_id, output_artifact_sha256)
  REFERENCES twin_upload_sessions(upload_id, artifact_sha256);

CREATE INDEX twin_survey_materialization_jobs_claim_idx
  ON twin_survey_materialization_jobs(status, next_attempt_at, lease_expires_at, created_at)
  WHERE status IN ('PENDING', 'RUNNING');

CREATE FUNCTION twin_guard_survey_materialization_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Survey materialization jobs cannot be deleted.' USING ERRCODE = '55000';
  END IF;

  IF NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.intake_id IS DISTINCT FROM OLD.intake_id
    OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
    OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
    OR NEW.snapshot_sha256 IS DISTINCT FROM OLD.snapshot_sha256
    OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.maximum_attempts IS DISTINCT FROM OLD.maximum_attempts THEN
    RAISE EXCEPTION 'Survey materialization input identity is immutable.' USING ERRCODE = '55000';
  END IF;

  IF NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION 'Survey materialization row version must advance by one.' USING ERRCODE = '40001';
  END IF;

  IF NOT (
    (OLD.status = 'PENDING' AND NEW.status = 'RUNNING'
      AND NEW.attempt_count = OLD.attempt_count + 1)
    OR
    (OLD.status = 'RUNNING' AND NEW.status = 'RUNNING'
      AND OLD.lease_expires_at <= NEW.started_at
      AND NEW.attempt_count = OLD.attempt_count + 1)
    OR
    (OLD.status = 'RUNNING' AND NEW.status IN ('PENDING', 'SUCCEEDED', 'FAILED')
      AND NEW.attempt_count = OLD.attempt_count)
  ) THEN
    RAISE EXCEPTION 'Invalid survey materialization lifecycle transition.' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_survey_materialization_lifecycle_guard
BEFORE UPDATE OR DELETE ON twin_survey_materialization_jobs
FOR EACH ROW EXECUTE FUNCTION twin_guard_survey_materialization_lifecycle();

COMMIT;
