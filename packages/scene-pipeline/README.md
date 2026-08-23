# Scene Pipeline

Creates a deterministic, browser-ready Scene Manifest v2 and GLB LOD tiles from
the canonical artifacts of a sealed Twin Map Bundle staging directory.

The pipeline never edits its source directory. It writes into a private staging
directory, binds every GLB by path, SHA-256, media type, and byte length in Twin
Map Bundle v2, validates the complete result, and only then atomically exposes
the target directory.

## Current geometry policy

- Partition canonical XY bounds into a deterministic metric grid.
- Generate one detailed and one coarse GLB for every occupied factory tile.
- Preserve canonical frame identity and asset IDs in Scene Manifest metadata.
- Derive boxes only from reviewed Twin asset bounds; semantic observations are
  never promoted by the scene worker.
- Add a thin floor slab as visualization geometry without claiming it is raw
  survey evidence.
- Enforce tile-count, LOD-count, per-tile byte, and total-byte budgets.

The dependency-light GLB writer is deliberately conservative. Future mesh,
point-tile, splat, or GPU-compression implementations may replace it behind the
same manifest contract after real-data benchmarks.
