# Implementation Roadmap

This file is a concise phase summary. See
[END_TO_END_DEVELOPMENT_PLAN.md](END_TO_END_DEVELOPMENT_PLAN.md) for detailed
dependencies, work packages, acceptance gates, tests, security, MLOps, and pilot
planning.

## Phase 0 — Foundation and core contracts

- Define domain identities and coordinate-frame conventions.
- Write Raw Survey Package and Twin Map Bundle v1 schemas.
- Create metadata migrations for sites/buildings/floors, jobs, drafts/releases,
  and assets.
- Define object-store key and retention rules.
- Fix the Fleet Control boundary with contract-test fixtures.

**Exit criterion:** A sample bundle passes schema validation with no Fleet Control
source-code dependency.

## Phase 1 — Manual Mapping Studio MVP

- Studio Web project and floor management.
- CAD/floorplan and prepared point-cloud uploads.
- Manual alignment with control points.
- Shared 2D/3D viewer.
- Manual asset, station, zone, node, and edge editing.
- Draft validation and bundle publication.

**Exit criterion:** An operator can publish a `MapRelease v1` containing topology
and an optimized 3D scene for a real floor.

## Phase 2 — Embodied survey integration

- Brash Embodied Controller transfer contract and producer identity.
- Interruption-tolerant uploads of externally produced survey artifacts.
- Atomic completed-upload intake with immutable acceptance/rejection evidence.
- Trajectory, reconstruction, clock/frame, and quality validation.
- Automatic CAD-to-survey registration suggestions.
- Survey replay and missing-coverage view.

**Exit criterion:** A processed robot survey produced by Brash Embodied
Controller is ingested, verified, replayed, and aligned to CAD with an error
metric without running SLAM inside Twin Studio.

## Phase 3 — Semantic assistance and operator approval

- Camera and point-cloud semantic-observation pipeline.
- Panel, conveyor, workcell, door, dock, and shelf classes.
- Review screen with evidence images or segments.
- Observation-to-asset matching and asset property editor.
- Model/dataset versioning and evaluation set.

**Exit criterion:** AI produces suggestions only; an operator can publish a
verified asset under the same identity in 2D and 3D.

## Phase 4 — Change detection and notification

- Compare a new survey with the baseline.
- Produce moved, missing, appeared, and geometry-changed candidates.
- Add localization/visibility confidence gates and repeated verification.
- Manager review, acknowledgment, and new-draft workflow.
- Outbox-based email/messaging adapter boundary.

**Exit criterion:** False-alarm targets are met on a controlled test set, and no
change modifies the baseline without human approval.

## Phase 5 — Live 3D preparation for Fleet Control

- Scene Manifest v1 with LOD and regional loading.
- Robot model, pose interpolation, and route/traffic/alarm overlay contracts.
- Mission replay timeline contract.
- Independent fixture-based 3D demo viewer.
- Versioned integration package for the Fleet Control team.

**Exit criterion:** A static Twin Studio scene and mock Fleet overlay run in an
independent demo without changing the existing Fleet Control project.

## Phase 6 — Production hardening

- Large-factory performance, LOD, and upload scale tests.
- Multi-site tenancy, RBAC, audit, retention, and privacy.
- Backup/restore, disaster recovery, and release rollback runbooks.
- Model drift, calibration drift, and sensor-health observability.
