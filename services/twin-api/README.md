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
- `GET|POST /api/v1/map-drafts/:draftId/semantic-candidates`
- `POST /api/v1/map-drafts/:draftId/semantic-candidates/:candidateSetId/review`
- `GET|POST /api/v1/map-drafts/:draftId/sensor-visibility`
- `GET|POST /api/v1/map-drafts/:draftId/twin-assets`
- `GET|POST /api/v1/map-drafts/:draftId/asset-changes`
- `POST /api/v1/map-drafts/:draftId/asset-changes/:changeSetId/review`
- `POST /api/v1/map-drafts/:draftId/asset-changes/:changeSetId/apply`
- `GET|POST /api/v1/notification-routes`
- `GET /api/v1/map-drafts/:draftId/manager-notifications`
- `POST /api/v1/manager-notifications/:notificationId/route`
- `POST /api/v1/manager-notification-deliveries/:deliveryId/retry`
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
quality decisions, registration decisions, semantic candidate reports/reviews,
sensor visibility reports, Twin asset revisions, change reports/reviews, and validation reports are
system-managed and can only be created by their dedicated application
workflows. This prevents clients from forging evidence used by later gates.

`SEMANTIC_OBSERVATIONS` is intentionally accepted as an externally produced
derived artifact: it must name same-draft camera/LiDAR/survey inputs and carry a
model producer/configuration identity. The semantic-candidate workflow verifies
those inputs and an approved registration before emitting canonical candidates.
Review records operator decisions but does not create permanent Twin assets.
`SENSOR_VISIBILITY_OBSERVATIONS` is the companion externally produced artifact
for the same processing run. It must bind distinct calibration, synchronized
sensor-pose, and occlusion-geometry evidence. The dedicated endpoint verifies
those inputs and the approved registration, transforms bounded coverage cells
into the canonical frame, and stores a system-managed qualification report.
The dedicated promotion command creates a new immutable draft asset revision
from accepted decisions. Change detection reads a later approved-registration
candidate report, compares it with the latest revision, and emits only
review-required evidence; it never edits that baseline. The detection command
requires the visibility report ID and rejects evidence from a different
registration or semantic observation set. `MISSING` is emitted only for a
baseline asset inside a qualified cell at the sealed confidence threshold;
unqualified or out-of-cell coverage suppresses it. Change application uses
the same database transaction for the new `TWIN_ASSETS` binding and its
`TwinAssetChangesApplied.v1` outbox event. The API never applies unreviewed or
dismissed detections.

Manager notification routes are immutable and scoped to a site or floor. API
responses expose only a destination hint and fingerprint, never a full email
address or webhook URL. Draft notification status includes the sealed redacted
message, attempt evidence, terminal failure, explicit route backfill, and
audited dead-letter retry controls. Event projection is intentionally a trusted
worker operation rather than a public HTTP endpoint: the API neither consumes
the shared transactional outbox nor calls an external messaging provider.

Release publication does not accept a server filesystem path through the API.
The bootstrap now constructs the trusted publication application service for
packager/reconciliation workers, while the HTTP API continues to expose a
read-only release catalog. Internal packager/reconciliation workers pass a
sealed bundle handle; clients never submit a server path.

The deterministic Scene Manifest v2/Bundle v2 packager now provides that
internal filesystem boundary and its output is accepted by the immutable release
store. Durable job execution and a remote content-addressed tile store remain the
next production step; HTTP clients still cannot submit server paths or proxy GLB
bytes through Twin API.

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
multipart upload path. Preview v2 includes a capped operational-plan projection
computed while streaming the PLY, without replacing its raw evidence bounds.
The HTTP run operation is a local-pilot worker boundary;
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
