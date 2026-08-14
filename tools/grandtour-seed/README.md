# GrandTour Seed

Imports the pinned GrandTour Mission 2 ETH Mainbuilding processed survey into a
running development Twin API. The adapter verifies the bounded local dataset,
exports the DLIO odometry to TUM without changing its source evidence, uploads
the real PLY reconstruction, and executes the normal survey intake and
materialization pipeline.

The base selection must already exist at `.local/datasets/grandtour-eth2`. The
command never downloads data and does not include the optional camera or IMU
archives.

Start the API and Studio with the same local object-store directory used by the
seed command:

```bash
TWIN_OBJECT_STORE_PATH=.local/demo-object-store npm run dev:api
npm run dev --workspace @brash-twin/studio-web
```

Then import the real survey:

```bash
TWIN_OBJECT_STORE_PATH=.local/demo-object-store npm run grandtour:seed
```

Open <http://127.0.0.1:4390/> and select:

- Site: `GrandTour ETH Mainbuilding`
- Floor: `ETH Mainbuilding`
- Map: `GrandTour Mission 2 Survey`
- Draft: `r1 · DRAFT`

The Studio receives a bounded preview of the 17-million-point reconstruction;
the immutable source artifact remains the original checksum-pinned PLY. No CAD
or floorplan is claimed by this seed, so the source frame is shown without a
survey-to-CAD registration.

Configuration:

- `TWIN_API_BASE_URL` defaults to `http://127.0.0.1:4380`.
- `TWIN_OBJECT_STORE_PATH` defaults to `.local/object-store` and must match the
  API process.
- `TWIN_GRANDTOUR_DIR` defaults to `.local/datasets/grandtour-eth2`.
- `TWIN_GRANDTOUR_SELECTION` defaults to the pinned ETH-2 selection manifest.
- `TWIN_GRANDTOUR_PYTHON` defaults to `.local/venv-ifc/bin/python`.

The command is idempotent while the API catalog and upload records are present.
