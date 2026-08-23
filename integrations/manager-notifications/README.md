# Manager Notification Integration

This boundary delivers reviewed Twin asset-change results to factory managers
without coupling Twin Studio to Fleet Control or a specific messaging vendor.

## Input

- Versioned `TwinAssetChangesApplied.v1` domain events.
- Immutable site- or floor-scoped notification routes.
- A provider-neutral email or HTTPS webhook delivery port.

The projector is idempotent by event and route identity. It stores a bounded,
redacted `brash.manager-notification-message/v1` payload; asset coordinates,
properties, images, credentials, and raw route destinations are not included.

## Delivery behavior

- Workers claim expiring delivery leases independently of the transactional
  outbox publisher.
- The delivery ID is the provider idempotency key.
- Temporary failures use bounded exponential retry.
- Exhausted deliveries become `DEAD_LETTER` and require an audited manual
  requeue.
- Notification failure never rolls back an already reviewed asset revision.

Twin Studio currently supplies the durable projection, routing, status, and
provider port. No external email or webhook provider is connected and the API
does not expose a public event-ingestion endpoint. A trusted broker/worker
adapter must call `consumeOutboxRecord` and then run the dispatcher.

## Security requirements

- Store raw destinations only in the delivery repository.
- Return only destination hints and SHA-256 fingerprints to API and Studio
  clients.
- Keep provider credentials outside message payloads and audit records.
- Allow HTTPS webhook destinations only.
- Verify broker identity and event schema before projection.
