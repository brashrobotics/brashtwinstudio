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
