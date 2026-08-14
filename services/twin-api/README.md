# Twin API

The primary API boundary for Studio Web and automation clients.

## Responsibilities

- Manage site, building, floor, coordinate-frame, and survey records.
- Manage draft, review, validation, publication, and retirement lifecycles.
- Manage twin assets, semantic observations, and change candidates.
- Generate short-lived object-store upload/download access.
- Enforce authorization, audit, idempotency, and optimistic concurrency.
- Expose published bundle metadata as read-only data.

Large raw files must not pass through the API process, and heavy geometry work
must not run in it.

## Implemented API

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET|POST /api/v1/sites`
- `GET|POST /api/v1/sites/:siteId/buildings`
- `POST /api/v1/sites/:siteId/buildings/:buildingId/floors`
- `GET /api/v1/floors?siteId=...`
- `GET|POST /api/v1/map-families`
- `GET|POST /api/v1/map-drafts`
- `GET /api/v1/map-drafts/:draftId`
- `POST /api/v1/map-drafts/:draftId/submit-review`
- `POST /api/v1/map-drafts/:draftId/return-to-draft`
- `GET|POST /api/v1/map-drafts/:draftId/artifacts`
- `GET|POST /api/v1/map-drafts/:draftId/survey-intakes`
- `GET /api/v1/survey-intakes/:intakeId`
- `POST /api/v1/survey-intakes/:intakeId/verify`
- `GET|POST /api/v1/map-drafts/:draftId/validation-jobs`
- `GET /api/v1/validation-jobs/:jobId`
- `POST /api/v1/validation-jobs/:jobId/run`
- `GET|POST /api/v1/uploads`
- `GET /api/v1/uploads/:uploadId`
- `POST /api/v1/uploads/:uploadId/complete`
- `POST /api/v1/uploads/:uploadId/cancel`
- `GET /api/v1/releases`
- `GET /api/v1/releases/:releaseId`

Release publication does not accept a server filesystem path through the API.
The bootstrap now constructs the trusted publication application service for
packager/reconciliation workers, while the HTTP API continues to expose a
read-only release catalog. A future draft-bundle producer will pass an internal
sealed bundle handle; clients will never submit a server path.

Start the local server:

```bash
npm run dev:api
```

Bootstrap supports `TWIN_PERSISTENCE_MODE=memory|postgres`. Production rejects
memory mode. PostgreSQL readiness runs a real `SELECT 1`; liveness continues to
report process health during a database outage.

Upload endpoints do not accept binary request bodies. The initiate response
returns object-store data-plane instructions, and completion moves the session to
`COMPLETED` or `QUARANTINED` after checksum and byte-length verification.

Survey intake creation accepts only completed uploads and atomically seals the
manifest/artifact mapping. Verification reads at most 1 MiB of JSON manifest
content; large point clouds, meshes, trajectories, and image archives are
matched through their stored SHA-256, byte length, and media identity without
being loaded by the API process. Acceptance and rejection are both immutable,
auditable terminal results.

The draft-artifact endpoint accepts only `COMPLETED` uploads. Source records
represent direct evidence; derived records contain same-draft input bindings and
producer/config hashes. New artifacts cannot be added while a draft is in review
or validated state.

Clients cannot mark a draft validated by supplying an arbitrary SHA-256 value.
They create and run a validation job instead. The service snapshots draft inputs,
stores the generated report as a `VALIDATION_REPORT` artifact, and transitions
the draft only when the report outcome is `PASSED`.
