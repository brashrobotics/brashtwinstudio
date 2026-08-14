BEGIN;

CREATE TABLE twin_survey_intakes (
  intake_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'REJECTED')),
  draft_id text NOT NULL REFERENCES twin_map_drafts(draft_id),
  manifest_upload_id text NOT NULL,
  manifest_artifact_sha256 char(64) NOT NULL,
  artifact_count integer NOT NULL CHECK (artifact_count >= 1 AND artifact_count <= 256),
  manifest_schema_version text,
  manifest_sha256 char(64),
  package_id text,
  survey_id text,
  source_site_id text,
  source_floor_id text,
  report jsonb,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_by text,
  verified_at timestamptz,
  CONSTRAINT twin_survey_intakes_manifest_upload_fk
    FOREIGN KEY (manifest_upload_id, manifest_artifact_sha256)
    REFERENCES twin_upload_sessions(upload_id, artifact_sha256),
  CHECK (intake_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (draft_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (manifest_upload_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (manifest_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (
    (status = 'OPEN'
      AND manifest_schema_version IS NULL
      AND manifest_sha256 IS NULL
      AND package_id IS NULL
      AND survey_id IS NULL
      AND source_site_id IS NULL
      AND source_floor_id IS NULL
      AND report IS NULL
      AND verified_by IS NULL
      AND verified_at IS NULL
      AND row_version = 1)
    OR
    (status IN ('ACCEPTED', 'REJECTED')
      AND manifest_sha256 IS NOT NULL
      AND report IS NOT NULL
      AND jsonb_typeof(report) = 'object'
      AND verified_by IS NOT NULL
      AND length(btrim(verified_by)) > 0
      AND verified_at IS NOT NULL
      AND row_version = 2)
  ),
  CHECK (
    status <> 'ACCEPTED'
    OR (
      manifest_schema_version = 'brash.embodied-survey-package/v1'
      AND package_id IS NOT NULL
      AND survey_id IS NOT NULL
      AND source_site_id IS NOT NULL
      AND source_floor_id IS NOT NULL
      AND report->>'outcome' IN ('ACCEPTED', 'ACCEPTED_WITH_WARNINGS')
    )
  ),
  CHECK (status <> 'REJECTED' OR report->>'outcome' = 'REJECTED')
);

CREATE TABLE twin_survey_intake_artifacts (
  intake_id text NOT NULL REFERENCES twin_survey_intakes(intake_id),
  artifact_id text NOT NULL CHECK (
    length(btrim(artifact_id)) > 0
    AND length(artifact_id) <= 1024
    AND artifact_id !~ '[[:cntrl:]]'
  ),
  upload_id text NOT NULL,
  artifact_sha256 char(64) NOT NULL,
  bytes bigint NOT NULL CHECK (bytes > 0),
  media_type text NOT NULL CHECK (length(btrim(media_type)) > 0 AND length(media_type) <= 255),
  PRIMARY KEY (intake_id, artifact_id),
  UNIQUE (intake_id, upload_id),
  CONSTRAINT twin_survey_intake_artifacts_completed_upload_fk
    FOREIGN KEY (upload_id, artifact_sha256)
    REFERENCES twin_upload_sessions(upload_id, artifact_sha256),
  CHECK (upload_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX twin_survey_intakes_draft_created_idx
  ON twin_survey_intakes(draft_id, created_at, intake_id);

CREATE FUNCTION twin_require_editable_survey_intake_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  draft_status text;
BEGIN
  SELECT status INTO draft_status
  FROM twin_map_drafts
  WHERE draft_id = NEW.draft_id
  FOR UPDATE;
  IF draft_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Survey intake requires an editable DRAFT.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_survey_intakes_editable_draft_guard
BEFORE INSERT OR UPDATE ON twin_survey_intakes
FOR EACH ROW EXECUTE FUNCTION twin_require_editable_survey_intake_draft();

CREATE FUNCTION twin_require_survey_intake_artifact_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_intake_id text;
  expected_count integer;
  actual_count integer;
BEGIN
  target_intake_id := NEW.intake_id;
  SELECT artifact_count INTO expected_count
  FROM twin_survey_intakes
  WHERE intake_id = target_intake_id;

  SELECT count(*)::integer INTO actual_count
  FROM twin_survey_intake_artifacts
  WHERE intake_id = target_intake_id;

  IF actual_count <> expected_count THEN
    RAISE EXCEPTION 'Survey intake artifact mapping set does not match its sealed count.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER twin_survey_intakes_artifacts_required
AFTER INSERT ON twin_survey_intakes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION twin_require_survey_intake_artifact_count();

CREATE CONSTRAINT TRIGGER twin_survey_intake_artifacts_count_guard
AFTER INSERT ON twin_survey_intake_artifacts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION twin_require_survey_intake_artifact_count();

CREATE FUNCTION twin_guard_survey_intake_terminal_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Survey intake evidence is append-only.' USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'OPEN'
    OR NEW.status NOT IN ('ACCEPTED', 'REJECTED')
    OR NEW.row_version <> OLD.row_version + 1
    OR NEW.intake_id IS DISTINCT FROM OLD.intake_id
    OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
    OR NEW.manifest_upload_id IS DISTINCT FROM OLD.manifest_upload_id
    OR NEW.manifest_artifact_sha256 IS DISTINCT FROM OLD.manifest_artifact_sha256
    OR NEW.artifact_count IS DISTINCT FROM OLD.artifact_count
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Survey intake permits one OPEN to terminal verification transition.'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_survey_intakes_terminal_guard
BEFORE UPDATE OR DELETE ON twin_survey_intakes
FOR EACH ROW EXECUTE FUNCTION twin_guard_survey_intake_terminal_transition();

CREATE FUNCTION twin_reject_survey_intake_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Survey intake upload mappings are immutable.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER twin_survey_intake_artifacts_immutable
BEFORE UPDATE OR DELETE ON twin_survey_intake_artifacts
FOR EACH ROW EXECUTE FUNCTION twin_reject_survey_intake_artifact_mutation();

COMMIT;
