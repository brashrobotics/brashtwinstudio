BEGIN;

CREATE TABLE twin_publication_requests (
  publication_id text PRIMARY KEY,
  draft_id text NOT NULL UNIQUE REFERENCES twin_map_drafts(draft_id),
  draft_row_version bigint NOT NULL CHECK (draft_row_version > 0),
  validation_report_sha256 char(64) NOT NULL REFERENCES twin_artifacts(sha256),
  release_id text NOT NULL UNIQUE,
  bundle_id text NOT NULL UNIQUE CHECK (length(btrim(bundle_id)) > 0),
  manifest_sha256 char(64) NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  bundle_artifacts jsonb NOT NULL CHECK (
    jsonb_typeof(bundle_artifacts) = 'array' AND jsonb_array_length(bundle_artifacts) > 0
  ),
  status text NOT NULL CHECK (status IN (
    'PENDING_APPROVAL', 'APPROVED', 'PUBLISHING', 'STORE_PUBLISHED', 'COMPLETED'
  )),
  requested_by text NOT NULL CHECK (length(btrim(requested_by)) > 0),
  requested_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  store_published_at timestamptz,
  completed_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL,
  CHECK (publication_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CHECK (release_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9][0-9]*$'),
  CHECK (validation_report_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK (status IN ('PUBLISHING', 'STORE_PUBLISHED') OR lease_owner IS NULL),
  CHECK (status IN ('STORE_PUBLISHED', 'COMPLETED') OR store_published_at IS NULL),
  CHECK (status = 'COMPLETED' OR completed_at IS NULL)
);

CREATE TABLE twin_publication_approvals (
  publication_id text PRIMARY KEY REFERENCES twin_publication_requests(publication_id),
  approved_by text NOT NULL CHECK (length(btrim(approved_by)) > 0),
  approved_at timestamptz NOT NULL
);

CREATE INDEX twin_publication_recovery_idx
  ON twin_publication_requests(status, next_attempt_at, lease_expires_at)
  WHERE status IN ('APPROVED', 'PUBLISHING', 'STORE_PUBLISHED');

CREATE FUNCTION twin_require_distinct_publication_approver()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  requester text;
BEGIN
  SELECT requested_by INTO requester
  FROM twin_publication_requests
  WHERE publication_id = NEW.publication_id;

  IF requester IS NULL OR requester = NEW.approved_by THEN
    RAISE EXCEPTION 'Publication approval requires a second person.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_publication_two_person_guard
BEFORE INSERT ON twin_publication_approvals
FOR EACH ROW EXECUTE FUNCTION twin_require_distinct_publication_approver();

CREATE FUNCTION twin_guard_publication_request_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'Completed publication requests are immutable.' USING ERRCODE = '55000';
  END IF;
  IF OLD.publication_id IS DISTINCT FROM NEW.publication_id
    OR OLD.draft_id IS DISTINCT FROM NEW.draft_id
    OR OLD.draft_row_version IS DISTINCT FROM NEW.draft_row_version
    OR OLD.validation_report_sha256 IS DISTINCT FROM NEW.validation_report_sha256
    OR OLD.release_id IS DISTINCT FROM NEW.release_id
    OR OLD.bundle_id IS DISTINCT FROM NEW.bundle_id
    OR OLD.manifest_sha256 IS DISTINCT FROM NEW.manifest_sha256
    OR OLD.bundle_artifacts IS DISTINCT FROM NEW.bundle_artifacts
    OR OLD.requested_by IS DISTINCT FROM NEW.requested_by
    OR OLD.requested_at IS DISTINCT FROM NEW.requested_at THEN
    RAISE EXCEPTION 'Publication request identity is immutable.' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'PENDING_APPROVAL' AND NEW.status = 'APPROVED')
    OR (OLD.status = 'APPROVED' AND NEW.status = 'PUBLISHING')
    OR (OLD.status = 'PUBLISHING' AND NEW.status IN ('PUBLISHING', 'STORE_PUBLISHED'))
    OR (OLD.status = 'STORE_PUBLISHED' AND NEW.status IN ('STORE_PUBLISHED', 'COMPLETED'))
  ) THEN
    RAISE EXCEPTION 'Invalid publication state transition % -> %.', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'PENDING_APPROVAL' AND NOT EXISTS (
    SELECT 1 FROM twin_publication_approvals
    WHERE publication_id = NEW.publication_id
  ) THEN
    RAISE EXCEPTION 'Publication approval evidence is missing.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_publication_request_update_guard
BEFORE UPDATE ON twin_publication_requests
FOR EACH ROW EXECUTE FUNCTION twin_guard_publication_request_update();

CREATE FUNCTION twin_reject_publication_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Publication audit records are append-only.' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER twin_publication_requests_no_delete
BEFORE DELETE ON twin_publication_requests
FOR EACH ROW EXECUTE FUNCTION twin_reject_publication_delete();

CREATE TRIGGER twin_publication_approvals_immutable
BEFORE UPDATE OR DELETE ON twin_publication_approvals
FOR EACH ROW EXECUTE FUNCTION twin_reject_publication_delete();

COMMIT;
