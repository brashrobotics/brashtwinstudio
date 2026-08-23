# Implementation Status

Last updated: August 23, 2026

## Active phase

Phase 5 — Publication outputs and Fleet-compatible visualization contracts.

## Completed

- Independent Node.js workspace and local package linking
- Repository syntax and JSON quality checks
- Thirty-four published versioned JSON Schemas
- Coordinate-frame graph and 3D transform mathematics
- `MapDraft -> review -> validated -> immutable release` domain flow
- Twin Map Bundle semantic and integrity validator
- `validate`, `inspect`, and `diff` CLI commands
- `publish` CLI command with atomic release staging
- `demo-plant@1` sample bundle
- Valid-bundle, checksum-mutation, and path-traversal contract tests
- Symlink artifact protection
- SHA-256 content-addressed local artifact store with deduplication
- Immutable store preventing reuse of a release identity
- Nineteen forward-only PostgreSQL metadata migrations
- Database-level immutability triggers for release records
- In-memory catalog repository adapter
- Driver-independent PostgreSQL repository adapter using parameterized SQL
- Optimistic `rowVersion` concurrency checks for draft changes
- Catalog application service and persistable domain transitions
- Working localhost Twin API server
- Site, building, floor, map family, and map draft HTTP flow
- Read-only immutable release HTTP catalog
- Strict body fields, content type, malformed JSON, and 1 MiB request limit
- Twin API v1 OpenAPI contract
- Bounded `pg`-based PostgreSQL connection pool
- SSL, pool, timeout, and application-name configuration validation
- Production guard against memory persistence
- Readiness checking database connectivity and migration version
- Liveness independent from database availability
- Session-scoped query and transaction ports
- Checksum-protected `twin_schema_migrations` history
- Concurrent-safe migration runner using a PostgreSQL advisory lock
- Read-only `db:status` and atomic `db:migrate` CLI commands
- Local PostgreSQL 16 Compose profile
- Real PostgreSQL 16 migration, repository, and API-readiness verification
- Complete isolation from Fleet Control source code and database
- External dataset provenance, size, and SHA-512 validation adapter and CLI
- Streaming IFC STEP and TUM trajectory inspectors
- Real IFC triangulation worker based on IfcOpenShell
- Real-data validation with ConSLAM BIM and four LiDAR ground-truth sessions
- Request-scoped in-memory and PostgreSQL unit-of-work adapters
- Atomic transaction combining draft creation/transitions and outbox inserts
- Versioned `MapDraftCreated`, `MapDraftReviewSubmitted`,
  `MapDraftReturnedToDraft`, and `MapDraftValidated` lifecycle events
- Expiring-lease outbox claims using `SKIP LOCKED`
- Delivery, failure recording, and exponential-backoff retry dispatcher
- Real PostgreSQL 16 atomic-outbox and delivery verification
- In-memory and PostgreSQL repositories for upload intents
- Multipart object-store data-plane boundary keeping large files out of the API
  process
- Local/pilot multipart adapter assembling parts with constant memory
- Content-addressed atomic finalization after SHA-256 and byte-length verification
- Quarantine flow preserving evidence after checksum or size mismatch
- Retry-safe and idempotent multipart completion receipts
- Upload initiate/get/list/complete/cancel Twin API and OpenAPI operations
- PostgreSQL transaction combining artifact metadata and terminal upload state
- Source/derived draft artifact role catalog and upload-to-draft binding service
- Coordinate-frame requirement for spatial artifacts
- Server-resolved same-draft input lineage for derived artifacts
- Producer name/version and parameter SHA-256 provenance
- PostgreSQL composite foreign key requiring a completed upload/artifact pair
- Append-only triggers preventing binding and input-edge updates or deletes
- Draft artifact list/bind Twin API and OpenAPI operations
- Source-to-derived provenance verified through real PostgreSQL 16 and HTTP
- Machine-readable draft-validation report v2 with deterministic validator/config
  identity and UI-ready issue locations
