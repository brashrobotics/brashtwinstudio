BEGIN;

CREATE TABLE twin_sites (
  site_id text PRIMARY KEY,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  timezone text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (site_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE twin_buildings (
  site_id text NOT NULL REFERENCES twin_sites(site_id),
  building_id text NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, building_id),
  CHECK (building_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE twin_floors (
  floor_id text PRIMARY KEY,
  site_id text NOT NULL,
  building_id text NOT NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  elevation_meters double precision NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (site_id, building_id) REFERENCES twin_buildings(site_id, building_id),
  UNIQUE (site_id, building_id, display_name),
  CHECK (floor_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE twin_map_families (
  family_id text PRIMARY KEY,
  floor_id text NOT NULL REFERENCES twin_floors(floor_id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (family_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE twin_map_drafts (
  draft_id text PRIMARY KEY,
  family_id text NOT NULL REFERENCES twin_map_families(family_id),
  revision integer NOT NULL CHECK (revision > 0),
  canonical_frame_id text NOT NULL CHECK (length(btrim(canonical_frame_id)) > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'IN_REVIEW', 'VALIDATED', 'PUBLISHED')),
  validation_report_sha256 char(64),
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, revision),
  CHECK (validation_report_sha256 IS NULL OR validation_report_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (status <> 'VALIDATED' OR validation_report_sha256 IS NOT NULL),
  CHECK (status <> 'PUBLISHED' OR validation_report_sha256 IS NOT NULL)
);

CREATE TABLE twin_artifacts (
  sha256 char(64) PRIMARY KEY CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  bytes bigint NOT NULL CHECK (bytes > 0),
  object_key text NOT NULL UNIQUE CHECK (length(btrim(object_key)) > 0),
  media_type text NOT NULL CHECK (length(btrim(media_type)) > 0),
  original_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE twin_map_releases (
  release_id text PRIMARY KEY,
  family_id text NOT NULL REFERENCES twin_map_families(family_id),
  source_draft_id text NOT NULL UNIQUE REFERENCES twin_map_drafts(draft_id),
  revision integer NOT NULL CHECK (revision > 0),
  canonical_frame_id text NOT NULL,
  bundle_id text NOT NULL UNIQUE,
  manifest_sha256 char(64) NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  validation_report_sha256 char(64) NOT NULL CHECK (validation_report_sha256 ~ '^[a-f0-9]{64}$'),
  published_by text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, revision),
  CHECK (release_id = family_id || '@' || revision::text)
);

CREATE TABLE twin_release_artifacts (
  release_id text NOT NULL REFERENCES twin_map_releases(release_id),
  role text NOT NULL CHECK (role IN (
    'COORDINATE_FRAMES',
    'NAVIGATION_TOPOLOGY',
    'TWIN_ASSETS',
    'SEMANTIC_ZONES',
    'SCENE_MANIFEST',
    'FLOORPLAN',
    'OCCUPANCY'
  )),
  artifact_sha256 char(64) NOT NULL REFERENCES twin_artifacts(sha256),
  bundle_path text NOT NULL CHECK (length(btrim(bundle_path)) > 0),
  PRIMARY KEY (release_id, role),
  UNIQUE (release_id, bundle_path)
);

CREATE TABLE twin_map_release_state (
  release_id text PRIMARY KEY REFERENCES twin_map_releases(release_id),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('PUBLISHED', 'RETIRED')),
  reason text,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE twin_publication_audit (
  publication_id text PRIMARY KEY,
  draft_id text NOT NULL REFERENCES twin_map_drafts(draft_id),
  release_id text NOT NULL REFERENCES twin_map_releases(release_id),
  validation_report_sha256 char(64) NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (validation_report_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX twin_floors_site_building_idx ON twin_floors(site_id, building_id);
CREATE INDEX twin_map_drafts_family_status_idx ON twin_map_drafts(family_id, status);
CREATE INDEX twin_map_releases_family_revision_idx ON twin_map_releases(family_id, revision DESC);

CREATE FUNCTION reject_twin_release_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published twin release records are immutable';
END;
$$;

CREATE TRIGGER twin_map_releases_immutable
BEFORE UPDATE OR DELETE ON twin_map_releases
FOR EACH ROW EXECUTE FUNCTION reject_twin_release_mutation();

CREATE TRIGGER twin_release_artifacts_immutable
BEFORE UPDATE OR DELETE ON twin_release_artifacts
FOR EACH ROW EXECUTE FUNCTION reject_twin_release_mutation();

COMMIT;
