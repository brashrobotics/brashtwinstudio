BEGIN;

ALTER TABLE twin_draft_artifacts
  DROP CONSTRAINT twin_draft_artifacts_role_check,
  DROP CONSTRAINT twin_draft_artifacts_input_count_check,
  DROP CONSTRAINT twin_draft_artifacts_check,
  DROP CONSTRAINT twin_draft_artifacts_check1,
  DROP CONSTRAINT twin_draft_artifacts_check3;

ALTER TABLE twin_draft_artifacts
  ADD CONSTRAINT twin_draft_artifacts_role_check CHECK (role IN (
    'BIM_SOURCE', 'FLOORPLAN_SOURCE', 'POINT_CLOUD_SOURCE',
    'TRAJECTORY_SOURCE', 'CAMERA_SOURCE', 'CALIBRATION_SOURCE',
    'SURVEY_SOURCE', 'SURVEY_PREVIEW', 'REGISTERED_POINT_CLOUD',
    'RECONSTRUCTED_MESH', 'OCCUPANCY', 'ELEVATION', 'SCENE_TILESET',
    'IMPORT_REPORT', 'REGISTRATION_REPORT', 'VALIDATION_REPORT'
  )),
  ADD CONSTRAINT twin_draft_artifacts_input_count_check
    CHECK (input_count >= 0 AND input_count <= 256),
  ADD CONSTRAINT twin_draft_artifacts_kind_role_check CHECK (
    (role IN (
      'BIM_SOURCE', 'FLOORPLAN_SOURCE', 'POINT_CLOUD_SOURCE',
      'TRAJECTORY_SOURCE', 'CAMERA_SOURCE', 'CALIBRATION_SOURCE',
      'SURVEY_SOURCE'
    ) AND artifact_kind = 'SOURCE')
    OR
    (role NOT IN (
      'BIM_SOURCE', 'FLOORPLAN_SOURCE', 'POINT_CLOUD_SOURCE',
      'TRAJECTORY_SOURCE', 'CAMERA_SOURCE', 'CALIBRATION_SOURCE',
      'SURVEY_SOURCE'
    ) AND artifact_kind = 'DERIVED')
  ),
  ADD CONSTRAINT twin_draft_artifacts_inputs_check CHECK (
    (artifact_kind = 'SOURCE' AND input_count = 0)
    OR (artifact_kind = 'DERIVED' AND input_count > 0)
  ),
  ADD CONSTRAINT twin_draft_artifacts_spatial_frame_check CHECK (
    role NOT IN (
      'BIM_SOURCE', 'FLOORPLAN_SOURCE', 'POINT_CLOUD_SOURCE',
      'TRAJECTORY_SOURCE', 'CAMERA_SOURCE', 'SURVEY_PREVIEW',
      'REGISTERED_POINT_CLOUD', 'RECONSTRUCTED_MESH', 'OCCUPANCY',
      'ELEVATION', 'SCENE_TILESET'
    )
    OR (coordinate_frame_id IS NOT NULL AND length(btrim(coordinate_frame_id)) > 0)
  );

COMMIT;