- Sealed validation-job input snapshots and multipart report publication
- Validation-report provenance binding and immutable PostgreSQL validation runs
- Job-backed Twin API/OpenAPI validation flow with no arbitrary client report hash
- Passing and failing quality outcomes separated from infrastructure job failure
- Sealed publication bundle identity linked to a validated draft/report snapshot
- Append-only two-person approval with requester self-approval rejection
- Recoverable publication leases across release-store and PostgreSQL boundaries
- Atomic release, artifact, draft, audit, and `MapReleasePublished.v1` outbox commit
- Reconciliation verified at both store-marker and final-commit interruption points
- React 19 + TypeScript Studio Web shell with a Vite 6 production build
- Typed, abortable Twin API client and TanStack Query server-state boundary
- Site, floor, map family, and draft workspace navigation
- API readiness, draft, validation-job, and immutable release status surfaces
- Local-development identity adapter behind an OIDC-ready UI boundary
- English/Turkish localization, keyboard focus, reduced motion, and responsive UI
- Desktop and 390 px mobile browser QA with a clean console
- Zero known npm dependency vulnerabilities at Increment 8 completion
- Rendering-engine-independent canonical world store in `viewer-sdk`
- Lazy-loaded Three.js adapter with orthographic 2D and perspective 3D cameras
- Pan, zoom, orbit, metre coordinate readout, grid, axes, and compass
- CAD, survey, asset, zone, and topology visibility registry
- Raycast selection preserved by `entityId` across 2D/3D view changes
- Selection safety when layers are hidden and canonical frame identity changes
- 2.4-megapixel drawing-buffer cap and split GPU runtime bundle
- Real WebGL desktop/mobile QA with layer, selection, and coordinate interactions
- Bounded SVG parser rejecting DTD/entity expansion, active content, event
  handlers, foreign namespaces, URL references, and external media
- Physical SVG root-dimension and `viewBox` normalization into centred canonical
  metres, with explicit unit overrides and non-uniform-scale rejection
- Rectangle, line, polyline, polygon, and linear path extraction with supported
  group/element transforms and explicit unsupported-feature warnings
- Deterministic `brash.floorplan-import-report/v1` source/configuration SHA-256
  provenance, bounds, point/shape counts, and canonical-frame identity
- Studio Web SVG unit selector, upload flow, CAD-layer replacement, and import
  report/error surfaces
- Real fixture upload and WebGL desktop/390 px mobile QA with no console errors
- Rendering-independent `spatial-editor` command store with immutable snapshots
  and a bounded 100-command undo/redo history
- Validated topology nodes/edges, non-zero-area zone polygons, and bounded asset
  footprint/height geometry in canonical metres
- Safe cascading edge removal when a referenced node is deleted and automatic
  edge geometry regeneration when a node moves
- Stable editor feature IDs projected into shared 2D/3D viewer entities
- Grid-snapped pointer placement, zone preview/finish/cancel workflow, and
  two-node edge connection with duplicate/self-edge rejection
- Numeric node, zone-vertex, and asset footprint inspector with label editing
  and deletion
- Ctrl/Cmd-Z, Ctrl/Cmd-Y, Delete, Escape, toolbar undo/redo, and invariant error
  surfaces
- Real 2D/3D WebGL editor QA and responsive 390 px inspector/toolbar QA with no
  current console errors or horizontal overflow
- Zero known npm vulnerabilities after the Increment 12 dependency audit
- Deterministic 2D similarity/rigid control-point solver with per-point
  residuals, RMSE, maximum error, scale deviation, and configuration hash
- Registration report v1 contract with canonical frame and input provenance
- Non-mutating floorplan alignment projected into the shared viewer world
- Manual Twin readiness policy covering alignment quality, canonical-frame
  identity, asset/zone minimums, and connected navigation topology
- Stable feature-level draft diff across nodes, edges, zones, and assets
- Stale-evidence protection and requester/approver separation for local release
  sealing
- Immutable local release preview containing aligned CAD and the complete
  editor world, reopenable in read-only synchronized 2D/3D
- Project-owned synthetic demo floorplan available directly from the Studio UI
- Full desktop and 390 px mobile import-to-release browser acceptance flow with
  no current console errors or horizontal overflow
- Explicit ownership boundary keeping sensor drivers, SLAM, localization,
  onboard autonomy, and robot safety in Brash Embodied Controller
- Versioned `brash.embodied-survey-package/v1` processed-survey transfer with
  producer build/configuration identity, clock quality, metric frame convention,
  quality summary, artifact hashes, and declared sizes
- Deterministic `brash.embodied-survey-ingest-report/v1` acceptance evidence with
  manifest and policy SHA-256 identities
- Manifest-only validator rejecting unsafe paths, duplicate artifacts, missing
  evidence roles, absent spatial frames, excessive clock offset, partial/failed
  surveys, and declared-byte policy violations before large-file access
