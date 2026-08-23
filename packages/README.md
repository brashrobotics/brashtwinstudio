# Packages

Infrastructure-independent domain libraries shared by multiple applications,
services, and workers live here.

- `contracts/`: API, event, and bundle schemas.
- `scene-pipeline/`: Deterministic Scene Manifest v2 and GLB LOD packaging.
- `fleet-replay/`: Live-overlay replay validation and visualization sampling.
- `domain/`: Twin lifecycle and core business rules.
- `coordinate-frames/`: Frame graph and pose transforms.
- `importers/`: Adapters that convert source formats into a canonical intermediate model.
- `topology/`: Navigation-graph suggestion and editing rules.
- `validation/`: Release quality gates.
- `artifact-store/`: Content-addressed artifacts and immutable release storage.
- `application/`: Catalog use cases and draft lifecycle orchestration.
- `persistence/`: In-memory and PostgreSQL catalog repository adapters.
- `migrations/`: Checksum- and advisory-lock-based PostgreSQL migration runner.
- `viewer-sdk/`: Shared 2D/3D selection and layer client model.
- `spatial-editor/`: Validated manual topology/zone/asset commands, stable viewer
  projections, and bounded undo/redo history.
- `manual-twin/`: Deterministic control-point registration, validation, diff,
  two-person approval, and immutable local release-preview rules.
- `embodied-survey/`: Manifest-only validation of processed survey transfers
  produced through the Brash Embodied Controller interface.
