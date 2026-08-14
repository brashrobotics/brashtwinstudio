# Brash Mapping & Twin Studio

Brash Mapping & Twin Studio combines factory scans, CAD/BIM sources, and
operator knowledge to produce a versioned 2D/3D digital twin.

This workspace is intentionally independent from `../brashfleetcontrol`. Fleet
Control does not need to call this project at runtime; it consumes only
published, versioned contracts and optimized map bundles.

## Product boundary

This project is responsible for:

- Ingesting versioned LiDAR, camera, IMU, trajectory, and reconstruction outputs
  produced by Brash Embodied Controller.
- Aligning CAD/BIM and SLAM results in a shared coordinate system.
- Producing a 2D plan, 3D scene, and navigation topology from one source of truth.
- Presenting semantic object candidates for operator review.
- Allowing operators to assign names, types, properties, and operational links
  to assets.
- Comparing new observations against a published baseline to create change
  candidates.
- Publishing immutable, versioned `Twin Map Bundle` artifacts for Fleet Control.

This project is not responsible for:

- Assigning robot missions or reserving traffic resources.
- Running sensor drivers, real-time SLAM, localization, onboard autonomy, or
  robot safety logic.
- Writing directly to the Fleet Control database.
- Leaking a vendor robot protocol into the Fleet Core domain.
- Turning AI detections into permanent factory assets without human approval.

## Top-level structure

```text
apps/          Operator-facing 2D/3D web application
agents/        Contract documentation for external robot-side producers
services/      API, job management, realtime delivery, and change management
workers/       CAD fusion, semantic inference, and scene optimization
packages/      Shared domain, contract, and geometry libraries
integrations/  Controlled, one-way integration boundaries for external systems
storage/       Metadata database and large binary artifact storage policies
tools/         Operations and bundle-validation CLI tools
deployment/    Local and production deployment definitions
tests/         Contract, integration, and end-to-end quality gates
docs/          Architecture, data model, roadmap, and operations documentation
```

## Core principles

1. 2D and 3D are not independent maps; they are different views of the same
   canonical coordinate system.
2. Raw survey data, processed geometry, and published twin releases remain
   separate.
3. CAD represents `as-designed`, SLAM represents `as-observed`, and the
   published twin represents validated `as-operated` reality.
4. A published release is immutable. Corrections create a new revision.
5. `Observation`, `ChangeCandidate`, and `TwinAsset` are separate concepts.
6. Heavy fusion and AI workloads run in queued workers and never block the API;
   robot-side SLAM remains in Brash Embodied Controller.
7. Fleet Control integration uses only versioned contracts and bundles.

## Initial delivery target

The first MVP must upload CAD and a previously generated point cloud, let an
operator align them manually, edit 2D/3D assets and topology, run validation, and
publish a `Twin Map Bundle v1`.

See [docs/roadmap/README.md](docs/roadmap/README.md) for the implementation
sequence, [docs/architecture/README.md](docs/architecture/README.md) for service
relationships, and
[integrations/fleet-control/README.md](integrations/fleet-control/README.md) for
the Fleet Control boundary.

## Working foundation

The first Phase 0 increment is implemented:

- Dependency-light Node.js ESM workspace with local package boundaries.
- Versioned contracts for raw surveys, map bundles, coordinate frames,
  topology, assets, scenes, and the future Fleet live overlay.
- 3D similarity transforms and a coordinate-frame graph resolver.
- `MapDraft` domain model with review, validation, and immutable publication
  rules.
- Map Bundle CLI validating checksums, paths, releases, frames, topology, zones,
  and asset links.
- A valid `demo-plant@1` fixture with mutation and path-traversal tests.
- SHA-256 content-addressed local artifact storage.
- Atomic immutable release publication with staging revalidation.
- PostgreSQL metadata migrations for sites, surveys/jobs, releases, semantic
  assets, and change detection.
- In-memory and driver-independent PostgreSQL catalog repository adapters.
- Working Twin API for site/building/floor, map family/draft, and release catalog
  operations.
- Parameterized SQL, optimistic concurrency, and a strict HTTP JSON boundary.
- Twin API v1 OpenAPI contract.
- Real `pg` connection pool, strict database configuration, and
  liveness/readiness probes.
- Checksum- and advisory-lock-based migration runner with `db:status` and
  `db:migrate` commands.
- PostgreSQL 16 migration, concurrent-runner, and repository-restart tests.
- Request-scoped unit of work, atomic draft lifecycle event/outbox writes, and an
  expiring-lease retry dispatcher.
- Multipart upload intent API, streaming local object-store adapter, SHA-256
  finalization, and quarantine lifecycle.
- Source/derived artifact model that binds completed uploads to editable drafts
  with same-draft input lineage, producer/config provenance, and PostgreSQL
  append-only protection.
- Deterministic release-validation jobs that snapshot draft inputs, publish
  immutable JSON reports with UI-ready issue locations, and move only passing
  drafts to `VALIDATED`.
- Two-person publication with sealed bundle identity, recoverable file-store/DB
  state, atomic release/audit/outbox finalization, and reconciliation retries.
- React/TypeScript Studio Web shell with typed API queries, site-to-draft context,
  validation/release status, local identity boundary, localization, and
  responsive desktop/mobile behavior.
- Shared canonical world viewer with synchronized 2D/3D cameras, layer registry,
  entity selection, coordinate readout, WebGL performance budget, and lazy GPU
  loading.
- Safe SVG floorplan import with active-content rejection, physical-unit and
  `viewBox` normalization, deterministic provenance reports, warning surfaces,
  and direct CAD-layer preview.
- Command-based manual spatial editor for topology nodes/edges, zone polygons,
  and asset footprints with stable 2D/3D identities, numeric correction,
  cascading safety, and bounded undo/redo.
- Deterministic control-point alignment with metre-based residual, RMSE, scale,
  rotation, translation, and solver-configuration evidence.
- Manual Twin acceptance milestone sealing the floorplan, alignment, editor
  state, validation, diff, and two-person approval into an immutable local
  release preview that can be reopened in read-only 2D or 3D.
- Versioned Brash Embodied Controller survey-transfer and deterministic
  manifest-only ingest-report contracts with clock, frame, quality, provenance,
  safe-path, hash, and declared-byte policies.
- Durable embodied survey intake that atomically binds a bounded manifest and
  completed artifact uploads to an editable draft, verifies only manifest bytes,
  and preserves immutable acceptance or rejection evidence.
- Checksum-protected dataset adapter for ConSLAM IFC and ground-truth data.
- Real BIM triangulation through IfcOpenShell and TUM trajectory quality checks.

Run the local quality gate:

```bash
npm install
npm run check
```

Publish the sample release and start the local API:

```bash
node tools/map-bundle-cli/cli.js publish \
  tests/fixtures/bundles/demo-plant@1 \
  .local/twin-store
npm run dev:api
```

You can then read `http://127.0.0.1:4380/health` and
`http://127.0.0.1:4380/api/v1/releases`. The local bootstrap stores catalog
metadata in memory by default. For persistent operation, set
`TWIN_PERSISTENCE_MODE=postgres` and `TWIN_DATABASE_URL`, run
`npm run db:migrate`, and then start `npm run dev:api`.

See [docs/status/README.md](docs/status/README.md) for the current implementation
status and the
[end-to-end development plan](docs/roadmap/END_TO_END_DEVELOPMENT_PLAN.md) for the
full path to production.

The real-world dataset choice, licensing boundary, and initial measurements are
recorded in the
[dataset evaluation](docs/research/DATASET_EVALUATION.md).
