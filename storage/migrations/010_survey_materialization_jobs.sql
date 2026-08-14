BEGIN;

ALTER TABLE twin_survey_intakes
  ADD CONSTRAINT twin_survey_intakes_manifest_identity_unique
  UNIQUE (intake_id, manifest_sha256);

CREATE TABLE twin_survey_materialization_jobs (
  job_id text PRIMARY KEY,
  intake_id text NOT NULL UNIQUE,
  draft_id text NOT NULL REFERENCES twin_map_drafts(draft_id),
  status text NOT NULL CHECK (status = 'PENDING'),
  manifest_sha256 char(64) NOT NULL,
  snapshot_sha256 char(64) NOT NULL,
  snapshot jsonb NOT NULL,
  row_version bigint NOT NULL CHECK (row_version = 1),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twin_survey_materialization_intake_manifest_fk
    FOREIGN KEY (intake_id, manifest_sha256)
    REFERENCES twin_survey_intakes(intake_id, manifest_sha256),
  CHECK (job_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (intake_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (draft_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (jsonb_typeof(snapshot) = 'object'),
  CHECK (snapshot->>'schemaVersion' = 'brash.survey-materialization-snapshot/v1'),
  CHECK (snapshot->>'intakeId' = intake_id),
  CHECK (snapshot->>'draftId' = draft_id),
  CHECK (snapshot->>'manifestSha256' = manifest_sha256),
  CHECK (jsonb_typeof(snapshot->'artifacts') = 'array'),
  CHECK (jsonb_array_length(snapshot->'artifacts') BETWEEN 1 AND 256)
);

CREATE INDEX twin_survey_materialization_jobs_draft_created_idx
  ON twin_survey_materialization_jobs(draft_id, created_at, job_id);

CREATE FUNCTION twin_require_accepted_materialization_intake()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  intake_status text;
  intake_draft_id text;
  draft_status text;
BEGIN
  SELECT status, draft_id INTO intake_status, intake_draft_id
  FROM twin_survey_intakes
  WHERE intake_id = NEW.intake_id
  FOR SHARE;

  IF intake_status <> 'ACCEPTED' OR intake_draft_id IS DISTINCT FROM NEW.draft_id THEN
    RAISE EXCEPTION 'Survey materialization requires an accepted intake from the same draft.'
      USING ERRCODE = '23514';
  END IF;

  SELECT status INTO draft_status
  FROM twin_map_drafts
  WHERE draft_id = NEW.draft_id
  FOR UPDATE;

  IF draft_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Survey materialization requires an editable DRAFT.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_survey_materialization_accepted_intake_guard
BEFORE INSERT ON twin_survey_materialization_jobs
FOR EACH ROW EXECUTE FUNCTION twin_require_accepted_materialization_intake();

CREATE FUNCTION twin_reject_survey_materialization_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Survey materialization snapshots are append-only.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER twin_survey_materialization_immutable
BEFORE UPDATE OR DELETE ON twin_survey_materialization_jobs
FOR EACH ROW EXECUTE FUNCTION twin_reject_survey_materialization_mutation();

COMMIT;
