# Tests

The quality strategy covers algorithmic correctness and the product lifecycle.

- `contract/`: API, event, and bundle compatibility.
- `integration/`: Database, object-store, queue, and worker pipelines.
- `e2e/`: Operator map-publication and change-review journeys.
- `fixtures/`: Small test data with safe licensing and privacy characteristics.

Never add real customer CAD, camera images, or factory point clouds to the
repository.

The draft-artifact quality gate covers role/provenance domain rules, server-side
input-hash resolution, the transaction boundary, the HTTP source-to-derived
chain, and PostgreSQL append-only triggers.

The survey-quality gate covers deterministic metric and occupancy-grid output,
preview/report/acceptance provenance, requester/reviewer separation, failed
quality rejection, and the registration dependency on approved evidence.

The validation quality gate covers deterministic reports, UI-ready issue
locations, sealed input snapshots, multipart report storage, HTTP job execution,
real PostgreSQL job/run transactions, report-binding consistency triggers, and
immutable validation history.

The publication quality gate injects failures on both sides of the release-store
marker, verifies reconciliation, enforces second-person approval, and checks the
atomic release/draft/audit/outbox commit with real PostgreSQL 16.

Studio Web keeps colocated Vitest tests under `apps/studio-web/src`. Its gate
covers typed API URL/error behavior, local identity persistence, the asynchronous
site-to-draft query chain, validation/release rendering, strict TypeScript, and a
production Vite build. Browser QA covers desktop, 390 px mobile, EN/TR switching,
and browser-console cleanliness against a real local Twin API.

Viewer tests cover identity uniqueness, entity/layer validation, 2D/3D shared
selection, hidden-layer selection safety, pointer/world state, and the high-DPI
drawing-buffer cap. Real-browser QA additionally exercises WebGL rendering,
raycast selection, view switching, layer toggles, coordinate readout, and mobile
overflow.
