# Manager Notification Service

Projects applied Twin asset-change events into durable, manager-visible
notifications and dispatches each routed delivery through a provider-neutral
port.

## Responsibilities

- Consume only `TwinAssetChangesApplied.v1` through a trusted worker boundary.
- Match immutable site- and floor-scoped email or HTTPS webhook routes.
- Create one idempotent delivery per notification and route.
- Claim expiring worker leases, retry temporary failures, and record every
  attempt.
- Dead-letter exhausted deliveries and preserve audited manual requeues.
- Expose redacted route, status, attempt, and failure evidence to Studio.

## Boundaries

This service does not own the transactional outbox, perform asset-change
decisions, call Fleet Control, or contain a vendor SDK. Provider adapters receive
the sealed message plus the delivery ID as an idempotency key. External network
delivery remains disabled until a separately configured adapter is deployed.
