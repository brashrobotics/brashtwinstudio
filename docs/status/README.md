# Implementation Status

Last updated: August 14, 2026

## Active phase

Phase 1 — Manual Mapping Studio MVP foundation.

## Completed

- Independent Node.js workspace and local package linking
- Repository syntax and JSON quality checks
- Thirteen versioned v1 external contracts
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
- Ten forward-only PostgreSQL metadata migrations
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
- Machine-readable draft-validation report with deterministic validator/config
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
- `SURVEY_SOURCE` bindings for every accepted materialization input and one
  `SURVEY_PREVIEW` derived binding with immutable same-draft input edges
- Draft artifact provenance input capacity aligned to the 256-file survey
  intake contract and enforced by PostgreSQL migration 012
- Versioned `brash.survey-registration-report/v1` with source preview identity,
  canonical target frame, sorted control points, transform, per-point residuals,
  RMSE, maximum/mean error, scale deviation, solver version, and configuration
  SHA-256
- Twin API/OpenAPI registration create/list operations storing each report as a
  completed, content-addressed `REGISTRATION_REPORT` derived from the sealed
  preview binding
- Operator-editable source/target control points with locked-scale rigid solve
  by default, repeatable registration versions, and a fused canonical 2D/3D
  survey overlay that preserves the separate source-frame inspection mode
- Compact `npm run demo:seed` workflow covering upload through registered fused
  view without external downloads

## Next development increment

Phase 2 continues with survey quality and target-evidence review:

1. Require an imported CAD/BIM or floorplan binding as explicit target evidence
   when registration is performed against a design source.
2. Add coverage, timing, frame-quality, and reconstruction-review surfaces
   before CAD alignment and semantic asset review.
3. Add registration acceptance thresholds and reviewer approval before a
   transform may contribute to a publishable map release.
4. Begin semantic asset-candidate extraction from registered survey evidence.

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
syntax/json: 238 files passed
backend tests: 101 total; 98 passed and 3 optional external tests skipped
web tests: 35/35 passed with strict TypeScript and production build
live PostgreSQL 16 migration/repository gate: passed with schema version 12
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
survey materialization: immutable input, leased/retry-safe streaming, content-addressed preview, PostgreSQL provenance, HTTP lifecycle and source-frame 2D/3D browser QA verified
survey registration: complete source/preview/report lineage, versioned rigid transform evidence, HTTP lifecycle, operator controls, and fused/source-frame 2D/3D browser QA verified
dataset: ConSLAM IFC/GT checksum, geometry and trajectory validation verified
GrandTour: pinned SHA-256, safe Zarr/PLY bounds, real trajectory/TF/map metrics and bounded preview verified
GrandTour seed: real 290,764,702-byte selection imported twice idempotently into a live Twin API and materialized for Studio
```
