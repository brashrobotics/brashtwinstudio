BEGIN;

ALTER TABLE twin_upload_sessions
  ADD CONSTRAINT twin_upload_sessions_artifact_completed_check
  CHECK (artifact_sha256 IS NULL OR status = 'COMPLETED');

ALTER TABLE twin_upload_sessions
  ADD CONSTRAINT twin_upload_sessions_upload_artifact_unique
  UNIQUE (upload_id, artifact_sha256);

CREATE TABLE twin_draft_artifacts (
  binding_id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES twin_map_drafts(draft_id),
  upload_id text NOT NULL,
  artifact_sha256 char(64) NOT NULL REFERENCES twin_artifacts(sha256),
  role text NOT NULL CHECK (role IN (
    'BIM_SOURCE',
    'FLOORPLAN_SOURCE',
    'POINT_CLOUD_SOURCE',
    'TRAJECTORY_SOURCE',
    'CAMERA_SOURCE',
    'CALIBRATION_SOURCE',
    'REGISTERED_POINT_CLOUD',
    'RECONSTRUCTED_MESH',
    'OCCUPANCY',
    'ELEVATION',
    'SCENE_TILESET',
    'IMPORT_REPORT',
    'REGISTRATION_REPORT',
    'VALIDATION_REPORT'
  )),
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('SOURCE', 'DERIVED')),
  input_count integer NOT NULL CHECK (input_count >= 0 AND input_count <= 100),
  coordinate_frame_id text,
  producer_name text,
  producer_version text,
  producer_parameters_sha256 char(64),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twin_draft_artifacts_completed_upload_fk
    FOREIGN KEY (upload_id, artifact_sha256)
    REFERENCES twin_upload_sessions(upload_id, artifact_sha256),
  CONSTRAINT twin_draft_artifacts_identity_unique
    UNIQUE (draft_id, role, artifact_sha256),
  CONSTRAINT twin_draft_artifacts_draft_binding_unique
    UNIQUE (draft_id, binding_id),
  CONSTRAINT twin_draft_artifacts_binding_hash_unique
    UNIQUE (binding_id, artifact_sha256),
  CHECK (binding_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (draft_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (upload_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (
    (role IN (
      'BIM_SOURCE',
      'FLOORPLAN_SOURCE',
      'POINT_CLOUD_SOURCE',
      'TRAJECTORY_SOURCE',
      'CAMERA_SOURCE',
      'CALIBRATION_SOURCE'
    ) AND artifact_kind = 'SOURCE')
    OR
    (role NOT IN (
      'BIM_SOURCE',
      'FLOORPLAN_SOURCE',
      'POINT_CLOUD_SOURCE',
      'TRAJECTORY_SOURCE',
      'CAMERA_SOURCE',
      'CALIBRATION_SOURCE'
    ) AND artifact_kind = 'DERIVED')
  ),
  CHECK (
    (artifact_kind = 'SOURCE' AND input_count = 0)
    OR (artifact_kind = 'DERIVED' AND input_count > 0)
  ),
  CHECK (
    (artifact_kind = 'SOURCE'
      AND producer_name IS NULL
      AND producer_version IS NULL
      AND producer_parameters_sha256 IS NULL)
    OR
    (artifact_kind = 'DERIVED'
      AND producer_name IS NOT NULL
      AND length(btrim(producer_name)) > 0
      AND producer_version IS NOT NULL
      AND length(btrim(producer_version)) > 0
      AND producer_parameters_sha256 IS NOT NULL
      AND producer_parameters_sha256 ~ '^[a-f0-9]{64}$')
  ),
  CHECK (
    role NOT IN (
      'BIM_SOURCE',
      'FLOORPLAN_SOURCE',
      'POINT_CLOUD_SOURCE',
      'TRAJECTORY_SOURCE',
      'CAMERA_SOURCE',
      'REGISTERED_POINT_CLOUD',
      'RECONSTRUCTED_MESH',
      'OCCUPANCY',
      'ELEVATION',
      'SCENE_TILESET'
    )
    OR (coordinate_frame_id IS NOT NULL AND length(btrim(coordinate_frame_id)) > 0)
  )
);

CREATE TABLE twin_draft_artifact_inputs (
  draft_id text NOT NULL,
  binding_id text NOT NULL,
  input_binding_id text NOT NULL,
  input_artifact_sha256 char(64) NOT NULL,
  relation text NOT NULL DEFAULT 'DERIVED_FROM' CHECK (relation = 'DERIVED_FROM'),
  PRIMARY KEY (binding_id, input_binding_id),
  CONSTRAINT twin_draft_artifact_inputs_output_fk
    FOREIGN KEY (draft_id, binding_id)
    REFERENCES twin_draft_artifacts(draft_id, binding_id),
  CONSTRAINT twin_draft_artifact_inputs_same_draft_fk
    FOREIGN KEY (draft_id, input_binding_id)
    REFERENCES twin_draft_artifacts(draft_id, binding_id),
  CONSTRAINT twin_draft_artifact_inputs_identity_fk
    FOREIGN KEY (input_binding_id, input_artifact_sha256)
    REFERENCES twin_draft_artifacts(binding_id, artifact_sha256),
  CHECK (binding_id <> input_binding_id),
  CHECK (input_artifact_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX twin_draft_artifacts_draft_created_idx
  ON twin_draft_artifacts(draft_id, created_at, binding_id);

CREATE INDEX twin_draft_artifact_inputs_input_idx
  ON twin_draft_artifact_inputs(input_binding_id);

CREATE FUNCTION twin_require_valid_artifact_derivation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  output_kind text;
BEGIN
  SELECT artifact_kind INTO output_kind
  FROM twin_draft_artifacts
  WHERE binding_id = NEW.binding_id;

  IF output_kind <> 'DERIVED' THEN
    RAISE EXCEPTION 'Only derived artifacts may declare inputs.'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors(binding_id) AS (
      SELECT NEW.input_binding_id
      UNION
      SELECT input.input_binding_id
      FROM twin_draft_artifact_inputs input
      JOIN ancestors ON ancestors.binding_id = input.binding_id
    )
    SELECT 1 FROM ancestors WHERE binding_id = NEW.binding_id
  ) THEN
    RAISE EXCEPTION 'Draft artifact provenance cannot contain a cycle.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_draft_artifact_inputs_kind_guard
BEFORE INSERT ON twin_draft_artifact_inputs
FOR EACH ROW EXECUTE FUNCTION twin_require_valid_artifact_derivation();

CREATE FUNCTION twin_require_artifact_input_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  output_binding_id text;
  expected_input_count integer;
  actual_input_count integer;
BEGIN
  output_binding_id := NEW.binding_id;
  IF TG_TABLE_NAME = 'twin_draft_artifacts' THEN
    expected_input_count := NEW.input_count;
  ELSE
    SELECT input_count INTO expected_input_count
    FROM twin_draft_artifacts
    WHERE binding_id = output_binding_id;
  END IF;

  SELECT count(*)::integer INTO actual_input_count
  FROM twin_draft_artifact_inputs
  WHERE binding_id = output_binding_id;

  IF actual_input_count <> expected_input_count THEN
    RAISE EXCEPTION 'Draft artifact input set does not match its sealed input count.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER twin_draft_artifacts_inputs_required
AFTER INSERT ON twin_draft_artifacts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION twin_require_artifact_input_count();

CREATE CONSTRAINT TRIGGER twin_draft_artifact_inputs_count_guard
AFTER INSERT ON twin_draft_artifact_inputs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION twin_require_artifact_input_count();

CREATE FUNCTION twin_reject_artifact_provenance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Draft artifact provenance is append-only.'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER twin_draft_artifacts_immutable
BEFORE UPDATE OR DELETE ON twin_draft_artifacts
FOR EACH ROW EXECUTE FUNCTION twin_reject_artifact_provenance_mutation();

CREATE TRIGGER twin_draft_artifact_inputs_immutable
BEFORE UPDATE OR DELETE ON twin_draft_artifact_inputs
FOR EACH ROW EXECUTE FUNCTION twin_reject_artifact_provenance_mutation();

COMMIT;
