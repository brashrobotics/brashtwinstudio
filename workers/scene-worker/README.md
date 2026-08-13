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
