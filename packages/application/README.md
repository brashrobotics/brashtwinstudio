# Application

Runs Twin catalog use cases across domain and repository boundaries.

`TwinCatalogService` manages site, building, floor, map family, and draft
creation/listing; draft review and validation transitions; and optimistic
concurrency. It knows nothing about HTTP or PostgreSQL driver details.

Draft creation and state transitions are persisted in a unit of work together
with the corresponding versioned lifecycle event. `OutboxDispatcher` manages
leased claims, successful delivery, failure recording, and exponential-backoff
retries through repository ports.

`uploads.js` implements upload intent, expiry, completion, and cancellation use
cases. Object-store results become artifact metadata only when checksums and byte
lengths match; mismatches produce quarantine evidence instead of permanent
assets.

`draft-artifacts.js` binds integrity-verified uploads only to maps in `DRAFT`
state. It resolves derived input identities on the server from the repository,
preventing clients from inventing hashes or referencing another draft.

`survey-intakes.js` atomically groups a bounded JSON manifest and up to 256
completed survey artifact uploads under an editable draft. Verification reads
only the manifest, checks target site/floor plus hash, byte, and media identities,
and seals an immutable accepted or rejected ingest report.

`survey-materializations.js` creates one durable `PENDING` job only from an
accepted intake. It rechecks the bounded manifest and original validation-policy
identity, joins server-owned upload mappings to declared artifacts, and seals a
deterministic snapshot hash. Point clouds, images, meshes, and trajectories are
not loaded while the job is created. Execution claims an expiring worker lease,
streams the four standardized survey inputs under byte/record budgets, and
publishes a deterministic content-addressed preview. Failed attempts use bounded
exponential retry; a successful preview is re-read only after checksum, byte,
schema, and lineage verification.

`survey-registrations.js` computes a deterministic 2D similarity transform from
operator control points while requiring the source preview and an explicit
same-draft CAD/BIM or floorplan target. Its v2 report seals both provenance
edges, residuals, solver configuration, and quality policy. Review is a separate
immutable artifact, enforces requester/reviewer separation, and never permits
approval of a failed quality result.

`validation-jobs.js` creates a sealed validation snapshot while a draft is
`IN_REVIEW`, runs the deterministic validator, streams its JSON report through
the multipart object-store boundary, and binds the report with producer/config
provenance. A failed quality outcome remains a successful, auditable job while
leaving the draft in review; only a `PASSED` report moves the draft to
`VALIDATED`. Infrastructure failures move the job to `FAILED`.

`publications.js` seals a validated bundle, requires approval by a second
operator, publishes it through the immutable release store, and atomically
finalizes the database release, draft status, audit record, and
`MapReleasePublished.v1` outbox event. Expiring leases and exponential retry let
the same service reconcile interruptions both before and after the store marker.
