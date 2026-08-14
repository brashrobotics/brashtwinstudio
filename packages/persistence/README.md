# Persistence

Contains Twin catalog repository boundaries and adapters.

- `InMemoryTwinCatalogRepository`: Local development and fast contract tests.
- `PostgresTwinCatalogRepository`: Runs parameterized SQL through an injected
  PostgreSQL `query` port without depending on a specific driver package.

Both adapters provide the same site, building, floor, map family, and map draft
behavior. Draft updates use `rowVersion` for optimistic concurrency.

`outbox.js` provides in-memory and PostgreSQL transactional-outbox repositories,
a rollback-capable local unit of work, and a request-scoped PostgreSQL unit of
work. PostgreSQL claims use `FOR UPDATE SKIP LOCKED` and expiring leases for
concurrent dispatchers. The unit-of-work context also exposes draft-artifact
persistence so a reviewed asset revision and its notification event commit or
roll back together.

`uploads.js` provides in-memory and PostgreSQL upload-session adapters. A
successful content-addressed artifact insert and the session's `COMPLETED`
transition share one PostgreSQL transaction; stale completion is rejected through
`rowVersion`.

`draft-artifacts.js` provides in-memory and PostgreSQL adapters for source/derived
bindings and input provenance. PostgreSQL writes use one transaction, while
completed-upload, same-draft input, and append-only guarantees are enforced at
the database level. The in-memory adapter exposes snapshots for deterministic
artifact/outbox rollback tests; the PostgreSQL adapter can join an existing
request-scoped transaction without opening a nested transaction.

`survey-intakes.js` stores an intake and all completed-upload mappings in one
transaction. PostgreSQL composite foreign keys, deferred count checks, and
append-only triggers prevent partial attachment or rewritten acceptance history.

`survey-materializations.js` stores one immutable input snapshot per accepted
intake. The PostgreSQL adapter relies on composite intake/manifest identity,
same-draft and editable-draft guards, then permits only guarded leased execution
transitions. Claims are atomic, stale owners cannot complete a reclaimed job,
retries are bounded, and successful output references the exact completed
upload/content identity.

`validation-jobs.js` persists `RELEASE_VALIDATION` processing jobs and immutable
validation-run metadata. PostgreSQL completes the job and inserts its run record
in one transaction; composite references seal the report binding and content
hash, while database triggers reject inconsistent or mutable run history.

`publications.js` persists two-person approval and the recoverable publication
state machine. Finalization inserts release metadata/artifact bindings, marks the
draft published, writes publication audit, and appends the published event in one
PostgreSQL transaction. In-memory persistence provides the same rollback
behavior for deterministic tests.

## PostgreSQL runtime

`postgres.js` validates environment configuration and provides a `pg` connection
pool, parameterized query/transaction ports, and credential-safe health output.
Supported SSL modes are `disable`, `require`, and certificate-verifying
`verify-full`.
