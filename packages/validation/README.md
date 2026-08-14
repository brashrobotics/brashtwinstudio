# Validation

Contains deterministic quality gates that decide whether a draft can be
published.

## Checks

- Coordinate-frame chain, units, and registration error thresholds
- Node/edge identities and graph connectivity
- Reachability among critical stations
- Edge length, direction, speed, and clearance consistency
- Asset identity and 2D/3D representation consistency
- Missing artifacts and checksum verification
- Incompatible or breaking differences from the previous revision
- Fleet Control contract compatibility

Results are produced as a machine-readable report and an operator summary.

## Implemented baseline

`index.js` currently validates the following for a bundle directory:

- Artifact path-traversal protection, file size, and SHA-256 integrity
- Required artifact roles and release-identity consistency
- Coordinate-frame parent/cycle and canonical-frame checks
- Node/edge identity, endpoint, cost, and graph connectivity
- Zone identity and GeoJSON polygon types
- Asset frame and node/edge/zone binding references
- Scene-manifest release/frame/bounds consistency

The validator does not replace JSON Schema; schema validation and semantic
quality gates will eventually run together.

`draft.js` implements the job-facing draft validator. A validation job seals the
draft row version and the SHA-256 identity of every input binding before it runs.
The validator then emits `brash.draft-validation-report/v2`, including a
configuration hash, deterministic issue identifiers, severity counts, and
locations that can be selected in a future 2D/3D issue panel. Validation-report
artifacts are excluded from subsequent validation inputs so reruns do not create
self-referential lineage.

When registered survey evidence is present, the job reads each immutable
registration-acceptance artifact by SHA-256 and records its verified decision in
the report input snapshot. A missing, rejected, malformed, or provenance-mismatched
decision produces `REGISTRATION_APPROVAL_REQUIRED`; publication eligibility
therefore cannot rely on the mere presence of an acceptance-role artifact.
