# Scene Worker

Produces web- and integration-friendly release artifacts from a validated twin
model.

## Responsibilities

- Clean, sample, and regionally partition point clouds.
- Generate 3D meshes and multiple levels of detail.
- Derive 2D floorplan, occupancy, and semantic-zone layers.
- Embed the same asset identities into 2D and 3D selection metadata.
- Generate navigation `topology.json` and `manifest.json`.
- Add checksums, bounds, coordinate frames, and compatibility metadata.

The worker output is the `Twin Map Bundle` delivered to consumers, including
Fleet Control.

## Implemented deterministic baseline

`@brash-twin/scene-pipeline` now partitions canonical release bounds into a
metric grid, derives visualization boxes only from reviewed Twin asset bounds,
adds a disclosed thin floor slab, and writes detailed/coarse GLB levels. Scene
Manifest v2 seals producer configuration, input artifact hashes, bounds, asset
IDs, and byte budgets. Twin Map Bundle v2 binds every GLB by path, media type,
SHA-256, and byte length before atomic target publication.

This baseline is intentionally replaceable. Mesh reconstruction, point tiles,
splatting, and GPU compression remain benchmark decisions behind the same
contract.
