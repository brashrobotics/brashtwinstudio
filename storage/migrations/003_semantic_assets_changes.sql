BEGIN;

CREATE TABLE twin_coordinate_frame_sets (
  frame_set_id text PRIMARY KEY,
  draft_id text REFERENCES twin_map_drafts(draft_id),
  release_id text REFERENCES twin_map_releases(release_id),
  canonical_frame_id text NOT NULL,
  artifact_sha256 char(64) NOT NULL REFERENCES twin_artifacts(sha256),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((draft_id IS NOT NULL)::integer + (release_id IS NOT NULL)::integer = 1)
);

CREATE TABLE twin_asset_revisions (
  asset_revision_id text PRIMARY KEY,
  asset_id text NOT NULL,
  draft_id text REFERENCES twin_map_drafts(draft_id),
  release_id text REFERENCES twin_map_releases(release_id),
  display_name text NOT NULL,
  semantic_class text NOT NULL,
  mobility_class text NOT NULL CHECK (mobility_class IN ('STATIC', 'SEMI_STATIC', 'MOBILE')),
  frame_id text NOT NULL,
  pose jsonb NOT NULL,
  footprint jsonb NOT NULL,
  bounds_3d jsonb NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  topology_bindings jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_policy jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((draft_id IS NOT NULL)::integer + (release_id IS NOT NULL)::integer = 1)
);

CREATE UNIQUE INDEX twin_asset_draft_identity_idx
  ON twin_asset_revisions(draft_id, asset_id) WHERE draft_id IS NOT NULL;
CREATE UNIQUE INDEX twin_asset_release_identity_idx
  ON twin_asset_revisions(release_id, asset_id) WHERE release_id IS NOT NULL;

CREATE TABLE twin_semantic_observations (
  observation_id text PRIMARY KEY,
  survey_id text NOT NULL REFERENCES twin_survey_sessions(survey_id),
  suggested_class text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  frame_id text NOT NULL,
  pose jsonb NOT NULL,
  bounds_3d jsonb NOT NULL,
  footprint jsonb,
  evidence jsonb NOT NULL,
  model_name text NOT NULL,
  model_version text NOT NULL,
  dataset_version text,
  review_status text NOT NULL CHECK (review_status IN ('REVIEW_REQUIRED', 'ACCEPTED', 'REJECTED', 'MERGED')),
  matched_asset_id text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE TABLE twin_change_candidates (
  change_id text PRIMARY KEY,
  baseline_release_id text NOT NULL REFERENCES twin_map_releases(release_id),
  survey_id text NOT NULL REFERENCES twin_survey_sessions(survey_id),
  asset_id text,
  change_type text NOT NULL CHECK (change_type IN ('MOVED', 'MISSING', 'APPEARED', 'GEOMETRY_CHANGED', 'BLOCKED')),
  status text NOT NULL CHECK (status IN ('SUSPECTED', 'CONFIRMED', 'DISMISSED', 'APPLIED_TO_DRAFT')),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  confirmation_count integer NOT NULL DEFAULT 1 CHECK (confirmation_count > 0),
  delta jsonb NOT NULL,
  evidence jsonb NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  target_draft_id text REFERENCES twin_map_drafts(draft_id),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL)),
  CHECK (status <> 'APPLIED_TO_DRAFT' OR target_draft_id IS NOT NULL)
);

CREATE TABLE twin_review_decisions (
  decision_id text PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('SEMANTIC_OBSERVATION', 'CHANGE_CANDIDATE', 'MAP_DRAFT')),
  subject_id text NOT NULL,
  decision text NOT NULL,
  note text,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id text
);

CREATE INDEX twin_observations_survey_review_idx
  ON twin_semantic_observations(survey_id, review_status);
CREATE INDEX twin_observations_asset_idx
  ON twin_semantic_observations(matched_asset_id) WHERE matched_asset_id IS NOT NULL;
CREATE INDEX twin_changes_release_status_idx
  ON twin_change_candidates(baseline_release_id, status);
CREATE INDEX twin_changes_asset_idx
  ON twin_change_candidates(asset_id) WHERE asset_id IS NOT NULL;

CREATE TRIGGER twin_release_asset_revisions_immutable
BEFORE UPDATE OR DELETE ON twin_asset_revisions
FOR EACH ROW
WHEN (OLD.release_id IS NOT NULL)
EXECUTE FUNCTION reject_twin_release_mutation();

COMMIT;
