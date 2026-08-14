# External Dataset Descriptors

This directory contains no real-world dataset files. It stores only provenance,
usage restrictions, sizes, and official checksums for files downloaded elsewhere.
Large sensor and BIM files live under `.local/datasets/` and are excluded from
Git.

## ConSLAM BIM and ground-truth poses

The first evaluation dataset pairs an IFC reference model of a construction site
with corrected TUM trajectories from four LiDAR sessions. Although the source
package is 71 MB, the first gate downloads about 9 MB because it does not need the
Revit file.

The dataset is licensed under CC BY-NC 4.0. It is used only for internal
development and evaluation and is not distributed in the Brash product,
containers, or published Twin Map Bundles.

Download from the official TUM rsync endpoint:

```bash
mkdir -p .local/datasets/conslam-bim-gt
RSYNC_PASSWORD=m1743877 rsync --archive \
  --include='*.ifc' --include='*.tum' --include='checksums.sha512' \
  --exclude='*' \
  rsync://m1743877@dataserv.ub.tum.de/m1743877/ \
  .local/datasets/conslam-bim-gt/
```

Then run `npm run dataset:verify` and `npm run dataset:inspect` using the example
in `tools/dataset-cli/README.md`.

## GrandTour Mission 2 metadata selection

`grandtour-eth2.selection.json` pins the metadata-only GrandTour Mission 2
selection used to design the Embodied Controller transfer adapter. Nothing in
the normal quality gate downloads these files. The base selection is about
291 MB and the optional single-camera/IMU selection remains below the explicit
1 GB local-development ceiling.