- Synthetic Embodied Controller fixture plus a pinned, metadata-only GrandTour
  ETH-2 selection: approximately 291 MB base and 830 MB with one camera/IMU,
  both disabled from automatic download
- Atomic survey intake grouping one bounded manifest and up to 256 completed,
  content-addressed artifact uploads under an editable draft
- Immutable `OPEN -> ACCEPTED|REJECTED` survey intake transition with target
  site/floor and manifest SHA-256/byte/media identity verification
- PostgreSQL composite upload references, deferred mapping-count checks,
  editable-draft row locking, and append-only intake/mapping triggers
- Twin API/OpenAPI create, list, inspect, and verify operations for durable
  embodied survey intake
- HTTP end-to-end acceptance proving that the API reads only manifest bytes and
  never loads point-cloud, trajectory, mesh, or image payloads during intake
- SHA-256-verifying external dataset-selection adapter separating local paths
  from pinned upstream repository paths and optional evidence
- Real GrandTour ETH-2 inspection of 4,305 DLIO odometry poses, 47,567 TF
  samples, and a 17,388,758-vertex processed PLY map without archive extraction
- Idempotent `grandtour:seed` development import that exports every DLIO pose to
  TUM, uploads the checksum-pinned real PLY, creates a separate ETH site/draft,
  and executes the production-format intake and materialization boundaries
- Bounded `brash.survey-materialization-preview/v1` trajectory, frame,
  reconstruction-bounds, and deterministic 4,096-point preview contract
- Backward-readable `brash.survey-materialization-preview/v2` with raw PLY
  evidence retained alongside a trajectory-envelope operational plan capped at
  4,096 spatial cells
- Development-only safe Zarr-v2 Blosc/LZ4 and binary PLY inspector with decoded
  chunk, archive-member, metadata, vertex-count, and preview-size limits
- Durable accepted-intake materialization snapshot with raw/canonical manifest,
  validation-policy, upload mapping, and deterministic snapshot SHA-256 checks
- Rejected-intake ineligibility before object-store access and one append-only
  `PENDING` job per accepted intake under an editable draft
- PostgreSQL composite intake/manifest provenance, accepted-intake trigger,
  immutable snapshot guard, and Twin API/OpenAPI create/get/list operations
- Standard v1 coordinate-frame and calibration input contracts, TUM trajectory,
  and binary little-endian XYZI PLY runtime boundary with no GrandTour/Zarr
  dependency in product execution
- Expiring materialization leases, stale-owner rejection, three-attempt bounded
  retry, immutable snapshot checks, and completed-upload output provenance
- Streaming checksum/byte verification for every input and a deterministic,
  content-addressed preview artifact capped at 4 MiB and 4,096 samples per layer
- Twin API/OpenAPI run and integrity-checked preview operations, exercised from
  accepted intake through stored output in the HTTP end-to-end test
- Studio survey status, sampled point-cloud and trajectory rendering, 2D/3D
  fit-to-bounds navigation, and an explicit read-only original-source-frame mode
  that does not falsely overlay unregistered survey data on CAD
- GrandTour ETH-2 operational plan verified from the complete 17,388,758-point
  PLY: 11,281,293 in-envelope points, 3,374 balanced samples, 0.70 m adaptive
  resolution, 22.4 x 80.5 m focused bounds, and the 210.6 m ANYmal route
- Studio plan-aware camera fitting, occupancy layer, registration defaults, and
  survey scale/resolution metrics prevent distant PLY outliers from shrinking
  the real building-scale view
- `SURVEY_SOURCE` bindings for every accepted materialization input and one
  `SURVEY_PREVIEW` derived binding with immutable same-draft input edges
- Draft artifact provenance input capacity aligned to the 256-file survey
  intake contract and enforced by PostgreSQL migration 012
- Versioned `brash.survey-registration-report/v2` with source preview and
  explicit CAD/BIM or floorplan target identities, sorted control points,
  transform, per-point residuals, RMSE, maximum/mean error, scale deviation,
  solver version, configuration SHA-256, and deterministic quality policy
- Twin API/OpenAPI registration create/list operations storing each report as a
  completed, content-addressed `REGISTRATION_REPORT` derived from the sealed
  preview binding
- Operator-editable source/target control points with locked-scale rigid solve
  by default, repeatable registration versions, and a fused canonical 2D/3D
  survey overlay that preserves the separate source-frame inspection mode
