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
