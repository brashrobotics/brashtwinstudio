BEGIN;

ALTER TABLE twin_outbox_events
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD CONSTRAINT twin_outbox_lease_pair_check
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL));

CREATE INDEX twin_outbox_delivery_claim_idx
  ON twin_outbox_events(available_at, lease_expires_at, occurred_at, event_id)
  WHERE delivered_at IS NULL;

COMMIT;