- Compact `npm run demo:seed` workflow covering upload through registered fused
  view without external downloads
- Immutable `brash.survey-registration-acceptance/v1` approval or rejection
  evidence, requester/reviewer separation, failed-quality approval prevention,
  and PostgreSQL migration 013 provenance support
- Studio target selection, quality outcome, and independent reviewer controls
  backed by the Twin API acceptance endpoint
- Versioned `brash.survey-quality-report/v1` with declared coverage, sampled
  occupancy, trajectory continuity/timing, frame consistency, reconstruction
  density, preview-warning metrics, deterministic policy identity, and a bounded
  source-frame occupancy grid
- Immutable `brash.survey-quality-acceptance/v1` review evidence with
  requester/reviewer separation and failed-quality approval prevention
- Registration creation requires the approved survey-quality acceptance as a
  third immutable provenance input alongside preview and design target
- Workflow-managed quality, registration, preview, and validation evidence
  cannot be forged through the generic artifact binding API
- Studio quality generation/review controls plus a toggleable coverage layer in
  source and registered 2D/3D views
- GrandTour seed quality generation preserves its missing design-coverage
  declaration as a visible failed issue instead of inventing passing evidence
- Registration acceptance content is verified by artifact SHA-256 during release
  validation; missing, rejected, malformed, or mismatched decisions block the
  draft from becoming publishable
- Versioned bounded semantic-observation, canonical asset-candidate, and
  immutable candidate-review contracts with model/input/registration provenance
- Semantic candidate application/API workflow requiring an approved registration
  and preserving observations separately from operator asset decisions
- Studio semantic review controls for accept/reject, name, type, and scalar JSON
  properties, plus accepted/unreviewed candidate rendering on the 2D/3D Assets layer
- PostgreSQL migration 015 and API protection preventing generic clients from
  forging candidate report or review evidence
- Explicit accepted-candidate promotion into immutable, predecessor-linked
  `TWIN_ASSETS` draft revisions with stable asset identity and canonical geometry
- Later registered-observation comparison against the latest promoted baseline,
  producing immutable review-required `MOVED`, `MISSING`, and `APPEARED` reports
- Studio promotion/change controls and shared 2D/3D rendering for promoted
  assets and spatial change markers
- PostgreSQL migration 016 and managed API roles preventing clients from forging
  asset revisions or change evidence
- Immutable `brash.asset-change-review/v1` evidence with independent reviewer,
  all-change confirm/dismiss decisions, appeared-asset metadata, and explicit
  approximate-missing acknowledgement
- Draft Twin assets v2 with stable-identity moved/missing/appeared application,
  predecessor, report, review, and observation provenance
- Atomic `TWIN_ASSETS` binding plus `TwinAssetChangesApplied.v1` outbox event,
  including deterministic rollback when notification persistence fails
- Studio change-review controls, revision application, dismissed-marker hiding,
  and applied 2D/3D asset geometry
- PostgreSQL migration 017 and managed API protection for change-review evidence
- Versioned bounded sensor-visibility observations correlated to one semantic
  observation set, with distinct calibration, synchronized pose, occlusion
  geometry, producer, and same-draft input provenance
- Immutable canonical sensor-visibility reports derived through a passed,
  independently approved registration with a production confidence floor
- Asset-change report v2 requiring matching visibility and semantic observation
  identities, suppressing `MISSING` outside qualified cells, and sealing the
  qualifying cell ID/confidence with each missing result
- Studio visibility qualification, evidence summary, repeated-scan report
  creation, matching-evidence selection, and canonical 2D/3D coverage overlay
- PostgreSQL migration 018 and managed API protection for visibility reports
- GrandTour selection reverified at 290,764,702 bytes and explicitly marked
  ineligible for calibrated visibility instead of fabricating line-of-sight or
  `MISSING` evidence
- Exact `TwinAssetChangesApplied.v1` event and bounded redacted
  `brash.manager-notification-message/v1` provider contracts
- Immutable site/floor manager email or HTTPS webhook routes with public
  destination hints and fingerprints instead of raw contact values
- Idempotent event projection into durable notifications and one delivery per
  matching route, independent from outbox acknowledgement
- Expiring notification delivery leases, provider idempotency keys, bounded
  exponential retry, append-only attempt evidence, terminal dead-letter state,
  and audited manual requeue
