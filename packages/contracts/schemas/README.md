# Versioned Schemas

The schemas in this directory define Twin Studio file and integration boundaries.

- `raw-survey-package.v1.schema.json`: Sensor collection manifest.
- `twin-map-bundle.v1.schema.json`: Published release manifest.
- `coordinate-frames.v1.schema.json`: Spatial frame tree.
- `navigation-topology.v1.schema.json`: Fleet-compatible driving graph.
- `twin-assets.v1.schema.json`: 2D/3D semantic asset catalog.
- `scene-manifest.v1.schema.json`: Optimized scene and LOD parts.
- `fleet-live-overlay.v1.schema.json`: Future live 3D visualization boundary.
- `draft-validation-report.v1.schema.json`: Immutable validation evidence,
  deterministic validator identity, issue severity, and UI-ready spatial or
  document locations.
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
- `survey-coordinate-frames.v1.schema.json`: Embodied Controller survey-frame
  tree with metric static transforms, distinct from release/canonical frames.
- `survey-calibration.v1.schema.json`: Bounded sensor/frame calibration index
  with immutable parameter hashes; large vendor calibration payloads remain
  separate artifacts.

Published schemas are extended only in backward-compatible ways. Changes to
meaning or required fields require a new major version.
