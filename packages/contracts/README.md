# Contracts

The single source of truth for externally visible API, event, and file contracts.

## Contents

- JSON Schema and OpenAPI definitions
- Asynchronous domain-event schemas
- Raw Survey Package manifest
- Twin Map Bundle manifest
- Fleet Control compatibility contract
- Schema versioning and backward-compatibility tests

Contract types may be generated but must not be copied from services. Breaking
changes require a new major contract or a controlled migration.

## Implemented baseline

`schemas/` contains versioned JSON schemas for the Raw Survey Package, Twin Map Bundle,
coordinate frames, navigation topology, twin assets, scene manifest, Fleet live
overlay, embodied survey transfer/ingest evidence, and deterministic
draft-validation reports, semantic observations, canonical asset candidates,
immutable candidate review, draft Twin asset revisions, and review-required
asset-change reports. Sensor visibility observations and reports bind calibrated
sensor poses, calibration, occlusion geometry, canonical coverage cells, and a
correlated semantic observation set. Asset-change report v2 gates `MISSING`
evidence on that sealed visibility identity while retaining the legacy v1
reader contract. Draft Twin assets v2 adds change-application provenance
while retaining the v1 promotion contract, and asset-change review v1 seals
independent operator decisions. Survey materialization preview v2 adds a
bounded operational-plan projection without removing the immutable v1 reader
contract. `index.js` exports runtime contract and artifact constants.
Draft validation v2 adds content-verified registration decision
evidence while retaining the legacy v1 schema for readers of existing reports.
`TwinAssetChangesApplied.v1` now has an exact asynchronous event schema, and
`brash.manager-notification-message/v1` defines the bounded redacted payload
handed to provider adapters.

Twin Map Bundle v2 and Scene Manifest v2 retain v1 readers while adding scene
producer/input hashes, tile/LOD budgets, and per-GLB path/hash/byte identity.
Fleet Live Replay v1 seals an ordered series of Live Overlay v1 snapshots against
one immutable map release and canonical coordinate frame.

`openapi/twin-api.v1.yaml` defines the catalog, upload, draft artifact provenance,
embodied survey intake, quality/registration review, semantic candidate review,
asset promotion/change detection/review/application, validation-job, and release API surface. Validation is
job-backed; the API does not expose a client-supplied report-hash transition.
`DRAFT_ARTIFACT_ROLES` and `DRAFT_ARTIFACT_KINDS` are exported from `index.js` as
runtime constants.

Contract tests verify that the schema catalog uses unique, versioned identities.