- Twin API/OpenAPI route configuration, explicit route backfill, draft status,
  and dead-letter retry operations with no public event-ingestion endpoint
- Studio notification summaries, routing-required state, delivery attempts,
  redacted route configuration, terminal failure, and retry controls
- Deterministic application, PostgreSQL repository, HTTP, typed-client, and UI
  tests for routing, idempotency, retry, terminal state, and redaction

## Next development increment

Phase 5 starts with immutable scene packaging and a decoupled Fleet integration
fixture:

1. Produce a deterministic optimized scene manifest from sealed canonical Twin
   geometry with explicit LOD, bounds, coordinate-frame, hash, and byte budgets.
2. Bind the scene output into the immutable Twin Map Bundle and validate it at
   publication without mixing static release geometry with live robot state.
3. Add a mock versioned Fleet live-overlay and mission-replay fixture that can
   drive a standalone demo viewer while leaving Fleet Control source untouched.

## Deliberately deferred

- Brash Embodied Controller SLAM implementation, which is outside this product
- Web rendering engine selection
- Production CAD/IFC importer
- AI model/dataset selection
- 3D viewer changes inside Fleet Control

These choices remain deferred until the core spatial contracts and publication
lifecycle are stable.

## Verification result

```text
npm run check
syntax/json: 287 files passed
backend tests: 131 total, 128 passed, 3 conditionally skipped, 0 failed
web tests: 46/46 passed with strict TypeScript and production build
latest migration contract: schema version 19; last live PostgreSQL 16 gate passed with schema version 12
live GrandTour ETH-2 SHA-256/preview gate: passed against the 290,764,702-byte base selection
ConSLAM/IfcOpenShell gate: last passed August 13, 2026 and remains opt-in
fixture: demo-plant@1 valid
publication: immutable release store verified
http: localhost API lifecycle verified
postgres: PostgreSQL 16 live migrations/catalog/readiness/transactional-outbox verified
migrations: concurrent advisory-lock application verified
outbox: atomic lifecycle events, expiring lease, delivery and retry verified
uploads: multipart assembly, checksum, quarantine, expiry and HTTP lifecycle verified
provenance: completed-upload source/derived chain and append-only PostgreSQL guards verified
validation: sealed snapshot, immutable JSON evidence, PostgreSQL run guards and HTTP lifecycle verified
publication: two-person approval, sealed store identity, recovery and atomic finalization verified
web: typed API shell, responsive EN/TR UI, dependency audit and browser QA verified
viewer: synchronized 2D/3D world, layers, selection, coordinate interaction and GPU budget verified
svg import: security rejection, physical scale, transforms, hashes, warning report and real WebGL upload verified
editor: node/edge/zone/asset commands, undo/redo, numeric correction and desktop/mobile 2D/3D QA verified
manual twin: control-point alignment, residual policy, diff, validation, two-person approval and immutable read-only preview verified
embodied survey: strict manifest, clock/frame/quality, hash/size policy and no-download GrandTour selection verified
survey intake: atomic upload mapping, manifest-only verification, immutable rejection evidence and HTTP lifecycle verified
survey materialization: immutable input, leased/retry-safe streaming, content-addressed preview v2, focused operational plan, PostgreSQL provenance, HTTP lifecycle and source-frame 2D/3D browser QA verified
survey registration: explicit design-target lineage, report v2 quality policy, immutable independent review, HTTP lifecycle, and fused/source-frame 2D/3D browser QA verified
survey quality: deterministic coverage/trajectory/frame/reconstruction evidence, immutable independent review, registration gate, and 2D/3D coverage-layer QA verified
semantic candidates: approved-registration transform, immutable operator decisions, HTTP lifecycle, and 2D/3D Assets-layer tests verified
twin asset changes: independent review, qualification acknowledgement, stable-identity v2 application, atomic outbox rollback, HTTP lifecycle, and 2D/3D marker behavior verified
sensor visibility: calibrated/pose/occlusion provenance, canonical transformation, qualification, correlated v2 missing gate, HTTP lifecycle, and 2D/3D coverage overlay verified
dataset: ConSLAM IFC/GT checksum, geometry and trajectory validation verified
GrandTour: pinned SHA-256, safe Zarr/PLY bounds, real trajectory/TF/map metrics, raw outlier disclosure, and focused plan preview verified
GrandTour seed: real 290,764,702-byte selection imported into a live Twin API and materialized as a 22.4 x 80.5 m Studio showcase
```
