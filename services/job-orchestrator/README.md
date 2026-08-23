# Job Orchestrator

Manages long-running mapping pipeline jobs as a durable state machine.

## Job types

- Survey ingest and integrity verification
- SLAM/reconstruction
- CAD–SLAM registration
- Semantic inference
- 2D derivation and topology suggestions
- 3D mesh/LOD generation
- Release validation and bundle packaging

## Rules

- Every step must be repeatable and idempotent.
- Retry, timeout, cancellation, and dead-letter state must be recorded.
- Worker outputs must be addressed by content hash.
- A failed job cannot affect a published release.

## Transactional outbox delivery

Draft lifecycle events are written in the same transaction as aggregate changes.
The dispatcher claims batches with `SKIP LOCKED`, uses expiring leases, marks
successful delivery, and makes transient failures available again with
exponential backoff. Broker fan-out remains a dedicated adapter so one consumer
cannot acknowledge events intended for another.

## Manager notification delivery

`TwinAssetChangesApplied.v1` is projected downstream into an independent
notification repository. Its workers claim separate delivery leases, send a
redacted provider message with the delivery ID as idempotency key, record every
attempt, and dead-letter exhausted work. Notification delivery never becomes a
transactional prerequisite for the reviewed Twin asset revision. A real broker
and provider adapter remain deployment concerns.
