# Studio Web

The operator interface for mapping and digital-twin workflows.

## Responsibilities

- Manage sites, buildings, floors, and survey sessions.
- Display CAD/BIM, point-cloud, and image layers in 2D and 3D.
- Support manual control-point alignment and review automatic alignment results.
- Accept, reject, merge, and correct semantic object suggestions.
- Assign names, classes, properties, zones, and topology links to assets.
- Edit nodes, edges, stations, holding points, and zones.
- Show revision differences, coverage gaps, and validation errors.
- Present change candidates and evidence images for manager approval.
- Preview published 2D/3D releases in read-only mode.

## Boundaries

- SLAM and heavy point-cloud processing do not run in the browser.
- The UI cannot mutate a published release in place; it opens a new draft.
- The UI never writes directly to the Fleet Control database or API.

## Implemented shell

- React 19 + TypeScript application built with the Node 18-compatible Vite 6
  toolchain.
- TanStack Query server-state boundary with abortable, typed Twin API calls.
- Automatic site -> floor -> map family -> draft workspace selection.
- Draft lifecycle, validation-job, API readiness, and immutable release status.
- OIDC-ready identity port with an explicitly local-only development adapter.
- English and Turkish localization foundation.
- Responsive industrial UI covering desktop and 390 px mobile layouts.
- Loading, empty, disconnected, retry, keyboard-focus, and reduced-motion states.
- Lazy-loaded Three.js spatial adapter over `@brash-twin/viewer-sdk`.
- Orthographic 2D and perspective 3D cameras over the same canonical world.
- Pan/zoom/orbit controls, metre coordinate readout, grid, axes, and compass.
- CAD, survey, asset, zone, and topology visibility registry.
- Raycast entity selection preserved between 2D and 3D views.
- GPU drawing-buffer budget capped at 2.4 megapixels.
- Safe SVG floorplan upload with explicit unit override, physical `viewBox`
  normalization, source/configuration SHA-256 provenance, bounds, and warning
  summary.
- Imported metre-based geometry replaces only the editable CAD layer; survey,
  asset, zone, and topology identities remain stable.
- Rendering-independent spatial editor commands projected into the shared
  viewer with stable IDs.
- Grid-snapped topology node and asset placement, two-node edge connection,
  polygon-zone drawing/preview, and numeric feature correction.
- Bounded undo/redo, cascading node/edge deletion, keyboard shortcuts, and
  invariant failures surfaced without committing partial edits.
- Project-owned synthetic floorplan fixture that loads from the UI without an
  external network dependency.
- Deterministic three-or-more-point alignment with editable correspondences and
  RMSE, maximum-error, scale, rotation, and configuration-hash evidence.
- Manual Twin milestone panel for diff, validation, requester/approver
  separation, and immutable local publication evidence.
- Read-only published-preview mode with synchronized 2D/3D navigation and a
  deliberate return path to the still-editable draft.
- Typed materialization job/preview queries and a survey status panel exposing
  source frame, full trajectory pose count, and full reconstruction point count.
- Bounded trajectory and sampled point-cloud rendering in both 2D and 3D, with
  automatic fit-to-bounds navigation.
- Survey preview v2 uses the trajectory-envelope operational plan for camera
  fit, 2D occupancy, registration defaults, and spatially balanced 3D samples;
  distant raw PLY outliers remain visible as provenance metrics but no longer
  collapse a real building-scale survey into a tiny viewport.
- Survey status exposes route length, plan extent, adaptive resolution, source
  point count, and focused cell count for large real-data demonstrations.
- A dedicated read-only source-frame mode. Unregistered SLAM coordinates are
  never overlaid on the canonical CAD frame; the operator deliberately returns
  to the draft world until a registration transform exists.
- Registration target selection limited to canonical-frame CAD/BIM or floorplan
  evidence, with deterministic quality status and immutable independent-reviewer
  approval/rejection controls.
- Survey quality report generation and independent review with declared
  coverage, sampled occupancy, point density, trajectory continuity, issue
  surfaces, and a toggleable occupancy layer in both 2D and 3D.
- Semantic observation selection and canonical candidate extraction gated by an
  approved registration, with independent operator accept/reject, name, type,
  and JSON scalar-property review controls.
- Unreviewed and accepted candidates render on the shared Assets layer in both
  2D and 3D; rejected observations are hidden and no review silently promotes a
  candidate into a permanent Twin asset.
- Explicit accepted-candidate promotion into predecessor-linked Twin asset
  revisions, rendered as canonical 2D/3D asset geometry.
- Later-observation comparison controls and moved/missing/appeared summaries;
  an independent operator confirms or dismisses every change. Legacy reports
  retain their approximate-envelope acknowledgement.
- Sensor-visibility report creation from each unprocessed robot visibility
  observation, with qualification, evidence kinds, covered area, issues, and a
  dedicated toggleable canonical 2D/3D Sensor visibility layer.
- Change detection selects only visibility evidence whose registration
  acceptance and semantic observation-set identity match the candidate scan.
  Production `MISSING` results display calibrated visibility qualification and
  never rely on the legacy observed-envelope heuristic.
- Confirmed moves, missing assets, and appeared assets can be applied as the
  next immutable Twin asset revision. Dismissed markers disappear, and markers
  for an applied change set yield to the revised 2D/3D asset geometry.

The milestone publication button creates a browser-local acceptance preview. It
does not replace the production Twin API publication service, durable object
store, or PostgreSQL audit trail.

The browser uses same-origin `/api` and `/health` requests. During local
development, Vite proxies both paths to `http://127.0.0.1:4380`. A deployed
environment may set `VITE_TWIN_API_URL` at build time when the API uses a
different origin and supplies the corresponding security policy.

## Commands

From the repository root:

```bash
npm run dev:api
npm run dev --workspace @brash-twin/studio-web
```

Open `http://127.0.0.1:4390`. Run the complete web quality gate with:

```bash
npm run check:web
```

That command runs strict TypeScript checking, Vitest/jsdom component and client
tests, and the production bundle. Dependency audit was clean when this increment
was completed; production CI should continue to run `npm audit --audit-level=high`
as a separate networked supply-chain gate.

The local identity is UI context, not a security authority. Production mutation
authorization must be enforced by the Twin API after OIDC token verification.
