# Fusion Worker

Runs heavy jobs that align CAD/BIM and observed SLAM geometry in the canonical
coordinate system.

## First working component: IFC inspector

`ifc_inspector.py` uses IfcOpenShell to open a real IFC file, triangulate product
representations in world coordinates, and produce JSON containing:

- IFC schema and metre conversion factor
- Project/site/building/storey and basic element counts
- Counts of products with geometry, vertices, and triangles
- 3D geometric bounds in metres

Install the dependency in an isolated Python environment:

```bash
python3 -m venv .local/venv-ifc
.local/venv-ifc/bin/pip install -r workers/fusion-worker/requirements-ifc.txt
```

The inspector does not modify IFC files. It does not yet solve a CAD–SLAM
transform; its bounds and provenance feed the future coarse-registration and ICP
stages.

## GrandTour processed-survey inspector

`grandtour_inspector.py` is a development-only real-data adapter. It safely
opens the pinned GrandTour DLIO Zarr-v2 archives and binary PLY map, rejects
unsafe archive structure or unexpected encodings, and creates a bounded survey
materialization preview without extracting the dataset. It exists to validate
the Twin Studio ingestion boundary; it is not robot localization code.

Its isolated dependencies are pinned separately:

```bash
.local/venv-ifc/bin/pip install -r workers/fusion-worker/requirements-grandtour.txt
```

The worker registers CAD/BIM geometry and SLAM reconstruction in one canonical
frame.

## Responsibilities

- Compute an initial transform from operator control points.
- Refine the transform with automatic registration.
- Report scale, rotation, translation, and residual error.
- Classify CAD-only, scan-only, and matching regions.
- Store alignment as a reversible suggestion.

The scan is never deformed to match CAD. Sources, their transform, and residual
differences remain separate.
