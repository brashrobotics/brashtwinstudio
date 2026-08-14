# Data Model

## Identity hierarchy

```text
Site -> Building -> Floor -> CanonicalCoordinateFrame
                         -> SurveySession
                         -> MapDraft -> SurveyIntake -> DraftArtifactBinding -> ValidationRun -> MapRelease
                         -> TwinAsset -> AssetRevision
                         -> SemanticObservation -> ChangeCandidate
```

## Core distinctions

- `SurveySession`: Sensor evidence collected during a defined period.
- `SemanticObservation`: A candidate object seen by a model or user.
- `TwinAsset`: A persistent factory asset verified by a human.
- `MapDraft`: An editable working copy.
- `SurveyIntake`: An atomic, append-only mapping from one processed-survey
  manifest to completed artifact uploads, with one accepted or rejected report.
- `DraftArtifactBinding`: Immutably binds a completed upload's SHA-256 content
  identity, its role in a draft, and its coordinate frame.
- `ValidationRun`: Seals a draft snapshot to a deterministic validator identity,
  immutable report artifact, outcome, and issue summary.
- `MapRelease`: An immutable, consumable publication.
- `LiveState`: Current operational asset state; not part of a release.

Every spatial record must carry a `coordinateFrameId`. A 2D footprint and 3D
bounds for the same object must share an `assetId`. Positional uncertainty must
be retained and used by change detection.

## Draft artifact lineage

`SOURCE` bindings represent CAD/BIM, floorplan, point-cloud, trajectory, camera,
or calibration evidence. They cannot declare inputs or producers. Spatial source
roles carry a `coordinateFrameId`.

`DERIVED` bindings represent registered point clouds, meshes,
occupancy/elevation layers, scene tilesets, and processing or validation reports.
Every derived binding references:

- At least one input binding already created in the same draft
- The immutable SHA-256 identity held by that input
- The producer name and version
- The SHA-256 identity of the producer parameters

Clients do not send input hashes; the service resolves them from stored bindings.
Bindings and input edges do not accept updates or deletes. Corrections create a
new binding and, when needed, a new draft revision. Artifacts can be added only
while the draft is in `DRAFT`; review locks the lineage.

Cycles are rejected by both application write ordering and a PostgreSQL recursive
guard. The input count is sealed when a binding is created, so a later transaction
cannot append another input edge to an existing derived record.

## Twin asset change evidence

A model observation remains separate from a persistent Twin asset. An approved
candidate review may create the first `TWIN_ASSETS` revision. Later observations
produce a change report against one exact asset-set binding and SHA-256 identity.
The detector cannot review its own report, and every change must be confirmed or
dismissed before application.

Application never edits the baseline. It creates a v2 asset-set revision whose
inputs seal the predecessor, change report, independent review, and observation
report. Moved assets keep their `assetId`; confirmed missing assets are omitted;
confirmed appeared assets receive reviewed names, types, and properties. The new
binding and its notification outbox event share one transaction. Published map
releases and live Fleet Control state are not changed by this workflow.

## Survey intake evidence

An intake starts in `OPEN` only after its manifest and every declared mapping
resolve to completed upload identities. The mapping set is written in one
transaction and cannot be edited. Verification reads only the bounded manifest,
checks its target site/floor and declared SHA-256, byte length, and media types,
then seals `ACCEPTED` or `REJECTED`. A rejected intake remains audit evidence and
cannot feed materialization jobs; a correction uses a new intake identity.

## Validation evidence

A validation job captures the draft `rowVersion` and sorted binding/hash pairs
before execution. Its report is stored through the same content-addressed upload
path as every other artifact and is bound to the draft as a derived
`VALIDATION_REPORT`. The run record stores the report binding and SHA-256,
validator name/version/configuration hash, outcome, and severity counts.

A `FAILED` validation outcome is valid evidence and leaves the draft
`IN_REVIEW`; it is distinct from a processing job in `FAILED` state. Only a
`PASSED` outcome may transition the sealed draft to `VALIDATED`.

## Publication evidence

A publication request seals the validated draft row version, validation-report
SHA-256, bundle identity, manifest SHA-256, and every release artifact. The
requester cannot approve their own request; approval is a separate append-only
record.

The recoverable lifecycle is `APPROVED -> PUBLISHING -> STORE_PUBLISHED ->
COMPLETED`. The file store and PostgreSQL are intentionally not treated as one
distributed transaction. If execution stops between them, an expiring lease and
canonical identity comparison allow a reconciler to resume safely. The final
PostgreSQL transaction creates the release and artifact links, publishes the
draft, writes audit, appends the outbox event, and completes the request.
