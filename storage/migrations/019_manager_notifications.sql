BEGIN;

ALTER TABLE twin_floors
  ADD CONSTRAINT twin_floors_site_floor_unique UNIQUE (site_id, floor_id);

CREATE TABLE twin_manager_notification_routes (
  route_id text PRIMARY KEY CHECK (route_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  scope_type text NOT NULL CHECK (scope_type IN ('SITE', 'FLOOR')),
  site_id text NOT NULL REFERENCES twin_sites(site_id),
  floor_id text,
  channel text NOT NULL CHECK (channel IN ('EMAIL', 'WEBHOOK')),
  destination text NOT NULL CHECK (length(btrim(destination)) > 0),
  destination_sha256 char(64) NOT NULL CHECK (destination_sha256 ~ '^[a-f0-9]{64}$'),
  display_label text NOT NULL CHECK (length(btrim(display_label)) > 0),
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (site_id, floor_id) REFERENCES twin_floors(site_id, floor_id),
  CHECK (
    (scope_type = 'SITE' AND floor_id IS NULL)
    OR (scope_type = 'FLOOR' AND floor_id IS NOT NULL)
  )
);

CREATE TABLE twin_manager_notifications (
  notification_id text PRIMARY KEY CHECK (notification_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  source_event_id text NOT NULL UNIQUE CHECK (length(btrim(source_event_id)) > 0),
  source_event_sha256 char(64) NOT NULL CHECK (source_event_sha256 ~ '^[a-f0-9]{64}$'),
  draft_id text NOT NULL REFERENCES twin_map_drafts(draft_id),
  site_id text NOT NULL REFERENCES twin_sites(site_id),
  floor_id text NOT NULL,
  notification_required boolean NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (site_id, floor_id) REFERENCES twin_floors(site_id, floor_id)
);

CREATE TABLE twin_manager_notification_deliveries (
  delivery_id text PRIMARY KEY CHECK (delivery_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  notification_id text NOT NULL REFERENCES twin_manager_notifications(notification_id),
  route_id text NOT NULL REFERENCES twin_manager_notification_routes(route_id),
  channel text NOT NULL CHECK (channel IN ('EMAIL', 'WEBHOOK')),
  destination text NOT NULL CHECK (length(btrim(destination)) > 0),
  destination_sha256 char(64) NOT NULL CHECK (destination_sha256 ~ '^[a-f0-9]{64}$'),
  display_label text NOT NULL CHECK (length(btrim(display_label)) > 0),
  status text NOT NULL CHECK (status IN ('PENDING', 'DELIVERED', 'DEAD_LETTER')),
  available_at timestamptz NOT NULL,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  provider_message_id text,
  last_error text,
  created_by text NOT NULL CHECK (length(btrim(created_by)) > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (notification_id, route_id),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'DELIVERED') = (delivered_at IS NOT NULL)),
  CHECK (status <> 'DELIVERED' OR provider_message_id IS NOT NULL),
  CHECK (status <> 'DEAD_LETTER' OR last_error IS NOT NULL)
);

CREATE TABLE twin_manager_notification_attempts (
  delivery_id text NOT NULL REFERENCES twin_manager_notification_deliveries(delivery_id),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  outcome text NOT NULL CHECK (outcome IN ('DELIVERED', 'FAILED')),
  provider_message_id text,
  error text,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (delivery_id, attempt_number),
  CHECK ((outcome = 'DELIVERED') = (provider_message_id IS NOT NULL)),
  CHECK ((outcome = 'FAILED') = (error IS NOT NULL))
);

CREATE TABLE twin_manager_notification_requeues (
  requeue_id text PRIMARY KEY CHECK (requeue_id ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  delivery_id text NOT NULL REFERENCES twin_manager_notification_deliveries(delivery_id),
  requested_by text NOT NULL CHECK (length(btrim(requested_by)) > 0),
  requested_at timestamptz NOT NULL
);

CREATE INDEX twin_manager_notifications_draft_idx
  ON twin_manager_notifications(draft_id, created_at, notification_id);

CREATE UNIQUE INDEX twin_manager_notification_routes_identity_idx
  ON twin_manager_notification_routes(scope_type, site_id, coalesce(floor_id, ''), channel, destination_sha256);

CREATE INDEX twin_manager_notification_delivery_claim_idx
  ON twin_manager_notification_deliveries(available_at, lease_expires_at, created_at, delivery_id)
  WHERE status = 'PENDING';

CREATE FUNCTION reject_manager_notification_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Manager notification evidence is append-only';
END;
$$;

CREATE TRIGGER twin_manager_notification_routes_immutable
BEFORE UPDATE OR DELETE ON twin_manager_notification_routes
FOR EACH ROW EXECUTE FUNCTION reject_manager_notification_evidence_mutation();

CREATE TRIGGER twin_manager_notifications_immutable
BEFORE UPDATE OR DELETE ON twin_manager_notifications
FOR EACH ROW EXECUTE FUNCTION reject_manager_notification_evidence_mutation();

CREATE TRIGGER twin_manager_notification_attempts_immutable
BEFORE UPDATE OR DELETE ON twin_manager_notification_attempts
FOR EACH ROW EXECUTE FUNCTION reject_manager_notification_evidence_mutation();

CREATE TRIGGER twin_manager_notification_requeues_immutable
BEFORE UPDATE OR DELETE ON twin_manager_notification_requeues
FOR EACH ROW EXECUTE FUNCTION reject_manager_notification_evidence_mutation();

CREATE FUNCTION guard_manager_notification_delivery_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Manager notification delivery evidence cannot be deleted';
  END IF;
  IF OLD.delivery_id <> NEW.delivery_id
     OR OLD.notification_id <> NEW.notification_id
     OR OLD.route_id <> NEW.route_id
     OR OLD.channel <> NEW.channel
     OR OLD.destination <> NEW.destination
     OR OLD.destination_sha256 <> NEW.destination_sha256
     OR OLD.display_label <> NEW.display_label
     OR OLD.created_by <> NEW.created_by
     OR OLD.created_at <> NEW.created_at THEN
    RAISE EXCEPTION 'Manager notification delivery identity is immutable';
  END IF;
  IF OLD.status = 'DELIVERED' THEN
    RAISE EXCEPTION 'Delivered manager notification evidence is immutable';
  END IF;
  IF OLD.status = 'DEAD_LETTER' AND NEW.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Dead-letter delivery may only be explicitly requeued';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER twin_manager_notification_deliveries_guard
BEFORE UPDATE OR DELETE ON twin_manager_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION guard_manager_notification_delivery_mutation();

COMMIT;
