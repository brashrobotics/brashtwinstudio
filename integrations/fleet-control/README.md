# Fleet Control Integration

This directory documents the boundary between Mapping & Twin Studio and
`brashfleetcontrol`. The current scope makes no changes to the existing Fleet
Control application.

## First integration: published maps

Twin Studio publishes an immutable `Twin Map Bundle`. When Fleet Control is
ready, its own importer may consume these bundle entries:

- `manifest.json`
- `topology.json`
- `coordinate-frames.json`
- `assets.json`
- `zones.geojson`
- Optimized 2D/3D scene references

Twin Studio does not write to the Fleet Control database or call existing map
endpoints. The Fleet Control team owns the decision to import a release.

## Live 3D compatibility proof

Live 3D monitoring must combine two separate data streams:

1. A static, versioned 3D factory scene served by Twin Studio or a CDN.
2. Robot pose, mission, route, traffic, and alarm overlays owned by Fleet Control.

Twin Studio does not own live Fleet Control mission state. Fleet Control does not
mutate published 3D geometry at runtime. Shared keys are `mapReleaseId`,
`coordinateFrameId`, `assetId`, and `robotId`.

Implemented compatibility contracts:

```text
Twin Map Bundle v2  Twin Studio -> Fleet Control importer/CDN
Scene Manifest v2   Twin Studio -> 3D Viewer
Live Overlay v1     Fleet Control -> 3D Viewer
Replay Events v1    Fleet Control -> 3D Viewer
```

`apps/fleet-demo-web` is an independent proof: it loads the project-owned
`demo-plant@2` GLB tiles, validates the synthetic replay against the bundle,
interpolates the robot pose, and displays route and alarm state. It imports no
Fleet Control source and performs no Fleet write. A production Fleet importer,
CDN URL signer, and live transport remain owned integration work.
