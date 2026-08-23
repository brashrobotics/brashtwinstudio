# Versioned Schemas

The schemas in this directory define Twin Studio file and integration boundaries.

- `raw-survey-package.v1.schema.json`: Sensor collection manifest.
- `twin-map-bundle.v1.schema.json`: Legacy published release manifest.
- `twin-map-bundle.v2.schema.json`: Published release manifest with sealed
  validation, producer/input identity, Scene Manifest v2, Fleet overlay/replay
  compatibility, and individually bound scene tilesets.
- `coordinate-frames.v1.schema.json`: Spatial frame tree.
- `navigation-topology.v1.schema.json`: Fleet-compatible driving graph.
- `twin-assets.v1.schema.json`: 2D/3D semantic asset catalog.
- `scene-manifest.v1.schema.json`: Legacy optimized scene and LOD references.
- `scene-manifest.v2.schema.json`: Producer- and input-bound canonical scene,
  explicit tile/LOD/byte budgets, and per-level SHA-256 identity.
- `fleet-live-overlay.v1.schema.json`: Future live 3D visualization boundary.
- `fleet-live-replay.v1.schema.json`: Ordered immutable Fleet overlay frames for
  mission, route, alarm, and robot-pose replay against one map release.
- `draft-validation-report.v1.schema.json`: Legacy immutable validation evidence.
- `draft-validation-report.v2.schema.json`: Immutable validation evidence,
  deterministic validator identity, issue severity, and UI-ready spatial or
  document locations, including verified registration-review decisions.
- `floorplan-import-report.v1.schema.json`: Deterministic SVG source and
  configuration provenance, metre-normalized floorplan geometry, bounds, and
  non-fatal import warnings.
- `registration-report.v1.schema.json`: Control-point inputs, deterministic 2D
  solver identity, canonical transform, per-point residuals, RMSE, maximum
  error, and scale deviation.
- `embodied-survey-package.v1.schema.json`: Versioned Brash Embodied Controller
  transfer containing producer identity, clock/frame conventions, processed
  trajectory/reconstruction artifacts, quality evidence, hashes, and sizes.
- `embodied-survey-ingest-report.v1.schema.json`: Deterministic Twin Studio
  acceptance or rejection evidence for an embodied survey manifest.
- `survey-materialization-preview.v1.schema.json`: Bounded trajectory,
  coordinate-frame, reconstruction-bounds, and downsampled point preview while
  retaining the original processed-survey frame.
- `survey-materialization-preview.v2.schema.json`: Backward-readable survey
  preview plus a bounded, trajectory-envelope XY plan projection derived from
  the verified full point cloud. Raw reconstruction bounds remain intact while
  focused plan samples exclude distant outliers from operator navigation.
- `survey-quality-report.v1.schema.json`: Deterministic coverage, trajectory,
  frame, reconstruction-density, warning, and bounded occupancy-grid evidence.
- `survey-quality-acceptance.v1.schema.json`: Immutable independent operator
  approval or rejection derived from one survey-quality report.
- `survey-coordinate-frames.v1.schema.json`: Embodied Controller survey-frame
  tree with metric static transforms, distinct from release/canonical frames.
- `survey-calibration.v1.schema.json`: Bounded sensor/frame calibration index
  with immutable parameter hashes; large vendor calibration payloads remain
  separate artifacts.
- `survey-registration-report.v1.schema.json`: Legacy survey preview-to-frame
  transform and residual evidence.
- `survey-registration-report.v2.schema.json`: Survey preview plus explicit
  BIM/floorplan target evidence and deterministic quality-policy results.
- `survey-registration-acceptance.v1.schema.json`: Immutable two-person reviewer
  approval or rejection derived from one quality-scored registration report.
- `semantic-observations.v1.schema.json`: Bounded model observations in a survey
  frame with model identity and sealed camera/LiDAR evidence references.
- `asset-candidate-report.v1.schema.json`: Canonical candidates derived through
  one approved registration while preserving source observation evidence.
- `asset-candidate-review.v1.schema.json`: Immutable operator accept/reject,
  name, type, and scalar-property decisions without automatic asset promotion.
- `draft-twin-assets.v1.schema.json`: Immutable draft asset-set revision with
  predecessor, accepted-review, canonical geometry, policy, and source-observation lineage.
- `draft-twin-assets.v2.schema.json`: Backward-readable asset revision model
  that distinguishes candidate promotion from reviewed change application and
  preserves the change report, review, observation, and predecessor identities.
- `asset-change-report.v1.schema.json`: Later-observation comparison against one
  asset baseline, including bounded coverage and review-required moved, missing,
  and appeared candidates.
- `sensor-visibility-observations.v1.schema.json`: Externally produced bounded
  source-frame coverage cells correlated to one semantic observation set, with
  calibrated sensor, synchronized pose, occlusion, producer, and input
  provenance assertions.
- `sensor-visibility-report.v1.schema.json`: Immutable canonical-frame
  visibility cells, qualification outcome, policy threshold, approved
  registration identity, and exact calibration/pose/occlusion evidence.
- `asset-change-report.v2.schema.json`: Backward-readable change comparison that
  requires one correlated sensor-visibility report and attaches qualifying cell
  evidence to every `MISSING` result.
- `asset-change-review.v1.schema.json`: Immutable independent confirmation or
  dismissal for every detected change, appeared-asset metadata, summary, and
  explicit acknowledgement of approximate missing coverage.
- `twin-asset-changes-applied-event.v1.schema.json`: Exact versioned event emitted
  when a reviewed asset-change report becomes a new immutable asset revision.
- `manager-notification-message.v1.schema.json`: Bounded and redacted manager
  delivery payload containing change counts, severity, and Twin Studio context.

Published schemas are extended only in backward-compatible ways. Changes to
meaning or required fields require a new major version.
