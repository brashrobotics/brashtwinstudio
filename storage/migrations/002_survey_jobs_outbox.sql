BEGIN;

CREATE TABLE twin_survey_sessions (
  survey_id text PRIMARY KEY,
  floor_id text NOT NULL REFERENCES twin_floors(floor_id),
  robot_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('CREATED', 'RECORDING', 'UPLOADING', 'READY', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  sensor_profile jsonb NOT NULL,
  clock_synchronized boolean NOT NULL DEFAULT false,
  maximum_clock_offset_ms double precision CHECK (maximum_clock_offset_ms IS NULL OR maximum_clock_offset_ms >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  failure_reason text,
  CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE twin_survey_recordings (
  survey_id text NOT NULL REFERENCES twin_survey_sessions(survey_id),
  recording_id text NOT NULL,
  sensor_id text NOT NULL,
  artifact_sha256 char(64) NOT NULL REFERENCES twin_artifacts(sha256),
  frame_id text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (survey_id, recording_id),
  CHECK (completed_at >= started_at)
);

CREATE TABLE twin_processing_jobs (
  job_id text PRIMARY KEY,
  survey_id text REFERENCES twin_survey_sessions(survey_id),
  draft_id text REFERENCES twin_map_drafts(draft_id),
  job_type text NOT NULL CHECK (job_type IN (
    'SURVEY_INGEST',
    'SLAM_RECONSTRUCTION',
    'CAD_SCAN_REGISTRATION',
    'SEMANTIC_INFERENCE',
    'TOPOLOGY_DERIVATION',
    'SCENE_OPTIMIZATION',
    'RELEASE_VALIDATION',
    'BUNDLE_PACKAGING'
  )),
  status text NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  maximum_attempts integer NOT NULL DEFAULT 3 CHECK (maximum_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  CHECK (survey_id IS NOT NULL OR draft_id IS NOT NULL),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);

CREATE TABLE twin_job_dependencies (
  job_id text NOT NULL REFERENCES twin_processing_jobs(job_id),
  depends_on_job_id text NOT NULL REFERENCES twin_processing_jobs(job_id),
  PRIMARY KEY (job_id, depends_on_job_id),
  CHECK (job_id <> depends_on_job_id)
);

CREATE TABLE twin_job_events (
  event_id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES twin_processing_jobs(job_id),
  event_type text NOT NULL,
  message text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE twin_outbox_events (
  event_id text PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  last_error text
);

CREATE INDEX twin_survey_sessions_floor_status_idx ON twin_survey_sessions(floor_id, status);
CREATE INDEX twin_processing_jobs_claim_idx ON twin_processing_jobs(status, next_attempt_at)
  WHERE status IN ('PENDING', 'RETRY_WAIT');
CREATE INDEX twin_processing_jobs_lease_idx ON twin_processing_jobs(lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;
CREATE INDEX twin_job_events_job_time_idx ON twin_job_events(job_id, occurred_at);
CREATE INDEX twin_outbox_pending_idx ON twin_outbox_events(available_at)
  WHERE delivered_at IS NULL;

COMMIT;
