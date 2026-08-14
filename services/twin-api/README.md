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
- `GET /api/v1/map-drafts/:draftId/survey-materializations`
- `POST /api/v1/survey-intakes/:intakeId/materializations`
- `GET /api/v1/survey-materializations/:jobId`
- `POST /api/v1/survey-materializations/:jobId/run`
- `GET /api/v1/survey-materializations/:jobId/preview`
- `GET|POST /api/v1/map-drafts/:draftId/survey-quality-reviews`
- `POST /api/v1/map-drafts/:draftId/survey-quality-reviews/:qualityReviewId/acceptance`
- `GET|POST /api/v1/map-drafts/:draftId/survey-registrations`
- `POST /api/v1/map-drafts/:draftId/survey-registrations/:registrationId/acceptance`
- `GET|POST /api/v1/map-drafts/:draftId/validation-jobs`
- `GET /api/v1/validation-jobs/:jobId`
- `POST /api/v1/validation-jobs/:jobId/run`
- `GET|POST /api/v1/uploads`
- `GET /api/v1/uploads/:uploadId`
- `POST /api/v1/uploads/:uploadId/complete`
- `POST /api/v1/uploads/:uploadId/cancel`
- `GET /api/v1/releases`
- `GET /api/v1/releases/:releaseId`

The generic artifact binding endpoint accepts source data and externally
produced map derivatives. Workflow evidence roles such as survey previews,
quality decisions, registration decisions, and validation reports are
system-managed and can only be created by their dedicated application
workflows. This prevents clients from forging evidence used by later gates.

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

An accepted intake can create exactly one materialization job. Creation rereads
only the bounded manifest, rechecks its raw and canonical identities plus the
validation-policy hash, joins the server-owned upload mappings, and persists an
immutable input snapshot. Execution claims a 15-minute lease, streams standard
coordinate-frame JSON, calibration JSON, TUM trajectory, and binary XYZI PLY
from the object store, then stores a bounded preview through the same verified
multipart upload path. The HTTP run operation is a local-pilot worker boundary;
it can move behind an orchestrated worker without changing the snapshot or
preview contracts.

The draft-artifact endpoint accepts only `COMPLETED` uploads. Source records
represent direct evidence; derived records contain same-draft input bindings and
producer/config hashes. New artifacts cannot be added while a draft is in review
or validated state.

Survey registration requires a successful source-frame preview and an explicit
same-draft `BIM_SOURCE` or `FLOORPLAN_SOURCE` binding in the draft canonical
frame. The generated v2 report seals both artifact identities, the rigid
transform, residual metrics, and deterministic quality thresholds. A different
reviewer may then create exactly one immutable approval or rejection artifact;
a failed quality result cannot be approved.

Survey quality review runs before registration. It seals coverage, trajectory,
frame, reconstruction-density, and warning evidence derived from the successful
preview. A different operator must approve the passing report; the acceptance
artifact becomes a required registration provenance input.

Clients cannot mark a draft validated by supplying an arbitrary SHA-256 value.
They create and run a validation job instead. The service snapshots draft inputs,
stores the generated report as a `VALIDATION_REPORT` artifact, and transitions
the draft only when the report outcome is `PASSED`.
