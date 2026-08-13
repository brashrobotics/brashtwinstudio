BEGIN;

CREATE TABLE twin_upload_sessions (
  upload_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN (
    'INITIATED', 'UPLOADING', 'COMPLETED', 'QUARANTINED', 'CANCELLED', 'EXPIRED'
  )),
  expected_sha256 char(64) NOT NULL CHECK (expected_sha256 ~ '^[a-f0-9]{64}$'),
  expected_bytes bigint NOT NULL CHECK (expected_bytes > 0),
  observed_sha256 char(64) CHECK (observed_sha256 IS NULL OR observed_sha256 ~ '^[a-f0-9]{64}$'),
  observed_bytes bigint CHECK (observed_bytes IS NULL OR observed_bytes >= 0),
  artifact_sha256 char(64) REFERENCES twin_artifacts(sha256),
  media_type text NOT NULL CHECK (length(btrim(media_type)) > 0),
  original_name text NOT NULL CHECK (length(btrim(original_name)) > 0),
  part_size_bytes bigint NOT NULL CHECK (part_size_bytes > 0),
  maximum_parts integer NOT NULL CHECK (maximum_parts > 0 AND maximum_parts <= 10000),
  storage_provider text NOT NULL CHECK (length(btrim(storage_provider)) > 0),
  upload_key text NOT NULL CHECK (length(btrim(upload_key)) > 0),
  quarantine_reason text,
  expires_at timestamptz NOT NULL,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (upload_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (expires_at > created_at),
  CHECK (expected_bytes <= part_size_bytes * maximum_parts),
  CHECK (status <> 'COMPLETED' OR (
    artifact_sha256 = expected_sha256
    AND observed_sha256 = expected_sha256
    AND observed_bytes = expected_bytes
    AND quarantine_reason IS NULL
    AND completed_at IS NOT NULL
  )),
  CHECK (status <> 'QUARANTINED' OR (
    artifact_sha256 IS NULL
    AND observed_sha256 IS NOT NULL
    AND observed_bytes IS NOT NULL
    AND quarantine_reason IS NOT NULL
    AND completed_at IS NOT NULL
  )),
  CHECK (status NOT IN ('CANCELLED', 'EXPIRED') OR completed_at IS NOT NULL),
  CHECK (status IN ('COMPLETED', 'QUARANTINED', 'CANCELLED', 'EXPIRED') OR completed_at IS NULL)
);

CREATE INDEX twin_upload_sessions_claim_idx
  ON twin_upload_sessions(status, expires_at)
  WHERE status IN ('INITIATED', 'UPLOADING');

CREATE INDEX twin_upload_sessions_artifact_idx
  ON twin_upload_sessions(artifact_sha256)
  WHERE artifact_sha256 IS NOT NULL;

COMMIT;
