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
exponential backoff. A message-broker adapter will connect to this publisher port
in a later increment.
