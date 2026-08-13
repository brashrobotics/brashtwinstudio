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

## Future integration: live 3D view

Live 3D monitoring must combine two separate data streams:

1. A static, versioned 3D factory scene served by Twin Studio or a CDN.
2. Robot pose, mission, route, traffic, and alarm overlays owned by Fleet Control.

Twin Studio does not own live Fleet Control mission state. Fleet Control does not
mutate published 3D geometry at runtime. Shared keys are `mapReleaseId`,
`coordinateFrameId`, `assetId`, and `robotId`.

Planned compatibility contracts:

```text
MapRelease v1       Twin Studio -> Fleet Control
Scene Manifest v1   Twin Studio -> 3D Viewer
Live Overlay v1     Fleet Control -> 3D Viewer
Replay Events v1    Fleet Control -> 3D Viewer
```

Until these contracts are complete, integration remains limited to documentation
and fixtures.
