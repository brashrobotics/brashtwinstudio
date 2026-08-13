# Coordinate Frames

Connects all 2D and 3D data to the same physical world.

## Responsibilities

- Represent site, building, floor, and sensor frame graphs.
- Manage 2D/3D rigid transforms, scale, and timestamp validity.
- Resolve transforms among vendor maps, CAD, SLAM, camera, and canonical frames.
- Compose transform chains and propagate uncertainty.
- Validate handedness, units, and angle conventions.

The canonical distance unit is metres, time is UTC, and internal angles are
radians.

## Implemented baseline

`index.js` provides normalized, apply, compose, and inverse similarity-transform
operations plus a `CoordinateFrameGraph` with cycle, unknown-parent, and
root-mismatch detection. Quaternion rotation and 3D translation are supported;
tests verify round trips from vendor and sensor frames into the canonical frame.
