# Semantic Worker

Produces semantic object candidates from camera images and 3D segments.

## Responsibilities

- Project 2D detection/segmentation results into the 3D scene.
- Merge observations of the same physical object across frames.
- Produce class, confidence, 3D bounds, 2D footprint, and evidence references.
- Support configurable classes such as panels, conveyors, workcells, doors,
  docks, shelves, and safety signs.
- Record model and dataset versions with every inference result.

The output is a `SemanticObservation`; no result automatically becomes a
permanent `TwinAsset`.
