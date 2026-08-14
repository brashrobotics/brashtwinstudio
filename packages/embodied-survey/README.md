# Embodied Survey Integration

Validates the versioned transfer boundary from Brash Embodied Controller into
Twin Studio.

## Ownership

Brash Embodied Controller owns sensor drivers, calibration execution, clock
synchronization, SLAM, localization, onboard autonomy, and safety. Twin Studio
does not run those real-time workloads.

This package accepts their outputs as immutable evidence and checks:

- producer build and configuration identity;
- capture interval and clock quality;
- SI, right-handed, Z-up coordinate conventions;
- unique artifact identities and safe relative paths;
- SHA-256 and declared byte-length metadata;
- required coordinate-frame, calibration, trajectory, and quality evidence;
- at least one point-cloud, occupancy, elevation, or mesh reconstruction;
- configurable byte, clock-offset, completion, and quality policies.

Validation reads only the manifest. Large sensor and reconstruction artifacts
remain in the multipart object-store data plane and are verified separately at
upload completion.

## Output

`validateEmbodiedSurveyPackage` returns deterministic
`brash.embodied-survey-ingest-report/v1` evidence with manifest and policy
SHA-256 identities. A rejected intake remains attached only as immutable audit
evidence and is never promoted as accepted reconstruction input.

## Materialization adapters

`@brash-twin/embodied-survey/materialization` is the worker-side processed-data
boundary. It accepts Brash survey-frame/calibration JSON, strictly increasing
TUM trajectory text, and binary little-endian XYZI PLY. Every stream is rehashed
and byte-counted against the accepted snapshot while parsing under explicit
JSON, pose, point, and preview limits. The result is a bounded
`brash.survey-materialization-preview/v2` document. V2 preserves the raw PLY
bounds and stride sample, then builds an adaptive XY plan from verified points
inside a padded trajectory envelope. The grid is capped at 4,096 cells and
retains source/projected point counts so the operator-focused view never
pretends that excluded outliers disappeared from the evidence.

GrandTour Zarr is intentionally absent from this runtime adapter. Dataset-specific
conversion remains development tooling; Brash Embodied Controller owns production
SLAM and emits the standardized artifacts consumed here.
