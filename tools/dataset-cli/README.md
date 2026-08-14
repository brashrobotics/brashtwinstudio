# Dataset CLI

Verifies and inspects non-redistributable real-world datasets outside source
control.

```bash
npm run dataset:verify -- \
  tests/fixtures/datasets/conslam-bim-gt.dataset.json \
  .local/datasets/conslam-bim-gt

npm run dataset:inspect -- \
  tests/fixtures/datasets/conslam-bim-gt.dataset.json \
  .local/datasets/conslam-bim-gt \
  --ifcopenshell-python .local/venv-ifc/bin/python
```

`verify` checks file sizes and SHA-512 values against the descriptor. `inspect`
also reports IFC STEP structure and TUM trajectory quality. If an IfcOpenShell
Python path is provided, real geometric triangulation and 3D-bounds checks run as
well.

The CLI never modifies dataset files or copies them into the repository.

## GrandTour processed-survey gate

The GrandTour selection uses a separate SHA-256 manifest because it pins a
small subset of a much larger repository. Downloads remain an explicit manual
action. Verify the already-downloaded base selection and then build a bounded
preview:

```bash
npm run dataset:selection-verify -- \
  tests/fixtures/datasets/grandtour-eth2.selection.json \
  .local/datasets/grandtour-eth2

npm run dataset:grandtour-inspect -- \
  tests/fixtures/datasets/grandtour-eth2.selection.json \
  .local/datasets/grandtour-eth2 \
  --python .local/venv-ifc/bin/python
```

`grandtour-inspect` runs only after size and SHA-256 verification. It reads the
DLIO Zarr-v2 tar members without extracting them, streams/memory-maps the PLY,
and emits `brash.survey-materialization-preview/v1`. Preview arrays are capped
at 4,096 samples. `numpy` and pinned `numcodecs==0.15.1` are development-only
inspector dependencies; neither is a Twin Studio runtime dependency.
