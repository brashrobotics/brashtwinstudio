# ADR-001: Scene/Bundle v2 and Live Overlay Separation

- Status: Accepted
- Date: August 23, 2026

## Context

Scene Manifest v1 could reference LOD paths but did not bind each tile's hash and
byte length or identify the exact canonical inputs and configuration used to
produce it. Fleet visualization also needed a demonstrable replay boundary
without importing Fleet Control source or allowing live state to mutate static
release geometry.

## Decision

Twin Studio publishes new optimized scenes as Twin Map Bundle v2 containing
Scene Manifest v2. Each scene level is also a root `SCENE_TILESET` artifact and
must match the scene path, media type, SHA-256, and byte length. The manifest
seals producer/configuration/input identities plus tile, LOD, and byte budgets.
Legacy v1 releases remain readable.

Fleet state stays in Fleet Live Overlay v1. Fleet Live Replay v1 is an ordered,
immutable collection of those overlays tied to one `mapReleaseId` and canonical
frame. Static geometry never contains missions, reservations, alarms, or robot
poses; replay frames never contain or rewrite static geometry.

## Consequences

- Publication can reject missing, changed, oversized, or unreferenced GLB files.
- A CDN/object-store adapter can serve immutable tiles independently of live
  transport.
- Fleet Control can implement an importer and overlay publisher without sharing
  source code or databases with Twin Studio.
- Repackaging a published release under the same identity remains forbidden;
  scene generation occurs before immutable release publication.
- Production mesh/point/splat implementations may replace the baseline GLB
  generator only if they preserve the v2 contract and deterministic evidence.
