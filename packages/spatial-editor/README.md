# Spatial Editor

Rendering-independent command model for manual digital-twin editing.

## Responsibilities

- Maintain validated topology nodes and edges, zones, and rectangular asset
  footprints in canonical metres.
- Apply bounded, immutable commands through a single store.
- Keep a bounded undo/redo history without depending on React or Three.js.
- Cascade edge removal when a referenced node is deleted.
- Recompute edge geometry when a node moves.
- Convert editor features to `viewer-sdk` entities with stable shared IDs.
- Snap operator input to a configurable canonical-metre grid.

## Boundaries

- The package does not persist drafts or call Twin API.
- It does not mutate published releases.
- CAD and raw survey evidence are outside the editable document.
- Viewer entities are projections of editor state, not an independent source of
  truth.

The Studio Web adapter owns pointer gestures, drawing previews, keyboard
shortcuts, numeric inspectors, and future autosave/conflict behavior.
