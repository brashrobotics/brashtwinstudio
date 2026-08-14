# Brash Embodied Controller Integration

This boundary imports processed robot-survey outputs into Twin Studio without
depending on Brash Embodied Controller source code, runtime libraries, or
storage.

## Ownership

Brash Embodied Controller owns:

- sensor drivers and device health;
- calibration execution and time synchronization;
- real-time SLAM, localization, and pose uncertainty;
- onboard autonomy and robot safety;
- construction of a complete or explicitly partial survey transfer.

Twin Studio owns:

- multipart upload intents and content-addressed artifact storage;
- manifest, checksum, byte-length, clock, frame, and quality validation;
- survey trajectory, coverage, and reconstruction review;
- CAD/BIM registration and operator correction;
- draft provenance, validation, and immutable Twin Map Bundle publication.

Fleet Control remains the owner of missions, live robot state, and traffic.

## Transfer

The producer emits `brash.embodied-survey-package/v1`. Heavy artifacts travel
directly to object storage through bounded multipart uploads; the API receives
metadata and completion commands only. Twin Studio accepts a manifest only
after every referenced upload has reached a checksum-verified terminal state.
It then creates one atomic survey intake: the manifest and every mapped upload
are either attached to the draft together or not attached at all.

Required evidence includes exactly one coordinate-frame graph, calibration,
trajectory, and detailed quality report, plus at least one metric point-cloud,
occupancy, elevation, or mesh reconstruction. Coordinates are metres,
right-handed, and Z-up at this boundary. The producer's local SLAM frame remains
distinct from the Twin Studio canonical factory frame until registration is
approved.

## Failure behavior

- Unknown versions, unsafe paths, invalid hashes, oversized declarations, and
  missing required roles produce an immutable rejected intake; rejected content
  is retained as audit evidence but cannot become accepted reconstruction input.
- Unsynchronized clocks, excessive clock offsets, partial captures, and failed
  reconstruction quality are rejected by the default policy.
- An explicit pilot policy may retain partial or warning packages as reviewable
  evidence, but never as an automatically published baseline.
- Retries reuse content hashes and upload completion receipts; they do not create
  mutable copies of accepted evidence.

## Live versus batch data

Survey packages are durable batch inputs for map creation. Live robot pose,
mission, route, traffic, and alarm overlays belong to Fleet Control contracts and
are not smuggled through the survey-ingest channel.
