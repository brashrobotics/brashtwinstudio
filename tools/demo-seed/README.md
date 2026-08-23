# Demo Seed

Creates a compact, deterministic factory survey in a running development Twin
API. The command exercises the real upload, survey intake, verification,
materialization, provenance, and survey-to-CAD registration boundaries.
It also seals independent quality/registration approvals, reviews two synthetic
semantic candidates and promotes the accepted electrical panel and conveyor
into asset revision 1. The seed also binds a synthetic but fully provenance-
sealed calibrated visibility grid backed by calibration, sensor-pose, and
occlusion-geometry inputs. A later observation set produces moved, missing, and
appeared review candidates only where that qualified visibility evidence covers
the baseline. It then seals an independent manager review and applies the
confirmed changes as asset revision 2. The Studio opens with the moved electrical
panel and named safety barrier in canonical 2D or 3D geometry, while the removed
conveyor remains traceable through the immutable change and visibility reports.

Start the API and Studio with a dedicated local object-store directory:

```bash
TWIN_OBJECT_STORE_PATH=.local/demo-object-store npm run dev:api
npm run dev --workspace @brash-twin/studio-web
```

In another terminal, use the same object-store directory:

```bash
TWIN_OBJECT_STORE_PATH=.local/demo-object-store npm run demo:seed
```

Then open <http://127.0.0.1:4390/>. The seed is intentionally small and uses
only synthetic data; it does not download any external dataset. The command is
idempotent: running it again validates and reuses the existing deterministic
demo resources instead of creating duplicates.

Configuration:

- `TWIN_API_BASE_URL` defaults to `http://127.0.0.1:4380`.
- `TWIN_OBJECT_STORE_PATH` defaults to `.local/object-store` and must match the
  API process.
